"""Pydantic input validation for the MCP tools.

Kept in its own module so it can be unit tested without starting the server.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints


def _upper(v: Any) -> Any:
    return v.strip().upper() if isinstance(v, str) else v


def _lower(v: Any) -> Any:
    return v.strip().lower() if isinstance(v, str) else v


IncidentId = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^INC\d{9}$")]
LotId = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^LT\d{4}-\d{4}$")]
EquipmentId = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^(WB|DA|MD|TS|WP)-\d{2}$")]
UserName = Annotated[str, BeforeValidator(_lower), StringConstraints(pattern=r"^[a-z]{2,6}_[a-z]{2,20}$")]
Recipe = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^(WB|DA|MD|TS|WP)-[A-Z0-9]{2,10}-[A-Z]$")]

Operation = Literal["DIE_ATTACH", "WIRE_BOND", "MOLD", "FINAL_TEST", "WAFER_SORT"]
EquipmentState = Literal["Productive", "Standby", "Down", "Engineering"]
Risk = Literal["low", "medium", "high"]
ActionType = Literal["release_lot_hold", "set_equipment_state", "reset_interface", "grant_user_role", "escalate_to_group"]

SUPPORT_GROUPS = (
    "MES Application Support",
    "Equipment Automation",
    "Equipment Engineering",
    "MES Security Admin",
    "IT Database (DBA)",
    "IT Field Support",
    "Quality Engineering",
)
SupportGroup = Literal[
    "MES Application Support",
    "Equipment Automation",
    "Equipment Engineering",
    "MES Security Admin",
    "IT Database (DBA)",
    "IT Field Support",
    "Quality Engineering",
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReleaseLotHoldParams(_Strict):
    lot_id: LotId
    comment: str = Field(min_length=10, max_length=400, description="Why the hold can be released (evidence)")


class SetEquipmentStateParams(_Strict):
    equipment_id: EquipmentId
    state: EquipmentState
    recipe: Optional[Recipe] = Field(default=None, description="Recipe to load (optional)")


class ResetInterfaceParams(_Strict):
    equipment_id: EquipmentId


class GrantUserRoleParams(_Strict):
    user_name: UserName
    # Privilege guard: the agent may only ask for shop-floor roles, never ENGINEER/SUPERVISOR.
    role: Literal["OPERATOR", "TECHNICIAN"]
    operation: Operation


class EscalateToGroupParams(_Strict):
    group_name: SupportGroup
    comment: Optional[str] = Field(default=None, max_length=400)


ACTION_MODELS: dict[str, type[BaseModel]] = {
    "release_lot_hold": ReleaseLotHoldParams,
    "set_equipment_state": SetEquipmentStateParams,
    "reset_interface": ResetInterfaceParams,
    "grant_user_role": GrantUserRoleParams,
    "escalate_to_group": EscalateToGroupParams,
}

# Minimum risk per action: anything that changes MES data is at least "medium".
MIN_RISK: dict[str, str] = {
    "release_lot_hold": "medium",
    "set_equipment_state": "medium",
    "reset_interface": "medium",
    "grant_user_role": "medium",
    "escalate_to_group": "low",
}
_RISK_ORDER = {"low": 0, "medium": 1, "high": 2}


class ProposeActionInput(_Strict):
    incident_id: IncidentId
    run_id: Optional[int] = Field(default=None, ge=1)
    action_type: ActionType
    params: dict[str, Any]
    risk: Risk
    reason: str = Field(min_length=10, max_length=2000)


class WorklogInput(_Strict):
    incident_id: IncidentId
    text: str = Field(min_length=5, max_length=20000)
    log_type: Literal["agent_analysis", "note"] = "agent_analysis"


def validate_proposal(data: dict[str, Any]) -> dict[str, Any]:
    """Validate a propose_action call. Returns the cleaned payload for remedy-api.

    - checks action_type, risk, reason
    - validates params against the model for that action_type (unknown keys are rejected)
    - raises risk to the minimum allowed for the action type
    """
    req = ProposeActionInput.model_validate(data)
    params = ACTION_MODELS[req.action_type].model_validate(req.params).model_dump(exclude_none=True)
    risk = req.risk
    floor = MIN_RISK[req.action_type]
    if _RISK_ORDER[risk] < _RISK_ORDER[floor]:
        risk = floor
    return {
        "incident_id": req.incident_id,
        "run_id": req.run_id,
        "action_type": req.action_type,
        "params": params,
        "risk": risk,
        "reason": req.reason,
        "requested_by": "agent",
    }
