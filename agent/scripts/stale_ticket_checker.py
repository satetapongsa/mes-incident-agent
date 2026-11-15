"""Find tickets that are Pending or Assigned for more than 24 h and add a reminder worklog.

Run: docker compose run --rm agent python scripts/stale_ticket_checker.py [--hours 24] [--dry-run]
"""
import argparse

from _client import fail, get, post


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stale = []
    try:
        for status in ("Pending", "Assigned"):
            for i in get("/api/incidents", status=status, limit=1000):
                if (i.get("idle_hours") or 0) > args.hours:
                    stale.append(i)
    except Exception as e:  # noqa: BLE001
        fail(str(e))

    print(f"{len(stale)} ticket(s) Pending/Assigned with no status change for > {args.hours:g} h")
    for i in stale:
        text = (f"Reminder (stale_ticket_checker): ticket is {i['status']} for {i['idle_hours']} h without update. "
                f"Group {i.get('assigned_group') or '-'}, please update or escalate.")
        print(f"  {i['incident_id']} {i['status']:<9} idle {i['idle_hours']:>6} h  {i['summary'][:60]}")
        if not args.dry_run:
            post(f"/api/incidents/{i['incident_id']}/worklogs", {"author": "stale-checker", "log_type": "note", "text": text})
    if stale and not args.dry_run:
        print(f"Added {len(stale)} reminder worklog(s).")


if __name__ == "__main__":
    main()
