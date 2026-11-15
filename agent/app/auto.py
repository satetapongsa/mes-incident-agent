"""Auto mode: the agent picks up new tickets by itself (one at a time).

Only the analysis is automatic. The fix is still only a Pending proposal - a person must approve it.
One ticket at a time and a pause between runs keeps the LLM inside free-tier rate limits.
"""
from __future__ import annotations

import asyncio
import logging
import os

from . import hub, remedy, runner

log = logging.getLogger("agent.auto")

POLL_SEC = int(os.getenv("AUTO_POLL_SEC", "20"))


class AutoState:
    def __init__(self) -> None:
        self.enabled = os.getenv("AUTO_AGENT", "false").lower() in ("1", "true", "yes", "on")
        self.current: str | None = None
        self.handled: list[str] = []
        self.skipped: set[str] = set()
        self.last_error: str | None = None

    def view(self) -> dict:
        return {"enabled": self.enabled, "current_incident": self.current, "handled_count": len(self.handled),
                "last_handled": self.handled[-5:][::-1], "poll_sec": POLL_SEC, "last_error": self.last_error}


STATE = AutoState()


async def _next_ticket() -> str | None:
    """Oldest New ticket that the agent has never run on."""
    tickets = await remedy.get("/api/incidents", status="New", limit=50)
    for t in sorted(tickets, key=lambda x: x["created_at"]):
        iid = t["incident_id"]
        if iid in STATE.skipped or iid in hub.ACTIVE_BY_INCIDENT:
            continue
        runs = await remedy.get(f"/api/incidents/{iid}/runs")
        if runs:
            STATE.skipped.add(iid)  # someone already ran the agent on it
            continue
        return iid
    return None


async def loop() -> None:
    while True:
        try:
            if STATE.enabled and not hub.ACTIVE_BY_INCIDENT:
                iid = await _next_ticket()
                if iid:
                    STATE.current = iid
                    log.info("auto mode: running agent on %s", iid)
                    started = await runner.start_run(iid)
                    run = hub.RUNS.get(int(started["run_id"]))
                    while run and not run.done:
                        await asyncio.sleep(1)
                    STATE.handled.append(iid)
                    STATE.skipped.add(iid)
                    STATE.current = None
                    STATE.last_error = None
        except Exception as e:  # noqa: BLE001 - keep the loop alive
            STATE.current = None
            STATE.last_error = f"{type(e).__name__}: {e}"[:300]
            log.warning("auto mode error: %s", STATE.last_error)
        await asyncio.sleep(POLL_SEC)
