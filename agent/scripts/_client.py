"""Shared helper for the automation scripts: talks to remedy-api (same API the agent uses)."""
import os
import sys

import httpx

API = os.getenv("REMEDY_API_URL", "http://localhost:5080").rstrip("/")
TOKEN = os.getenv("SERVICE_TOKEN", "change-me-service-token")


def _check(r: httpx.Response):
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", r.text)
        except ValueError:
            msg = r.text
        raise RuntimeError(f"{r.request.method} {r.request.url.path} -> {r.status_code}: {msg}")
    return r.json()


def get(path: str, **params):
    with httpx.Client(timeout=60) as c:
        return _check(c.get(f"{API}{path}", params={k: v for k, v in params.items() if v is not None}))


def post(path: str, body: dict):
    with httpx.Client(timeout=60) as c:
        return _check(c.post(f"{API}{path}", json=body, headers={"X-Service-Token": TOKEN}))


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)
