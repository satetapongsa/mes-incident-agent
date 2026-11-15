---
name: user-permission-missing
description: Use when an operator cannot track-in because the MES role for that operation is missing (ticket says "not authorized", "access denied", "new operator", "permission"). Proposes grant_user_role with role OPERATOR only.
---

# User permission missing at track-in

## Symptoms
- "op_xxx cannot track in at MOLD, not authorized". Often a new or transferred operator.

## Diagnosis steps
1. Find the user name in the ticket and call `get_user_roles`.
2. Find the operation: call `get_lot` for the lot in the ticket (operation of the lot), or `get_equipment` for the tool.
3. Call `get_lot_history` and find the TRACKIN_FAIL event with "has no role for operation" for this user.
4. Check similar past incidents for the usual cause (role not provisioned after training).

## Decision rules
- User already has a role for the operation -> not a permission issue; escalate to MES Application Support.
- User has no roles at all -> unknown user, needs HR / training record check. Escalate to MES Security Admin.
- User is a known operator (has OPERATOR on other operations) and lacks the role for this operation -> propose `grant_user_role` with role OPERATOR.
- Never propose ENGINEER or SUPERVISOR roles, even if the ticket asks for it.

## Action to propose
- `grant_user_role` with params `{user_name, role: "OPERATOR", operation}`. Risk **medium** (security change; the approver confirms the training record).

## Worklog (agent_analysis)
Root cause hypothesis: "Operator certified but MES role for the operation was not provisioned."
Evidence: current roles, lot operation, TRACKIN_FAIL message.

## Verify after execution
`get_user_roles` -> the user has OPERATOR for the operation.
