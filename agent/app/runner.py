"""Agent loop for one incident.

1 load ticket -> 2 incident-triage -> 3 find similar -> 4 choose skill -> 5 follow skill (MCP tools)
-> 6 analysis worklog -> 7 propose_action (or escalate) -> 8 status Pending (waiting approval)

Governance writes (run log, triage fields, status, resolve) are done here by code, not by the LLM.
The LLM / mock planner can only read, add a worklog and create ONE pending action request.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import openai

from . import config, hub, llm, remedy, skills
from .mcp_client import McpTools, ToolError, connect
from .mock_planner import PLANNERS, Decision, escalate
from .triage import classify, extract_entities

log = logging.getLogger("agent")


class ToolLimitReached(Exception):
    pass


class RunContext:
    def __init__(self, run_id: int, incident_id: str, mode: str, mcp: McpTools):
        self.run_id = run_id
        self.incident_id = incident_id
        self.mode = mode
        self.mcp = mcp
        self.tool_calls = 0
        self.incident: dict = {}
        self.entities: dict = {}
        self.similar: list[dict] = []
        self.triage: dict = {}
        self.skill: skills.Skill | None = None
        self.proposal: dict | None = None
        self.worklog_written = False
        self.root_cause: str | None = None
        self.summary: str = ""

    async def emit(self, step_type: str, content: dict) -> None:
        await hub.emit(self.run_id, step_type, content)

    async def think(self, text: str) -> None:
        await self.emit("thought", {"text": text})

    async def call(self, tool: str, args: dict, *, final: bool = False) -> dict:
        # keep 2 calls in reserve for the worklog + proposal
        limit = config.MAX_TOOL_CALLS if final else config.MAX_TOOL_CALLS - 2
        if self.tool_calls >= limit:
            raise ToolLimitReached(f"tool call limit reached ({self.tool_calls}/{config.MAX_TOOL_CALLS})")
        self.tool_calls += 1
        await self.emit("tool_call", {"tool": tool, "args": args, "n": self.tool_calls, "max": config.MAX_TOOL_CALLS})
        try:
            res = await self.mcp.call(tool, args)
            ok = True
        except ToolError as e:
            res, ok = {"error": str(e)}, False
        await self.emit("tool_result", {"tool": tool, "ok": ok, "result": res})
        return res if isinstance(res, dict) else {"result": res}

    async def load_skill(self, name: str, phase: str = "diagnosis") -> skills.Skill | None:
        s = skills.get(name)
        if s:
            if phase == "diagnosis":
                self.skill = s
            await self.emit("skill_loaded", {"skill": s.name, "description": s.description, "phase": phase,
                                             "steps": s.steps, "content": s.body})
        return s


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
async def _set_status(ctx: RunContext, status: str, note: str) -> None:
    try:
        await remedy.patch(f"/api/incidents/{ctx.incident_id}/status", {"status": status, "user": "agent", "note": note})
    except remedy.RemedyError as e:
        await ctx.think(f"Status not changed to {status}: {e.message}")


def _worklog_text(ctx: RunContext, d: Decision) -> str:
    lines = [f"**Agent analysis** - skill `{ctx.skill.name if ctx.skill else 'none'}`, mode `{ctx.mode}`", "",
             f"**Root cause hypothesis:** {d.root_cause}", "", "**Evidence:**"]
    lines += [f"- {e}" for e in d.evidence] or ["- (none)"]
    lines += ["", f"**Proposed action:** `{d.action_type}` {json.dumps(d.params, ensure_ascii=False)} "
                  f"(risk {d.risk}) - waiting for human approval.", f"**Reason:** {d.reason}"]
    return "\n".join(lines)


async def _propose(ctx: RunContext, d: Decision) -> None:
    res = await ctx.call("propose_action", {"incident_id": ctx.incident_id, "run_id": ctx.run_id,
                                            "action_type": d.action_type, "params": d.params,
                                            "risk": d.risk, "reason": d.reason}, final=True)
    if "error" not in res:
        ctx.proposal = res
        await ctx.emit("proposal", {"action_id": res.get("action_id"), "action_type": d.action_type,
                                    "params": res.get("params", d.params), "risk": res.get("risk", d.risk),
                                    "reason": d.reason, "status": "Pending"})


async def _mock_diagnose(ctx: RunContext) -> None:
    cat = ctx.incident.get("category_tier3") or ctx.triage.get("category_tier3")
    if ctx.triage.get("injection_suspected"):
        await ctx.think("Prompt-injection guard: the ticket contains instructions to the system. They are ignored; "
                        "no MES change will be proposed. Escalating for human review.")
        d = escalate("MES Application Support", "Ticket text contains instructions to the agent (possible prompt injection)",
                     "Ticket asks the system to bypass approval / change data. Ignored. Human must review the request.",
                     [f"Summary: {ctx.incident.get('summary')}"])
    else:
        name = skills.CATEGORY_TO_SKILL.get(cat or "")
        names = ", ".join(s["name"] for s in skills.catalog())
        await ctx.think(f"Skill catalog (names + descriptions only): {names}. Category '{cat}' -> "
                        f"{'skill ' + name if name else 'no runbook skill'}.")
        if name:
            await ctx.load_skill(name)
            d = await PLANNERS[name](ctx)
        else:
            group = ctx.incident.get("assigned_group") or ctx.triage.get("assigned_group") or "MES Application Support"
            d = escalate(group, f"No automated runbook for category {cat}",
                         f"Category '{cat}' has no agent skill; handing over to {group}.",
                         [f"Similar: {s.get('incident_id')} -> {s.get('resolution')}" for s in ctx.similar[:2]])
    ctx.root_cause, ctx.summary = d.root_cause, d.summary or d.reason
    wl = await ctx.call("add_worklog", {"incident_id": ctx.incident_id, "text": _worklog_text(ctx, d),
                                        "log_type": "agent_analysis"}, final=True)
    ctx.worklog_written = "error" not in wl
    await _propose(ctx, d)


async def _chat(ctx: RunContext, client, **kw):
    """One LLM call. Rate limits (429) are shown in the trace and waited out instead of failing the run."""
    for _ in range(8):
        try:
            return await client.chat.completions.create(model=config.LLM_MODEL, **config.llm_extra(), **kw)
        except openai.RateLimitError as e:
            try:
                wait = float(e.response.headers.get("retry-after", "6"))
            except (AttributeError, ValueError):
                wait = 6.0
            wait = min(max(wait, 1.0), 30.0)
            await ctx.think(f"{config.llm_provider()} rate limit reached (free tier tokens/minute) - waiting {wait:.0f} s.")
            await asyncio.sleep(wait)
    raise RuntimeError("LLM rate limit did not clear")


async def _llm_diagnose(ctx: RunContext) -> None:
    client = llm.client(max_retries=0)

    # Phase 1 - the LLM only sees skill names + descriptions and must pick one (progressive loading)
    resp = await _chat(ctx, client, messages=llm.choose_skill_messages(ctx.incident, ctx.triage, ctx.similar),
                       response_format={"type": "json_object"}, temperature=0)
    pick = llm.first_json(resp.choices[0].message.content or "") or {}
    name = str(pick.get("skill", "none")).strip()
    await ctx.think(f"LLM chose skill: {name}" + (f" - {pick['reason']}" if pick.get("reason") else ""))
    if name not in llm.REMEDIATION_SKILLS:
        await ctx.think("No runbook skill fits -> safe default (escalate to the triaged group).")
        await _mock_diagnose(ctx)
        return
    skill = await ctx.load_skill(name)

    # Phase 2 - follow the skill with only the tools it mentions
    names = llm.skill_tool_names(skill, {t.name for t in ctx.mcp.tools})
    tools = llm.openai_tools(ctx.mcp.tools, names)
    await ctx.think(f"Tools given to the LLM for this skill: {', '.join(sorted(names))}")
    messages = llm.diagnose_messages(ctx.incident, ctx.triage, ctx.entities, ctx.similar, skill,
                                     config.MAX_TOOL_CALLS - ctx.tool_calls)
    final_text = ""
    for _ in range(12):
        resp = await _chat(ctx, client, messages=messages, tools=tools, tool_choice="auto", temperature=0.1)
        msg = resp.choices[0].message
        if msg.content and msg.content.strip() and msg.tool_calls:
            await ctx.think(msg.content.strip()[:1500])
        if not msg.tool_calls:
            final_text = msg.content or ""
            break
        messages.append({"role": "assistant", "content": msg.content or "",
                         "tool_calls": [{"id": tc.id, "type": "function",
                                         "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                                        for tc in msg.tool_calls]})
        stop = False
        for tc in msg.tool_calls:
            tname = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except ValueError:
                args = {}
            try:
                if tname not in names:
                    result: dict = {"error": f"tool {tname} is not available for this skill"}
                elif tname in llm.WRITE_TOOLS:
                    args["incident_id"] = ctx.incident_id  # the agent may only write to its own incident
                    if tname == "propose_action":
                        if ctx.proposal:
                            result = {"error": "A proposal already exists for this run; only one is allowed."}
                        else:
                            args["run_id"] = ctx.run_id
                            result = await ctx.call(tname, args, final=True)
                            if "error" not in result:
                                ctx.proposal = result
                                await ctx.emit("proposal", {"action_id": result.get("action_id"),
                                                            "action_type": result.get("action_type"),
                                                            "params": result.get("params"), "risk": result.get("risk"),
                                                            "reason": args.get("reason"), "status": "Pending"})
                    else:
                        result = await ctx.call(tname, args, final=True)
                        ctx.worklog_written = ctx.worklog_written or "error" not in result
                else:
                    result = await ctx.call(tname, args)
            except ToolLimitReached as e:
                result, stop = {"error": str(e)}, True
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": llm.compact(result)})
        if stop or ctx.proposal:
            break  # proposal created: skip one more LLM round trip (saves tokens), summarise from the run
    data = llm.first_json(final_text) or {}
    ctx.root_cause = data.get("root_cause") or ctx.root_cause or _root_from_worklog(messages)
    if ctx.proposal:
        ctx.summary = data.get("summary") or (f"Proposed {ctx.proposal.get('action_type')} "
                                              f"{json.dumps(ctx.proposal.get('params'), ensure_ascii=False)}")
    else:
        ctx.summary = data.get("summary") or final_text[:500]
        group = ctx.triage.get("assigned_group") or "MES Application Support"
        await ctx.think(f"LLM finished without a proposal -> escalate to {group} (safe default).")
        d = escalate(group, ctx.root_cause or "Not determined by the agent",
                     (ctx.summary or "Agent could not determine a safe fix.")[:400])
        if not ctx.worklog_written:
            await ctx.call("add_worklog", {"incident_id": ctx.incident_id, "text": _worklog_text(ctx, d)}, final=True)
        await _propose(ctx, d)


def _root_from_worklog(messages: list[dict]) -> str | None:
    """Take the root-cause line from the worklog the LLM wrote, if any."""
    for m in messages:
        for tc in m.get("tool_calls", []) or []:
            if tc["function"]["name"] != "add_worklog":
                continue
            try:
                text = json.loads(tc["function"]["arguments"]).get("text", "")
            except ValueError:
                continue
            for line in text.splitlines():
                if "root cause" in line.lower():
                    return line.split(":", 1)[-1].strip(" *") or None
            return text[:300] or None
    return None


# ---------------------------------------------------------------------------
async def _run(ctx: RunContext) -> None:
    # 1. load ticket
    await ctx.think(f"Run {ctx.run_id} started for {ctx.incident_id} in {ctx.mode} mode "
                    f"(max {config.MAX_TOOL_CALLS} tool calls, {config.TIMEOUT_SEC} s).")
    inc = await ctx.call("get_incident", {"incident_id": ctx.incident_id})
    if "error" in inc:
        raise RuntimeError(inc["error"])
    if inc.get("status") in ("Resolved", "Closed"):
        raise RuntimeError(f"Incident is {inc['status']}; nothing to do")
    ctx.incident = inc
    ctx.entities = extract_entities(inc)
    await ctx.think("Ticket text is treated as data. Entities found: " +
                    ", ".join(f"{k}={v}" for k, v in ctx.entities.items() if v))

    # 2. triage
    await ctx.load_skill("incident-triage", phase="triage")
    tri = None
    if ctx.mode == "llm":
        try:
            tri = await llm.triage(inc)
        except Exception as e:  # noqa: BLE001
            await ctx.emit("error", {"text": f"LLM triage failed ({type(e).__name__}); using rule-based triage."})
    tri = tri or classify(inc)
    ctx.triage = tri.dict()
    await ctx.think(f"Triage: {tri.category_tier1} / {tri.category_tier2} / {tri.category_tier3}, P{tri.priority}, "
                    f"group {tri.assigned_group}. {tri.reason}")
    if not inc.get("category_tier3"):
        try:
            updated = await remedy.patch(f"/api/incidents/{ctx.incident_id}/triage", {
                "category_tier1": tri.category_tier1, "category_tier2": tri.category_tier2,
                "category_tier3": tri.category_tier3, "priority": tri.priority,
                "assigned_group": tri.assigned_group, "user": "agent"})
            ctx.incident.update({k: updated.get(k) for k in ("category_tier1", "category_tier2", "category_tier3",
                                                             "priority", "assigned_group", "status")})
        except remedy.RemedyError as e:
            await ctx.think(f"Triage not saved: {e.message}")
    else:
        await ctx.think(f"Ticket already categorised as '{inc.get('category_tier3')}' - keeping the human triage.")
    await _set_status(ctx, "In Progress", "agent analysing")

    # 3. similar incidents
    sim = await ctx.call("find_similar_incidents", {"incident_id": ctx.incident_id})
    ctx.similar = sim.get("similar", []) if isinstance(sim, dict) else []
    if ctx.similar:
        await ctx.think("Similar past incidents: " + "; ".join(
            f"{s['incident_id']} ({s.get('score')}) fix: {s.get('resolution')}" for s in ctx.similar[:3]))

    # 4-7. choose skill, diagnose, worklog, proposal
    if ctx.mode == "llm" and not ctx.triage.get("injection_suspected"):
        budget = max(config.TIMEOUT_SEC - 20, 20)  # keep time for the mock fallback
        try:
            await asyncio.wait_for(_llm_diagnose(ctx), timeout=budget)
        except ToolLimitReached:
            raise
        except Exception as e:  # noqa: BLE001  (API down, bad key, rate limit, LLM time budget used up)
            log.warning("LLM loop failed: %r", e)
            why = (f"LLM time budget of {budget} s used up" if isinstance(e, asyncio.TimeoutError)
                   else f"{type(e).__name__}: {str(e)[:200]}")
            await ctx.emit("error", {"text": f"LLM failed ({why}). Falling back to mock planner."})
            if not ctx.proposal:
                ctx.mode = "mock"
                await _mock_diagnose(ctx)
    else:
        await _mock_diagnose(ctx)

    # 8. waiting for approval
    if ctx.proposal:
        await _set_status(ctx, "Pending", f"waiting for approval of action #{ctx.proposal.get('action_id')}")


async def execute_run(run_id: int, incident_id: str, mode: str) -> None:
    state = hub.RUNS[run_id]
    status, err = "Completed", None
    ctx: RunContext | None = None
    try:
        async with connect() as mcp:
            ctx = RunContext(run_id, incident_id, mode, mcp)
            await asyncio.wait_for(_run(ctx), timeout=config.TIMEOUT_SEC)
    except asyncio.TimeoutError:
        status, err = "Timeout", f"Run stopped after {config.TIMEOUT_SEC} s timeout"
    except ToolLimitReached as e:
        status, err = "Failed", str(e)
    except Exception as e:  # noqa: BLE001
        log.exception("run failed")
        status, err = "Failed", f"{type(e).__name__}: {e}"
    if err:
        try:
            await hub.emit(run_id, "error", {"text": err})
        except Exception:  # noqa: BLE001
            pass
    result = {
        "status": status,
        "skill_used": ctx.skill.name if ctx and ctx.skill else None,
        "summary": (ctx.summary if ctx else "") or err or "",
        "root_cause": ctx.root_cause if ctx else None,
        "tool_calls": ctx.tool_calls if ctx else 0,
        "action_id": (ctx.proposal or {}).get("action_id") if ctx else None,
        "llm_mode": ctx.mode if ctx else mode,
    }
    try:
        await hub.emit(run_id, "final", result)
        await remedy.post(f"/api/agent/runs/{run_id}/finish", {k: result[k] for k in
                                                               ("status", "skill_used", "summary", "root_cause", "tool_calls")})
    except Exception:  # noqa: BLE001
        log.exception("could not finish run %s", run_id)
    await state.finish(result)
    hub.ACTIVE_BY_INCIDENT.pop(incident_id, None)


async def start_run(incident_id: str, mode: str | None = None) -> dict:
    incident_id = incident_id.strip().upper()
    if incident_id in hub.ACTIVE_BY_INCIDENT:
        rid = hub.ACTIVE_BY_INCIDENT[incident_id]
        return {"run_id": rid, "incident_id": incident_id, "status": "Running", "already_running": True}
    mode = mode if mode in ("llm", "mock") else config.llm_mode()
    if mode == "llm" and not config.LLM_API_KEY:
        mode = "mock"
    run = await remedy.post("/api/agent/runs", {"incident_id": incident_id, "llm_mode": mode})
    rid = int(run["run_id"])
    hub.RUNS[rid] = hub.RunState(rid, incident_id)
    hub.ACTIVE_BY_INCIDENT[incident_id] = rid
    asyncio.create_task(execute_run(rid, incident_id, mode))
    return {"run_id": rid, "incident_id": incident_id, "status": "Running", "llm_mode": mode}


# ---------------------------------------------------------------------------
# Verify after a human-approved action was executed, then resolve
# ---------------------------------------------------------------------------
async def verify_action(action_id: int) -> dict:
    action = await remedy.get(f"/api/actions/{action_id}")
    run_id = action.get("run_id")
    p = action.get("params") or {}
    atype = action["action_type"]

    async def note(step_type: str, content: dict) -> None:
        if run_id:
            await hub.emit(int(run_id), step_type, content)

    if action["status"] != "Executed":
        await note("verify", {"ok": False, "text": f"Action #{action_id} is {action['status']}: {action.get('result')}"})
        return {"ok": False, "resolved": False, "reason": f"action is {action['status']}", "result": action.get("result")}

    checks: list[str] = []
    ok = False
    async with connect() as mcp:
        async def read(tool: str, args: dict) -> dict:
            await note("tool_call", {"tool": tool, "args": args, "phase": "verify"})
            try:
                r = await mcp.call(tool, args)
            except ToolError as e:
                r = {"error": str(e)}
            await note("tool_result", {"tool": tool, "ok": "error" not in r, "result": r, "phase": "verify"})
            return r

        if atype == "release_lot_hold":
            lot = await read("get_lot", {"lot_id": p["lot_id"]})
            ok = lot.get("status") == "Waiting" and not lot.get("hold_code")
            checks.append(f"lot {p['lot_id']} status {lot.get('status')}, hold code {lot.get('hold_code') or '-'}")
        elif atype == "set_equipment_state":
            eq = await read("get_equipment", {"equipment_id": p["equipment_id"]})
            ok = eq.get("state") == p["state"] and (not p.get("recipe") or eq.get("current_recipe") == p["recipe"])
            checks.append(f"{p['equipment_id']} state {eq.get('state')}, recipe {eq.get('current_recipe')}")
        elif atype == "reset_interface":
            eq = await read("get_equipment", {"equipment_id": p["equipment_id"]})
            age = eq.get("heartbeat_age_sec")
            ok = eq.get("interface_status") == "Online" and age is not None and int(age) < 120
            checks.append(f"{p['equipment_id']} interface {eq.get('interface_status')}, heartbeat age {eq.get('heartbeat_age_sec')} s")
        elif atype == "grant_user_role":
            roles = await read("get_user_roles", {"user_name": p["user_name"]})
            ok = any(r["role"] == p["role"] and r["operation"] == p["operation"] for r in roles.get("roles", []))
            checks.append(f"{p['user_name']} has {p['role']}@{p['operation']}: {ok}")
        elif atype == "escalate_to_group":
            inc = await read("get_incident", {"incident_id": action["incident_id"]})
            ok = inc.get("assigned_group") == p.get("group_name")
            checks.append(f"incident assigned to {inc.get('assigned_group')}, status {inc.get('status')}")

    check_text = "; ".join(checks)
    await note("verify", {"ok": ok, "action_id": action_id, "action_type": atype, "text": f"Verify: {check_text}"})

    if atype == "escalate_to_group":
        await note("final", {"status": "Escalated", "summary": f"Escalated to {p.get('group_name')}. "
                                                               "Not resolved by the agent (human team owns the fix)."})
        return {"ok": ok, "resolved": False, "escalated": True, "checks": checks}
    if not ok:
        try:
            await remedy.post(f"/api/incidents/{action['incident_id']}/worklogs",
                              {"author": "agent", "log_type": "agent_analysis",
                               "text": f"Verification FAILED after action #{action_id}: {check_text}. Incident left open."})
        except remedy.RemedyError:
            pass
        return {"ok": False, "resolved": False, "checks": checks}

    root = None
    if run_id:
        try:
            root = (await remedy.get(f"/api/agent/runs/{run_id}")).get("root_cause")
        except remedy.RemedyError:
            pass
    resolution = (f"{action.get('result')}. Approved by {action.get('decided_by')} (action #{action_id}). "
                  f"Verified by agent: {check_text}.")
    await remedy.post(f"/api/incidents/{action['incident_id']}/resolve", {
        "root_cause": root or action.get("reason"), "resolution": resolution,
        "resolved_by": "agent_approved", "user": "agent"})
    await note("final", {"status": "Resolved", "summary": f"Incident resolved after verification. {check_text}",
                         "root_cause": root})
    return {"ok": True, "resolved": True, "checks": checks, "root_cause": root, "resolution": resolution}
