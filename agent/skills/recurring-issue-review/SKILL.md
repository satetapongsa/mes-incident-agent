---
name: recurring-issue-review
description: Use for problem management - review recurring incidents (same CI + category >= 3 times in 30 days), Pareto and MTTR, and write a short improvement report with concrete recommendations.
---

# Recurring issue review (problem management)

## Diagnosis steps
1. Call `get_recurring_issues` to get the CI + category pairs that repeat.
2. Read the Pareto (top categories) and MTTR by category.
3. For each top recurring item, read its most common root cause.

## Decision rules
- Rank by occurrences, then by MTTR (long MTTR = more lost production time).
- Prefer permanent fixes (preventive maintenance, monitoring, interface auto-reconnect, index) over repeating the same manual fix.
- Mention where the agent already helps (categories with agent-approved resolutions) and where it must not (database, hardware).

## Output (markdown, max ~300 words)
1. **Summary** - one paragraph.
2. **Top recurring issues** - table: CI, category, count, top root cause.
3. **Recommendations** - 3 to 5 bullets, each with owner group and expected effect.
4. **Next steps** - what to monitor next month.
