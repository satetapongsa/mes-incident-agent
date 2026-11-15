"""Find equipment with a stale heartbeat (> 10 min, not Down) and open a ticket automatically.
Does not open a duplicate if an open ticket for the same equipment and category already exists.

Run: docker compose run --rm agent python scripts/equipment_heartbeat_watch.py [--max-age 600] [--dry-run]
"""
import argparse

from _client import fail, get, post


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-age", type=int, default=600, help="seconds")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        equipment = get("/api/mes/equipment")
        open_inc = get("/api/incidents", status="Open", limit=1000)
    except Exception as e:  # noqa: BLE001
        fail(str(e))

    stale = [e for e in equipment if e["heartbeat_age_sec"] > args.max_age and e["state"] != "Down"]
    print(f"{len(equipment)} equipment checked, {len(stale)} with heartbeat older than {args.max_age} s")
    opened = 0
    for e in stale:
        dup = [i for i in open_inc if i.get("ci_name") == e["equipment_id"]
               and (i.get("category_tier3") == "Heartbeat Stale" or "heartbeat" in i["summary"].lower()
                    or "no update" in i["summary"].lower())]
        age_min = e["heartbeat_age_sec"] // 60
        if dup:
            print(f"  {e['equipment_id']}: stale {age_min} min - already open: {dup[0]['incident_id']}")
            continue
        if args.dry_run:
            print(f"  {e['equipment_id']}: stale {age_min} min - would open a ticket")
            continue
        inc = post("/api/incidents", {
            "summary": f"{e['equipment_id']} heartbeat stale ({age_min} min) while {e['state']}",
            "description": f"Detected by equipment_heartbeat_watch.py: last heartbeat {e['last_heartbeat']} "
                           f"({e['heartbeat_age_sec']} s ago), state {e['state']}, interface {e['interface_status']}.",
            "priority": 3, "category_tier1": "Equipment", "category_tier2": "Connectivity",
            "category_tier3": "Heartbeat Stale", "ci_name": e["equipment_id"],
            "assigned_group": "Equipment Automation", "submitter": "heartbeat-watch", "source": "script",
        })
        opened += 1
        print(f"  {e['equipment_id']}: stale {age_min} min - opened {inc['incident_id']}")
    print(f"Done: {opened} ticket(s) opened")


if __name__ == "__main__":
    main()
