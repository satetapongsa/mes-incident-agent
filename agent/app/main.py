"""Agent service (FastAPI): runs, SSE trace, verify-after-approval, analysis, skills."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import analysis, config, hub, remedy, runner, skills

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = FastAPI(title="MES Incident Agent", version="1.0")


class RunReq(BaseModel):
    incident_id: str = Field(pattern=r"^(?i:INC\d{9})$")
    mode: str | None = Field(default=None, description="llm | mock (default from LLM_MODE)")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "agent", "llm_mode": config.llm_mode(),
            "model": config.XAI_MODEL if config.llm_mode() == "llm" else None,
            "provider": "xAI Grok" if config.llm_mode() == "llm" else "mock (rule-based)",
            "max_tool_calls": config.MAX_TOOL_CALLS, "timeout_sec": config.TIMEOUT_SEC,
            "skills": len(skills.load_all())}


@app.post("/runs")
async def create_run(req: RunReq):
    try:
        return await runner.start_run(req.incident_id, req.mode)
    except remedy.RemedyError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


@app.get("/runs/{run_id}")
async def get_run(run_id: int):
    try:
        run = await remedy.get(f"/api/agent/runs/{run_id}")
    except remedy.RemedyError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    state = hub.RUNS.get(run_id)
    run["live"] = bool(state and not state.done)
    return run


@app.get("/runs/{run_id}/stream")
async def stream(run_id: int):
    async def events():
        state = hub.RUNS.get(run_id)
        if state is None:  # run from before a restart: replay from the database
            try:
                run = await remedy.get(f"/api/agent/runs/{run_id}")
            except remedy.RemedyError as e:
                yield f"event: error\ndata: {json.dumps({'error': e.message})}\n\n"
                return
            for s in run.get("steps", []):
                yield f"event: step\ndata: {json.dumps(s, default=str)}\n\n"
            yield f"event: done\ndata: {json.dumps({'status': run.get('status')})}\n\n"
            return
        i = 0
        while True:
            while i < len(state.steps):
                yield f"event: step\ndata: {json.dumps(state.steps[i], default=str)}\n\n"
                i += 1
            if state.done:
                yield f"event: done\ndata: {json.dumps(state.result, default=str)}\n\n"
                return
            await state.wait(i, timeout=15)
            if i >= len(state.steps) and not state.done:
                yield ": keep-alive\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/actions/{action_id}/verify")
async def verify(action_id: int):
    """Called after a human approved and remedy-api executed the action: re-check MES state, then resolve."""
    try:
        return await runner.verify_action(action_id)
    except remedy.RemedyError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


@app.post("/analysis/recurring")
async def recurring_analysis():
    return await analysis.recurring_report()


@app.get("/skills")
async def list_skills():
    return [{"name": s.name, "description": s.description, "steps": s.steps} for s in skills.load_all().values()]


@app.get("/skills/{name}")
async def get_skill(name: str):
    s = skills.get(name)
    if not s:
        raise HTTPException(404, f"skill {name} not found")
    with open(s.path, encoding="utf-8") as f:
        raw = f.read()
    return {"name": s.name, "description": s.description, "steps": s.steps, "body": s.body, "raw": raw}


@app.on_event("startup")
async def _startup():
    logging.getLogger("agent").info("Agent started: mode=%s model=%s skills=%s", config.llm_mode(),
                                    config.XAI_MODEL, ", ".join(skills.load_all()))
    asyncio.get_running_loop()
