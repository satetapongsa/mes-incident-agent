---
name: interface-timeout
description: Use when the equipment SECS/GEM host interface is in Timeout/Offline and lots cannot start (ticket says "SECS/GEM timeout", "S1F13", "communication timeout", "machine does not accept lot"). Proposes reset_interface.
---

# Equipment interface (SECS/GEM) timeout

## Symptoms
- Host shows communication timeout (S1F13 / HSMS) for one tool.
- Track-in fails with "interface is Timeout".

## Diagnosis steps
1. Call `get_equipment`: read `interface_status`, `state`, `running_lots`.
2. If the ticket has a lot, call `get_lot_history` and look for TRACKIN_FAIL with the interface error.
3. Call `get_recurring_issues`: is this equipment a recurring offender for SECS-GEM Timeout?
4. Use similar past incidents to confirm the usual fix (interface reset).

## Decision rules
- interface Online -> nothing to reset; escalate to Equipment Automation.
- Equipment Down -> hardware problem, escalate to Equipment Engineering.
- interface Timeout or Offline and equipment not Down -> propose `reset_interface`.
- If the tool is a recurring offender (>= 3 in 30 days) still reset it, but write in the worklog that a problem ticket / root-cause fix is recommended (see recurring-issue-review).

## Action to propose
- `reset_interface` with params `{equipment_id}`. Risk **medium**.

## Worklog (agent_analysis)
Root cause hypothesis: "Equipment GEM interface hung (HSMS connection dropped)."
Evidence: interface status, TRACKIN_FAIL message, recurring count, similar incidents.

## Verify after execution
`get_equipment` -> `interface_status` = Online.
