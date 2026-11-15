"""Small client for remedy-api, used by the orchestrator for governance writes
(run log, triage, status, resolve). The LLM never gets these as tools."""
from __future__ import annotations

from typing import Any

import httpx

from . import config


class RemedyError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


async def call(method: str, path: str, *, params: dict | None = None, body: Any = None) -> Any:
    headers = {"X-Service-Token": config.SERVICE_TOKEN}
    async with httpx.AsyncClient(base_url=config.REMEDY_API_URL, timeout=30) as c:
        r = await c.request(method, path, json=body, headers=headers,
                            params={k: v for k, v in (params or {}).items() if v is not None})
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", r.text)
        except ValueError:
            msg = r.text
        raise RemedyError(r.status_code, msg)
    return r.json()


async def get(path: str, **params) -> Any:
    return await call("GET", path, params=params)


async def post(path: str, body: Any = None) -> Any:
    return await call("POST", path, body=body if body is not None else {})


async def patch(path: str, body: Any) -> Any:
    return await call("PATCH", path, body=body)
