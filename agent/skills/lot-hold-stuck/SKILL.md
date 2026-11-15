---
name: lot-hold-stuck
description: Use when a lot stays on Hold although the SPC/QE review is already done (ticket says "still on hold", "SPC review done", "please release"). Checks lot status and history, proposes release_lot_hold only when a completed SPC review with disposition RELEASE exists.
---

# Lot hold stuck after SPC review

## Symptoms
- Operator says lot X is still Hold, QE already reviewed / approved.
- Lot cannot be dispatched, the line is waiting.

## Diagnosis steps
1. Call `get_lot` for the lot in the ticket. Check `status` = Hold and the `hold_code` (SPC-OOC, ENG-HOLD, QA-HOLD).
2. Call `get_lot_history` and find the last HOLD event and any SPC_REVIEW event after it.
3. Read the SPC_REVIEW comment: is the review completed and is the disposition RELEASE? Who did it and when?
4. Compare with similar past incidents (from `find_similar_incidents`): what was the root cause and fix?

## Decision rules
- Lot not on Hold anymore -> nothing to fix, escalate to MES Application Support to confirm and close.
- Hold code SPC-OOC AND an SPC_REVIEW after the HOLD with "Disposition: RELEASE" -> propose `release_lot_hold`.
- No SPC review, or disposition is not RELEASE (e.g. SCRAP, MRB) -> do NOT release. Escalate to Quality Engineering.
- Hold code ENG-HOLD or QA-HOLD -> never release automatically. Escalate to Quality Engineering.

## Action to propose
- `release_lot_hold` with params `{lot_id, comment}`. Risk **medium**. The comment must quote the SPC review (user + time + disposition).
- Otherwise `escalate_to_group` `{group_name: "Quality Engineering"}`, risk low.

## Worklog (agent_analysis)
Root cause hypothesis: "SPC disposition was recorded but the MES hold release transaction was never posted."
Evidence: lot status + hold code, HOLD time, SPC_REVIEW user/time/comment, similar incidents.

## Verify after execution
`get_lot` -> status must be Waiting and hold_code empty. Then the incident can be resolved.
