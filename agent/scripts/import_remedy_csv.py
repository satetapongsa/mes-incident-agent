"""Bulk import incidents from a Remedy CSV export.

Run: docker compose run --rm agent python scripts/import_remedy_csv.py [scripts/sample_remedy_export.csv]

Expected columns (Remedy export names):
Incident ID, Summary, Notes, Priority, Status, Operational Categorization Tier 1/2/3, CI Name,
Assigned Group, Submitter, Submit Date, Last Resolved Date, Root Cause, Resolution
Re-running is safe: rows with an Incident ID that was already imported are skipped.
"""
import csv
import os
import sys

from _client import post

PRIORITY = {"critical": 1, "high": 2, "medium": 3, "low": 4}


def to_iso(v: str) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    # Remedy exports "2026-09-14 08:15:00"
    return v.replace(" ", "T") + ("Z" if len(v) == 19 else "")


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "sample_remedy_export.csv")
    imported = skipped = errors = 0
    with open(path, newline="", encoding="utf-8-sig") as f:
        for n, row in enumerate(csv.DictReader(f), 1):
            body = {
                "external_ref": row["Incident ID"].strip(),
                "summary": row["Summary"].strip(),
                "description": row.get("Notes", "").strip() or None,
                "priority": PRIORITY.get(row.get("Priority", "").strip().lower(), 3),
                "status": row.get("Status", "Closed").strip() or "Closed",
                "category_tier1": row.get("Operational Categorization Tier 1") or None,
                "category_tier2": row.get("Operational Categorization Tier 2") or None,
                "category_tier3": row.get("Operational Categorization Tier 3") or None,
                "ci_name": row.get("CI Name") or None,
                "assigned_group": row.get("Assigned Group") or None,
                "submitter": row.get("Submitter") or "remedy-import",
                "root_cause": row.get("Root Cause") or None,
                "resolution": row.get("Resolution") or None,
                "created_at": to_iso(row.get("Submit Date", "")),
                "resolved_at": to_iso(row.get("Last Resolved Date", "")),
            }
            try:
                res = post("/api/incidents/import", body)
                if res["skipped"]:
                    skipped += 1
                    print(f"  row {n}: {body['external_ref']} already imported as {res['incident_id']} - skipped")
                else:
                    imported += 1
                    print(f"  row {n}: {body['external_ref']} -> {res['incident_id']}")
            except Exception as e:  # noqa: BLE001
                errors += 1
                print(f"  row {n}: {body['external_ref']} ERROR {e}")
    print(f"Done: {imported} imported, {skipped} skipped, {errors} errors (file {path})")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
