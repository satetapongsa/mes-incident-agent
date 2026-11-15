"""In-memory fan-out of agent steps for SSE, plus persistence of every step to AGENT_STEPS."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from . import remedy


class RunState:
    def __init__(self, run_id: int, incident_id: str):
        self.run_id = run_id
        self.incident_id = incident_id
        self.steps: list[dict] = []
        self.done = False
        self.result: dict = {}
        self._cond = asyncio.Condition()

    async def add(self, step: dict) -> None:
        async with self._cond:
            self.steps.append(step)
            self._cond.notify_all()

    async def finish(self, result: dict) -> None:
        async with self._cond:
            self.done = True
            self.result = result
            self._cond.notify_all()

    async def wait(self, index: int, timeout: float) -> None:
        async with self._cond:
            if len(self.steps) > index or self.done:
                return
            try:
                await asyncio.wait_for(self._cond.wait(), timeout)
            except asyncio.TimeoutError:
                pass


RUNS: dict[int, RunState] = {}
ACTIVE_BY_INCIDENT: dict[str, int] = {}


def _trim(value: Any, limit: int = 6000) -> Any:
    s = json.dumps(value, default=str)
    if len(s) <= limit:
        return value
    return {"truncated": True, "preview": s[:limit]}


async def emit(run_id: int, step_type: str, content: dict) -> dict:
    """Persist the step via remedy-api (agent_pkg.add_step) and publish it to SSE listeners."""
    content = _trim(content)
    r = await remedy.post(f"/api/agent/runs/{run_id}/steps", {"step_type": step_type, "content": content})
    step = {"run_id": run_id, "step_no": r["step_no"], "step_type": step_type, "content": content,
            "created_at": datetime.now(timezone.utc).isoformat()}
    state = RUNS.get(run_id)
    if state:
        await state.add(step)
    return step
