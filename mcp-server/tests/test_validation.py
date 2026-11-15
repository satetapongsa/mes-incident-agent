import pytest
from pydantic import ValidationError

from validation import ProposeActionInput, validate_proposal


def base(**kw):
    d = {
        "incident_id": "INC000000510",
        "run_id": 3,
        "action_type": "release_lot_hold",
        "params": {"lot_id": "LT2611-0012", "comment": "SPC review done by qe_kanya, disposition RELEASE"},
        "risk": "medium",
        "reason": "Lot is on SPC hold but SPC review already released it",
    }
    d.update(kw)
    return d


def test_valid_release_is_accepted_and_normalised():
    out = validate_proposal(base(params={"lot_id": "lt2611-0012", "comment": "SPC review completed: RELEASE"}))
    assert out["params"]["lot_id"] == "LT2611-0012"
    assert out["requested_by"] == "agent"


def test_unknown_action_type_rejected():
    with pytest.raises(ValidationError):
        validate_proposal(base(action_type="kill_db_session"))


def test_missing_param_rejected():
    with pytest.raises(ValidationError):
        validate_proposal(base(params={"lot_id": "LT2611-0012"}))


def test_extra_param_rejected():
    with pytest.raises(ValidationError):
        validate_proposal(base(params={"lot_id": "LT2611-0012", "comment": "long enough comment", "force": True}))


def test_bad_ids_rejected():
    with pytest.raises(ValidationError):
        validate_proposal(base(incident_id="12345"))
    with pytest.raises(ValidationError):
        validate_proposal(base(action_type="reset_interface", params={"equipment_id": "XX-99"}))


def test_privileged_role_cannot_be_proposed():
    with pytest.raises(ValidationError):
        validate_proposal(base(action_type="grant_user_role",
                               params={"user_name": "op_anucha", "role": "SUPERVISOR", "operation": "MOLD"}))


def test_grant_operator_role_ok():
    out = validate_proposal(base(action_type="grant_user_role",
                                 params={"user_name": "OP_Thanakorn", "role": "OPERATOR", "operation": "FINAL_TEST"}))
    assert out["params"]["user_name"] == "op_thanakorn"


def test_risk_is_raised_to_minimum():
    out = validate_proposal(base(risk="low"))
    assert out["risk"] == "medium"
    esc = validate_proposal(base(action_type="escalate_to_group", risk="low",
                                 params={"group_name": "IT Database (DBA)"}))
    assert esc["risk"] == "low"


def test_unknown_group_rejected():
    with pytest.raises(ValidationError):
        validate_proposal(base(action_type="escalate_to_group", params={"group_name": "Plant Manager"}))


def test_reason_required():
    with pytest.raises(ValidationError):
        ProposeActionInput.model_validate(base(reason="ok"))
