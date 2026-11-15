"""Tests for auto mode ticket selection and the token-saving LLM helpers (no network)."""
import json

from app import auto, hub, llm, skills


async def test_auto_picks_oldest_new_ticket_without_runs(monkeypatch):
    tickets = [
        {"incident_id": "INC000000003", "created_at": "2026-11-15T03:00:00Z"},
        {"incident_id": "INC000000001", "created_at": "2026-11-15T01:00:00Z"},  # oldest, but already has a run
        {"incident_id": "INC000000002", "created_at": "2026-11-15T02:00:00Z"},
    ]
    runs = {"INC000000001": [{"run_id": 1}], "INC000000002": [], "INC000000003": []}

    async def fake_get(path, **params):
        if path == "/api/incidents":
            assert params["status"] == "New"
            return tickets
        return runs[path.split("/")[3]]

    monkeypatch.setattr(auto.remedy, "get", fake_get)
    auto.STATE.skipped.clear()
    hub.ACTIVE_BY_INCIDENT.clear()
    assert await auto._next_ticket() == "INC000000002"
    assert "INC000000001" in auto.STATE.skipped  # remembered, not checked again


def test_auto_is_off_by_default():
    assert auto.AutoState().enabled is False


def test_skill_gets_only_the_tools_it_mentions():
    names = llm.skill_tool_names(skills.get("lot-hold-stuck"),
                                 {"get_lot", "get_lot_history", "get_equipment", "find_similar_incidents",
                                  "get_incident", "add_worklog", "propose_action"})
    assert names == {"get_lot", "get_lot_history", "add_worklog", "propose_action"}


def test_compact_drops_empty_fields_and_limits_size():
    out = json.loads(llm.compact({"a": None, "b": "", "c": [], "d": "x" * 500, "e": list(range(40))}))
    assert set(out) == {"d", "e"}
    assert len(out["d"]) < 320 and len(out["e"]) == 15
    assert len(llm.compact({"big": ["y" * 300] * 50})) <= 2500
