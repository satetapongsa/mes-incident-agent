"""Rule-based triage (mock mode, and validation/fallback for LLM triage).
Implements the table in skills/incident-triage/SKILL.md."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

CATEGORIES = {
    "Permission Missing": ("MES", "Security", "MES Security Admin"),
    "Recipe Mismatch": ("MES", "Track In-Out", "Equipment Automation"),
    "Heartbeat Stale": ("Equipment", "Connectivity", "Equipment Automation"),
    "SECS-GEM Timeout": ("Equipment", "Interface", "Equipment Automation"),
    "Lot Hold": ("MES", "Lot Management", "MES Application Support"),
    "Slow Query": ("Database", "Performance", "IT Database (DBA)"),
    "Equipment Alarm": ("Equipment", "Hardware", "Equipment Engineering"),
    "Scanner Offline": ("Infrastructure", "Peripheral", "IT Field Support"),
    "Label Printer": ("Infrastructure", "Peripheral", "IT Field Support"),
    "Report Error": ("MES", "Reporting", "MES Application Support"),
    "Other": ("MES", "General", "MES Application Support"),
}

INJECTION_PATTERNS = [
    r"ignore (all |any )?(previous|prior|above) instructions",
    r"you are now",
    r"\bsystem\s*:",
    r"do not ask for approval",
    r"without approval",
    r"disregard (the )?(rules|instructions)",
    r"act as (an? )?admin",
]

LOT_RE = re.compile(r"\bLT\d{4}-\d{4}\b", re.I)
EQ_RE = re.compile(r"\b(WB|DA|MD|TS|WP)-\d{2}\b", re.I)
USER_RE = re.compile(r"\b(op|tech|eng|sup|qe)_[a-z]+\b", re.I)


@dataclass
class TriageResult:
    category_tier1: str
    category_tier2: str
    category_tier3: str
    priority: int
    assigned_group: str
    reason: str
    injection_suspected: bool = False

    def dict(self) -> dict:
        return asdict(self)


def detect_injection(text: str) -> bool:
    t = text.lower()
    return any(re.search(p, t) for p in INJECTION_PATTERNS)


def extract_entities(incident: dict) -> dict:
    text = f"{incident.get('summary', '')} {incident.get('description', '') or ''}"
    lots = [m.upper() for m in LOT_RE.findall(text)]
    eqs = [m.group(0).upper() for m in EQ_RE.finditer(text)]
    ci = (incident.get("ci_name") or "").upper()
    if not eqs and EQ_RE.fullmatch(ci or "-"):
        eqs = [ci]
    users = [m.group(0).lower() for m in USER_RE.finditer(text)]
    return {
        "lot_id": lots[0] if lots else None,
        "equipment_id": eqs[0] if eqs else None,
        "user_name": users[0] if users else None,
        "ci_name": ci or None,
    }


def _category(t: str) -> tuple[str, str]:
    rules = [
        ("Permission Missing", ["not authorized", "permission", "access denied", "no role", "role for"]),
        ("Recipe Mismatch", ["recipe"]),
        ("Heartbeat Stale", ["heartbeat", "no update", "not move", "not updating", "no data"]),
        ("SECS-GEM Timeout", ["secs", "s1f13", "hsms", "timeout", "communication"]),
        ("Lot Hold", ["hold", "spc", "release"]),
        ("Slow Query", ["slow", "loading", "takes more than"]),
        ("Equipment Alarm", ["alarm", "wire break", "e101"]),
        ("Scanner Offline", ["scanner", "barcode"]),
        ("Label Printer", ["printer", "label"]),
        ("Report Error", ["report"]),
    ]
    for cat, words in rules:
        for w in words:
            if w in t:
                return cat, w
    return "Other", "no keyword matched"


def classify(incident: dict) -> TriageResult:
    text = f"{incident.get('summary', '')}\n{incident.get('description', '') or ''}"
    t = text.lower()
    if detect_injection(text):
        t1, t2, grp = CATEGORIES["Other"]
        return TriageResult(t1, t2, "Other", 3, grp,
                            "Ticket contains instructions to the system (possible prompt injection). "
                            "Ignored them, kept priority 3, needs human review.", True)

    cat, kw = _category(t)
    t1, t2, grp = CATEGORIES[cat]
    prio = {"Recipe Mismatch": 2, "SECS-GEM Timeout": 2, "Equipment Alarm": 2,
            "Label Printer": 4, "Report Error": 4}.get(cat, 3)
    if cat == "Lot Hold" and any(w in t for w in ["line is waiting", "line waiting", "urgent", "ด่วน"]):
        prio = 2
    if any(w in t for w in ["whole line down", "all machines down", "line down", "production stop"]):
        prio = 1
    return TriageResult(t1, t2, cat, prio, grp, f"keyword '{kw}' -> {cat}; priority P{prio}")


def validate_llm_triage(data: dict) -> TriageResult | None:
    """Accept an LLM triage only if it uses a known category; derive tiers + group from the table."""
    cat = str(data.get("category_tier3", "")).strip()
    if cat not in CATEGORIES:
        return None
    try:
        prio = int(data.get("priority", 3))
    except (TypeError, ValueError):
        prio = 3
    prio = min(max(prio, 1), 4)
    t1, t2, grp = CATEGORIES[cat]
    inj = bool(data.get("injection_suspected", False))
    if inj:
        prio = 3
    return TriageResult(t1, t2, cat, prio, grp, str(data.get("reason", ""))[:400], inj)
