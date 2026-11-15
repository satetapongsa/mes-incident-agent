---
name: equipment-heartbeat-stale
description: Use when equipment shows Productive in MES but its heartbeat is older than 10 minutes (ticket says "Productive but no update", "lot not moving", "no data"). Proposes reset_interface for one tool, escalates if many tools are stale.
---

# Equipment heartbeat stale

## Symptoms
- MES shows the tool Productive, but lot quantity does not move and nothing updates.
- The tool screen looks normal (the equipment agent / integration is hung, not the machine).

## Diagnosis steps
1. Call `get_equipment` for the equipment: read `state`, `interface_status`, `last_heartbeat`, `heartbeat_age_sec`.
2. Call `list_equipment` and count how many tools have `heartbeat_age_sec` > 600.
3. Check similar past incidents and whether this tool is a recurring offender.

## Decision rules
- `heartbeat_age_sec` <= 600 -> heartbeat is fine; escalate to Equipment Automation to check the dashboard.
- More than 3 tools stale at the same time -> plant-wide integration problem. Do not reset tools one by one; escalate to Equipment Automation.
- Only this tool stale, state Productive, interface Online -> the equipment agent is hung. Propose `reset_interface`.
- Equipment Down -> escalate to Equipment Engineering.

## Action to propose
- `reset_interface` with params `{equipment_id}`. Risk **medium** (reconnects the equipment agent, no lot data changes).

## Worklog (agent_analysis)
Root cause hypothesis: "Equipment agent on the tool PC stopped sending heartbeats; MES state is stale."
Evidence: heartbeat age in minutes, state/interface, number of other stale tools, similar incidents.

## Verify after execution
`get_equipment` -> `heartbeat_age_sec` < 60 and interface Online.
