"""Daily incident report (markdown): new/resolved today, MTTR, top 5 categories, recurring equipment.

Run: docker compose run --rm agent python scripts/daily_incident_report.py
Output: ./reports/daily_incident_report_YYYY-MM-DD.md
"""
import os
from collections import Counter
from datetime import datetime, timezone

from _client import fail, get

REPORT_DIR = os.getenv("REPORT_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports"))


def main() -> None:
    try:
        kpis = get("/api/analytics/kpis")
        pareto = get("/api/analytics/pareto")
        mttr = get("/api/analytics/mttr")
        recurring = get("/api/analytics/recurring")
        incidents = get("/api/incidents", limit=2000)
    except Exception as e:  # noqa: BLE001
        fail(str(e))

    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    created = [i for i in incidents if i["created_at"][:10] == today]
    resolved = [i for i in incidents if (i.get("resolved_at") or "")[:10] == today]
    open_ = [i for i in incidents if i["status"] not in ("Resolved", "Closed")]
    by_agent = sum(1 for i in resolved if i.get("resolved_by") == "agent_approved")
    prio = Counter(f"P{i['priority']}" for i in open_)

    lines = [
        f"# Daily incident report - {today}",
        "",
        f"_Generated {now:%Y-%m-%d %H:%M} UTC from remedy-api (simulated Remedy / Opcenter)._",
        "",
        "## Today",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| New incidents today | {len(created)} |",
        f"| Resolved today | {len(resolved)} (agent-proposed + human-approved: {by_agent}) |",
        f"| Open now | {len(open_)} ({', '.join(f'{k}: {v}' for k, v in sorted(prio.items())) or '-'}) |",
        f"| Pending approvals | {kpis.get('pending_approvals')} |",
        f"| MTTR last 30 days | {kpis.get('mttr_hours_30d')} h |",
        f"| Resolved by agent (30 days) | {kpis.get('pct_resolved_by_agent')} % |",
        "",
        "## Top 5 categories (all time)",
        "",
        "| # | Category | Incidents | Cumulative % |",
        "|---|---|---|---|",
    ]
    for n, p in enumerate(pareto[:5], 1):
        lines.append(f"| {n} | {p['category_tier3']} | {p['incident_count']} | {p['cumulative_pct']} |")
    lines += ["", "## MTTR by category", "", "| Category | Avg h | Median h | Resolved |", "|---|---|---|---|"]
    for m in mttr:
        lines.append(f"| {m['category_tier3']} | {m['avg_hours']} | {m['median_hours']} | {m['resolved_count']} |")
    lines += ["", "## Recurring equipment (>= 3 in 30 days)", "", "| CI | Category | Count | Top root cause |", "|---|---|---|---|"]
    for r in recurring:
        lines.append(f"| {r['ci_name']} | {r['category_tier3']} | {r['occurrences']} | {r.get('top_root_cause') or '-'} |")
    if created:
        lines += ["", "## New today", ""]
        lines += [f"- `{i['incident_id']}` P{i['priority']} {i['status']} - {i['summary']}" for i in created[:30]]

    os.makedirs(REPORT_DIR, exist_ok=True)
    path = os.path.join(REPORT_DIR, f"daily_incident_report_{today}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Report written: {path}")
    print(f"  new today={len(created)} resolved today={len(resolved)} open={len(open_)} mttr30={kpis.get('mttr_hours_30d')}h")


if __name__ == "__main__":
    main()
