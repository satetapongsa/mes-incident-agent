"""Recurring-issue improvement report (skill: recurring-issue-review)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from . import config, llm, remedy, skills

ADVICE = {
    "SECS-GEM Timeout": ("Equipment Automation", "add HSMS auto-reconnect + interface watchdog on the tool PC; "
                         "alarm when S1F13 fails twice"),
    "Heartbeat Stale": ("Equipment Automation", "monitor equipment agent service (auto-restart) and alert when "
                        "heartbeat > 5 min; run equipment_heartbeat_watch.py every 5 min"),
    "Lot Hold": ("MES Application Support + Quality Engineering", "integrate SPC disposition with MES so a RELEASE "
                 "disposition releases the hold automatically (with audit)"),
    "Recipe Mismatch": ("Equipment Automation", "make recipe download from RMS part of the changeover checklist; "
                        "block track-in UI with a clear 'load recipe X' message"),
    "Permission Missing": ("MES Security Admin", "link training certification to MES role provisioning"),
    "Slow Query": ("IT Database (DBA)", "add index on LOT_HISTORY(created_at), rewrite TRUNC() filters, "
                   "schedule statistics after purge"),
    "Equipment Alarm": ("Equipment Engineering", "review PM interval and wear parts (capillary) for this tool"),
}


async def collect() -> dict:
    return {
        "kpis": await remedy.get("/api/analytics/kpis"),
        "recurring": await remedy.get("/api/analytics/recurring"),
        "pareto": await remedy.get("/api/analytics/pareto"),
        "mttr": await remedy.get("/api/analytics/mttr"),
    }


def mock_report(d: dict) -> str:
    k, rec, par, mttr = d["kpis"], d["recurring"], d["pareto"], d["mttr"]
    top3 = par[:3]
    share = top3[-1]["cumulative_pct"] if top3 else 0
    lines = [
        "# Recurring issue review (last 30 days)", "",
        "## Summary",
        f"{k.get('total_incidents')} incidents in the system, {k.get('open_incidents')} open. MTTR (30 days) is "
        f"{k.get('mttr_hours_30d')} h and {k.get('pct_resolved_by_agent')}% of resolutions were agent-proposed and "
        f"human-approved. The top 3 categories ({', '.join(p['category_tier3'] for p in top3)}) cover {share}% of all "
        f"incidents, and {len(rec)} equipment/category pairs repeated 3+ times in 30 days.", "",
        "## Top recurring issues", "",
        "| CI | Category | Count (30d) | Avg MTTR h | Top root cause |", "|---|---|---|---|---|",
    ]
    for r in rec[:6]:
        lines.append(f"| {r['ci_name']} | {r['category_tier3']} | {r['occurrences']} | {r.get('avg_mttr_hours')} | "
                     f"{r.get('top_root_cause') or '-'} |")
    lines += ["", "## Recommendations"]
    seen = set()
    for r in rec:
        cat = r["category_tier3"]
        if cat in ADVICE and cat not in seen:
            seen.add(cat)
            owner, fix = ADVICE[cat]
            lines.append(f"- **{r['ci_name']} - {cat}** ({r['occurrences']}x): {fix}. Owner: {owner}.")
        if len(seen) >= 5:
            break
    slow = sorted(mttr, key=lambda m: -(m.get("avg_hours") or 0))[:2]
    lines += ["", "## Next steps",
              "- Open problem tickets for the top 3 recurring items and track them weekly.",
              f"- Longest MTTR: {', '.join(f'{m['category_tier3']} ({m['avg_hours']} h)' for m in slow)} - review "
              "escalation paths for these categories.",
              "- Keep database and hardware issues as escalate-only for the agent; extend skills for printers/scanners next."]
    return "\n".join(lines)


async def recurring_report() -> dict:
    data = await collect()
    mode = config.llm_mode()
    text = None
    if mode == "llm":
        try:
            skill = skills.get("recurring-issue-review")
            resp = await llm.client().chat.completions.create(
                model=config.XAI_MODEL, temperature=0.2,
                messages=[{"role": "system", "content": "You are a problem manager at a semiconductor backend site. "
                                                        f"Follow this skill:\n\n{skill.body}"},
                          {"role": "user", "content": "Data (JSON):\n" + json.dumps(data, default=str)[:12000]}])
            text = resp.choices[0].message.content
        except Exception as e:  # noqa: BLE001
            text = None
            mode = f"mock (LLM failed: {type(e).__name__})"
    if not text:
        text = mock_report(data)
        mode = mode if mode != "llm" else "mock"
    return {"mode": mode, "markdown": text, "generated_at": datetime.now(timezone.utc).isoformat()}
