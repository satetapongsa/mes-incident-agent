---
name: trackin-recipe-mismatch
description: Use when track-in fails because the equipment recipe is not the recipe the lot requires (ticket says "recipe mismatch", "wrong recipe", often after a product changeover). Proposes loading the required recipe with set_equipment_state.
---

# Track-in failed: recipe mismatch

## Symptoms
- "Cannot track-in lot X on WB-02, recipe mismatch".
- Usually right after a product changeover.

## Diagnosis steps
1. Call `get_lot` for the lot: read `recipe_required`, `operation`, `equipment_id`, `equipment_recipe`, `recipe_match`.
2. Call `get_equipment` for the equipment: read `current_recipe`, `state`, `interface_status`, `running_lots`.
3. Call `get_lot_history` and find the TRACKIN_FAIL event with the error text (confirms the recipe mismatch).
4. Check similar past incidents for the usual root cause (old recipe after changeover, RMS download failed).

## Decision rules
- `recipe_match` = Y -> the recipe is fine now; no change, escalate to Equipment Automation.
- Equipment state Down or Engineering -> escalate to Equipment Engineering (it should not run production).
- Equipment has a Running lot (`running_lots` > 0) -> never change the recipe during a run. Escalate to Equipment Automation.
- Equipment operation must equal the lot operation, otherwise escalate.
- Otherwise -> propose loading the required recipe.

## Action to propose
- `set_equipment_state` with params `{equipment_id, state: "Standby", recipe: <recipe_required>}`. Risk **medium**.
- The operator retries the track-in after the change.

## Worklog (agent_analysis)
Root cause hypothesis: "Equipment kept the previous product recipe after changeover."
Evidence: required vs current recipe, TRACKIN_FAIL message, equipment state, running lots = 0.

## Verify after execution
`get_equipment` -> `current_recipe` equals the lot's `recipe_required`.
