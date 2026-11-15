"""Factory simulator.

- Every HEARTBEAT_INTERVAL_SEC: sends equipment heartbeats (healthy tools only), like the equipment integration layer.
- If SIM_ENABLED=true, every SIM_INTERVAL_SEC: injects a random MES failure. remedy-api / sim_pkg breaks the MES
  data and opens a ticket written like an operator would (short, vague, sometimes Thai-English).
"""
import os
import random
import time
import pathlib
import logging

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s simulator %(levelname)s %(message)s")
log = logging.getLogger()

API = os.getenv("REMEDY_API_URL", "http://localhost:5080").rstrip("/")
TOKEN = os.getenv("SERVICE_TOKEN", "change-me-service-token")
ENABLED = os.getenv("SIM_ENABLED", "false").lower() in ("1", "true", "yes", "on")
INTERVAL = int(os.getenv("SIM_INTERVAL_SEC", "300"))
HB_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL_SEC", "30"))
ALIVE = pathlib.Path("/tmp/simulator.alive")

# weights: the common problems happen more often
SCENARIOS = [
    ("lot-hold-stuck", 5),
    ("trackin-recipe-mismatch", 4),
    ("interface-timeout", 3),
    ("equipment-heartbeat-stale", 2),
    ("user-permission-missing", 2),
    ("db-slow-query", 1),
]


def post(client: httpx.Client, path: str) -> dict:
    r = client.post(f"{API}{path}", headers={"X-Service-Token": TOKEN}, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {r.text[:200]}")
    return r.json()


def main() -> None:
    log.info("started: injection %s (every %s s), heartbeat every %s s", "ON" if ENABLED else "OFF", INTERVAL, HB_INTERVAL)
    next_inject = time.time() + INTERVAL
    with httpx.Client() as client:
        while True:
            try:
                hb = post(client, "/api/mes/heartbeat")
                log.debug("heartbeat for %s equipment", hb.get("updated"))
            except Exception as e:  # noqa: BLE001
                log.warning("heartbeat failed: %s", e)
            if ENABLED and time.time() >= next_inject:
                name = random.choices([s for s, _ in SCENARIOS], weights=[w for _, w in SCENARIOS])[0]
                try:
                    res = post(client, f"/api/simulate/{name}")
                    log.info("injected %s -> %s (%s)", name, res.get("incident_id"), res.get("detail"))
                except Exception as e:  # noqa: BLE001
                    log.warning("inject %s failed: %s", name, e)
                next_inject = time.time() + INTERVAL
            ALIVE.touch()
            time.sleep(HB_INTERVAL)


if __name__ == "__main__":
    main()
