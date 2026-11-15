"""Deterministic, rule-based planner (mock mode).

It follows the chosen SKILL.md: before each tool call it emits the matching
"Diagnosis steps" line from the skill as a thought, calls the same MCP tools the
LLM would call, and applies the skill's decision rules. No network / API key needed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

from .skills import Skill


@dataclass
class Decision:
    root_cause: str
    action_type: str
    params: dict
    risk: str
    reason: str
    evidence: list[str] = field(default_factory=list)
    summary: str = ""


class Ctx(Protocol):
    skill: Skill | None
    incident: dict
    entities: dict
    similar: list[dict]

    async def call(self, tool: str, args: dict) -> dict: ...
    async def think(self, text: str) -> None: ...


def _t(ts: Any) -> str:
    s = str(ts or "")
    return s[:16].replace("T", " ") + " UTC" if len(s) >= 16 else s


async def _step(ctx: Ctx, n: int) -> None:
    if ctx.skill and ctx.skill.step(n):
        await ctx.think(f"[{ctx.skill.name} step {n}] {ctx.skill.step(n)}")


def escalate(group: str, root_cause: str, reason: str, evidence: list[str] | None = None) -> Decision:
    return Decision(
        root_cause=root_cause,
        action_type="escalate_to_group",
        params={"group_name": group, "comment": reason[:400]},
        risk="low",
        reason=reason,
        evidence=evidence or [],
        summary=f"Escalate to {group}: {reason}",
    )


def _similar_evidence(ctx: Ctx) -> list[str]:
    out = []
    for s in ctx.similar[:2]:
        out.append(f"Similar {s.get('incident_id')} (score {s.get('score')}): {s.get('root_cause')} -> {s.get('resolution')}")
    return out


# ---------------------------------------------------------------------------
async def lot_hold_stuck(ctx: Ctx) -> Decision:
    lot_id = ctx.entities.get("lot_id")
    if not lot_id:
        return escalate("MES Application Support", "Lot id missing in ticket", "Ticket does not contain a lot id; cannot check the hold.")
    await _step(ctx, 1)
    lot = await ctx.call("get_lot", {"lot_id": lot_id})
    if "error" in lot:
        return escalate("MES Application Support", "Lot not found in MES", f"Lot {lot_id} not found: {lot['error']}")
    ev = [f"Lot {lot_id} status {lot.get('status')}, hold code {lot.get('hold_code')} ({lot.get('hold_reason')})"]

    await _step(ctx, 2)
    hist = await ctx.call("get_lot_history", {"lot_id": lot_id})
    events = hist.get("events", []) if isinstance(hist, dict) else []
    last_hold = max((i for i, e in enumerate(events) if e.get("event") == "HOLD"), default=-1)
    review = next((e for e in events[last_hold + 1:] if e.get("event") == "SPC_REVIEW"), None) if last_hold >= 0 else None
    if last_hold >= 0:
        h = events[last_hold]
        ev.append(f"HOLD at {_t(h.get('created_at'))} by {h.get('user_name')}: {h.get('comments')}")

    await _step(ctx, 3)
    if review:
        ev.append(f"SPC_REVIEW at {_t(review.get('created_at'))} by {review.get('user_name')}: {review.get('comments')}")
    else:
        ev.append("No SPC_REVIEW event after the last HOLD")

    await _step(ctx, 4)
    ev += _similar_evidence(ctx)

    if lot.get("status") != "Hold":
        return escalate("MES Application Support", "Lot is no longer on hold",
                        f"Lot {lot_id} is {lot.get('status')} now; nothing to release. Please confirm with the line and close.", ev)
    code = str(lot.get("hold_code") or "")
    released = review and "disposition: release" in str(review.get("comments", "")).lower()
    if code.startswith("SPC") and released:
        await ctx.think("Decision rule: SPC-OOC hold + completed SPC review with disposition RELEASE -> propose release_lot_hold (medium).")
        return Decision(
            root_cause="SPC disposition (RELEASE) was recorded but the MES hold release transaction was never posted.",
            action_type="release_lot_hold",
            params={"lot_id": lot_id,
                    "comment": f"SPC review completed by {review.get('user_name')} at {_t(review.get('created_at'))}, disposition RELEASE"},
            risk="medium",
            reason=f"Lot {lot_id} is on {code} hold but the SPC review by {review.get('user_name')} already released it.",
            evidence=ev,
            summary=f"Release SPC hold on {lot_id} (review already done).",
        )
    await ctx.think("Decision rule: hold is not SPC or has no RELEASE disposition -> do not release, escalate to Quality Engineering.")
    return escalate("Quality Engineering", f"Lot on {code} hold without a completed RELEASE disposition",
                    f"Lot {lot_id} hold {code} has no SPC review with disposition RELEASE; QE must decide.", ev)


# ---------------------------------------------------------------------------
async def trackin_recipe_mismatch(ctx: Ctx) -> Decision:
    lot_id = ctx.entities.get("lot_id")
    eq_id = ctx.entities.get("equipment_id")
    if not lot_id:
        return escalate("Equipment Automation", "Lot id missing in ticket", "Ticket has no lot id; cannot compare recipes.")
    await _step(ctx, 1)
    lot = await ctx.call("get_lot", {"lot_id": lot_id})
    if "error" in lot:
        return escalate("Equipment Automation", "Lot not found", f"Lot {lot_id} not found: {lot['error']}")
    eq_id = eq_id or lot.get("equipment_id")
    if not eq_id:
        return escalate("Equipment Automation", "Equipment unknown", f"No equipment linked to lot {lot_id}.")
    ev = [f"Lot {lot_id} at {lot.get('operation')} requires recipe {lot.get('recipe_required')}"]

    await _step(ctx, 2)
    eq = await ctx.call("get_equipment", {"equipment_id": eq_id})
    if "error" in eq:
        return escalate("Equipment Automation", "Equipment not found", f"Equipment {eq_id} not found: {eq['error']}")
    ev.append(f"{eq_id}: recipe {eq.get('current_recipe')}, state {eq.get('state')}, interface {eq.get('interface_status')}, "
              f"running lots {eq.get('running_lots')}")

    await _step(ctx, 3)
    hist = await ctx.call("get_lot_history", {"lot_id": lot_id})
    fails = [e for e in hist.get("events", []) if e.get("event") == "TRACKIN_FAIL"] if isinstance(hist, dict) else []
    if fails:
        ev.append(f"TRACKIN_FAIL at {_t(fails[-1].get('created_at'))}: {fails[-1].get('comments')}")

    await _step(ctx, 4)
    ev += _similar_evidence(ctx)

    required = lot.get("recipe_required")
    if eq.get("current_recipe") == required:
        return escalate("Equipment Automation", "No recipe mismatch found",
                        f"{eq_id} already has the required recipe {required}; needs manual check.", ev)
    if eq.get("state") in ("Down", "Engineering"):
        return escalate("Equipment Engineering", f"Equipment is {eq.get('state')}",
                        f"{eq_id} is {eq.get('state')}; should not run production lots.", ev)
    if int(eq.get("running_lots") or 0) > 0:
        await ctx.think("Decision rule: a lot is running on the equipment -> never change recipe during a run, escalate.")
        return escalate("Equipment Automation", "Recipe mismatch but equipment is running another lot",
                        f"{eq_id} has a running lot; recipe change must be planned by Equipment Automation.", ev)
    if eq.get("operation") != lot.get("operation"):
        return escalate("Equipment Automation", "Wrong equipment for the operation",
                        f"{eq_id} runs {eq.get('operation')} but lot is at {lot.get('operation')}.", ev)
    await ctx.think("Decision rule: recipe differs, equipment idle and available -> propose set_equipment_state with the required recipe (medium).")
    return Decision(
        root_cause=f"{eq_id} kept the previous product recipe ({eq.get('current_recipe')}) after changeover.",
        action_type="set_equipment_state",
        params={"equipment_id": eq_id, "state": "Standby", "recipe": required},
        risk="medium",
        reason=f"Lot {lot_id} needs {required} but {eq_id} has {eq.get('current_recipe')}; equipment is idle, safe to load recipe.",
        evidence=ev,
        summary=f"Load recipe {required} on {eq_id}.",
    )


# ---------------------------------------------------------------------------
async def equipment_heartbeat_stale(ctx: Ctx) -> Decision:
    eq_id = ctx.entities.get("equipment_id")
    if not eq_id:
        return escalate("Equipment Automation", "Equipment id missing", "Ticket has no equipment id.")
    await _step(ctx, 1)
    eq = await ctx.call("get_equipment", {"equipment_id": eq_id})
    if "error" in eq:
        return escalate("Equipment Automation", "Equipment not found", f"Equipment {eq_id} not found: {eq['error']}")
    age = int(eq.get("heartbeat_age_sec") or 0)
    ev = [f"{eq_id}: state {eq.get('state')}, interface {eq.get('interface_status')}, heartbeat age {age // 60} min {age % 60} s"]

    await _step(ctx, 2)
    allq = await ctx.call("list_equipment", {})
    stale = [e["equipment_id"] for e in allq.get("equipment", []) if int(e.get("heartbeat_age_sec") or 0) > 600]
    ev.append(f"Tools with heartbeat > 10 min: {', '.join(stale) or 'none'}")

    await _step(ctx, 3)
    ev += _similar_evidence(ctx)

    if age <= 600:
        return escalate("Equipment Automation", "Heartbeat is normal", f"{eq_id} heartbeat is {age} s old (OK); check dashboard.", ev)
    if len(stale) > 3:
        return escalate("Equipment Automation", "Plant-wide heartbeat loss",
                        f"{len(stale)} tools are stale at the same time; integration server problem, not one tool.", ev)
    if eq.get("state") == "Down":
        return escalate("Equipment Engineering", "Equipment down", f"{eq_id} is Down.", ev)
    await ctx.think("Decision rule: only this tool stale, Productive, interface Online -> equipment agent hung, propose reset_interface (medium).")
    return Decision(
        root_cause=f"Equipment agent on {eq_id} stopped sending heartbeats; MES shows a stale Productive state.",
        action_type="reset_interface",
        params={"equipment_id": eq_id},
        risk="medium",
        reason=f"{eq_id} heartbeat is {age // 60} min old while state is Productive; only this tool is affected.",
        evidence=ev,
        summary=f"Reset equipment interface on {eq_id}.",
    )


# ---------------------------------------------------------------------------
async def interface_timeout(ctx: Ctx) -> Decision:
    eq_id = ctx.entities.get("equipment_id")
    lot_id = ctx.entities.get("lot_id")
    if not eq_id:
        return escalate("Equipment Automation", "Equipment id missing", "Ticket has no equipment id.")
    await _step(ctx, 1)
    eq = await ctx.call("get_equipment", {"equipment_id": eq_id})
    if "error" in eq:
        return escalate("Equipment Automation", "Equipment not found", f"Equipment {eq_id} not found: {eq['error']}")
    ev = [f"{eq_id}: interface {eq.get('interface_status')}, state {eq.get('state')}, running lots {eq.get('running_lots')}"]

    await _step(ctx, 2)
    if lot_id:
        hist = await ctx.call("get_lot_history", {"lot_id": lot_id})
        fails = [e for e in hist.get("events", []) if e.get("event") == "TRACKIN_FAIL"] if isinstance(hist, dict) else []
        if fails:
            ev.append(f"Lot {lot_id} TRACKIN_FAIL: {fails[-1].get('comments')}")

    await _step(ctx, 3)
    rec = await ctx.call("get_recurring_issues", {})
    hit = next((r for r in rec.get("recurring", []) if r.get("ci_name") == eq_id and r.get("category_tier3") == "SECS-GEM Timeout"), None)
    if hit:
        ev.append(f"Recurring offender: {eq_id} had {hit.get('occurrences')} SECS-GEM timeouts in 30 days "
                  f"(top root cause: {hit.get('top_root_cause')}) -> recommend a problem ticket.")

    await _step(ctx, 4)
    ev += _similar_evidence(ctx)

    if eq.get("interface_status") == "Online":
        return escalate("Equipment Automation", "Interface is online", f"{eq_id} interface is Online now; needs manual check.", ev)
    if eq.get("state") == "Down":
        return escalate("Equipment Engineering", "Equipment down", f"{eq_id} is Down (hardware).", ev)
    await ctx.think("Decision rule: interface Timeout and equipment not Down -> propose reset_interface (medium).")
    return Decision(
        root_cause=f"GEM/HSMS connection of {eq_id} hung; host cannot communicate with the tool." +
                   (" Recurring issue - permanent fix needed." if hit else ""),
        action_type="reset_interface",
        params={"equipment_id": eq_id},
        risk="medium",
        reason=f"{eq_id} interface is {eq.get('interface_status')}; lots cannot start. Reset restores the SECS/GEM link.",
        evidence=ev,
        summary=f"Reset SECS/GEM interface on {eq_id}.",
    )


# ---------------------------------------------------------------------------
async def user_permission_missing(ctx: Ctx) -> Decision:
    user = ctx.entities.get("user_name")
    lot_id = ctx.entities.get("lot_id")
    if not user:
        return escalate("MES Security Admin", "User name missing", "Ticket has no user name; cannot check roles.")
    await _step(ctx, 1)
    roles_res = await ctx.call("get_user_roles", {"user_name": user})
    roles = roles_res.get("roles", []) if isinstance(roles_res, dict) else []
    ev = [f"{user} roles: " + (", ".join(f"{r['role']}@{r['operation']}" for r in roles) or "none")]

    await _step(ctx, 2)
    operation = None
    if lot_id:
        lot = await ctx.call("get_lot", {"lot_id": lot_id})
        operation = lot.get("operation") if "error" not in lot else None
        if operation:
            ev.append(f"Lot {lot_id} is at {operation} on {lot.get('equipment_id')}")
    if not operation and ctx.entities.get("equipment_id"):
        eq = await ctx.call("get_equipment", {"equipment_id": ctx.entities["equipment_id"]})
        operation = eq.get("operation") if "error" not in eq else None
    if not operation:
        return escalate("MES Security Admin", "Operation unknown", "Could not find the operation for the track-in.", ev)

    await _step(ctx, 3)
    if lot_id:
        hist = await ctx.call("get_lot_history", {"lot_id": lot_id})
        fails = [e for e in hist.get("events", []) if e.get("event") == "TRACKIN_FAIL" and e.get("user_name") == user] \
            if isinstance(hist, dict) else []
        if fails:
            ev.append(f"TRACKIN_FAIL: {fails[-1].get('comments')}")
    ev += _similar_evidence(ctx)

    if any(r["operation"] in (operation, "*") for r in roles):
        return escalate("MES Application Support", "User already has a role", f"{user} already has a role for {operation}.", ev)
    if not roles:
        return escalate("MES Security Admin", "Unknown user", f"{user} has no MES roles at all; needs HR/training record check.", ev)
    await ctx.think("Decision rule: known operator without role for this operation -> propose grant_user_role OPERATOR (medium). Never higher roles.")
    return Decision(
        root_cause=f"{user} was certified but the MES OPERATOR role for {operation} was not provisioned.",
        action_type="grant_user_role",
        params={"user_name": user, "role": "OPERATOR", "operation": operation},
        risk="medium",
        reason=f"{user} is an active operator (has {len(roles)} other role(s)) but has no role for {operation}; approver should confirm training record.",
        evidence=ev,
        summary=f"Grant OPERATOR@{operation} to {user}.",
    )


# ---------------------------------------------------------------------------
async def db_slow_query(ctx: Ctx) -> Decision:
    await _step(ctx, 1)
    res = await ctx.call("get_db_sessions", {"min_elapsed_sec": 300})
    sessions = res.get("sessions", []) if isinstance(res, dict) else []
    await _step(ctx, 2)
    text = f"{ctx.incident.get('summary', '')} {ctx.incident.get('description', '')}".lower()
    pick = next((s for s in sessions if str(s.get("module", "")).lower().replace("report", "") in text and s.get("module")), None)
    pick = pick or (sessions[0] if sessions else None)
    ev: list[str] = []
    if pick:
        ev.append(f"Session {pick.get('session_id')} ({pick.get('username')}, module {pick.get('module')}) running "
                  f"{pick.get('elapsed_sec')} s, wait '{pick.get('wait_event')}'")
        ev.append(f"SQL: {pick.get('sql_text')}")
    else:
        ev.append("No session running longer than 5 minutes was found.")
    await _step(ctx, 3)
    ev += _similar_evidence(ctx)
    await ctx.think("Decision rule: database changes are DBA work -> always escalate to IT Database (DBA), never auto-fix.")
    rc = ("Report SQL does a full table scan on LOT_HISTORY (TRUNC on created_at prevents index use)."
          if pick and "trunc" in str(pick.get("sql_text", "")).lower() else "Long-running report query on the MES database.")
    reason = (f"Long-running session {pick.get('session_id')} ({pick.get('module')}, {pick.get('elapsed_sec')} s, "
              f"{pick.get('wait_event')}). Needs DBA tuning; agent must not kill sessions or change the DB.") if pick \
        else "Report is slow but no long session was found; DBA to investigate."
    return escalate("IT Database (DBA)", rc, reason, ev)


PLANNERS: dict[str, Callable[[Ctx], Awaitable[Decision]]] = {
    "lot-hold-stuck": lot_hold_stuck,
    "trackin-recipe-mismatch": trackin_recipe_mismatch,
    "equipment-heartbeat-stale": equipment_heartbeat_stale,
    "interface-timeout": interface_timeout,
    "user-permission-missing": user_permission_missing,
    "db-slow-query": db_slow_query,
}
