---
name: db-slow-query
description: Use when an MES report or page is very slow (ticket says "slow", "loading > 5 min", "report timeout"). Collects evidence of the long-running database session and ALWAYS escalates to the DBA group - never auto-fixes.
---

# Database slow query (escalate, no auto-fix)

## Symptoms
- One report page (e.g. Yield report) takes minutes; other pages are OK.

## Diagnosis steps
1. Call `get_db_sessions` with `min_elapsed_sec` = 300 to find long-running sessions.
2. Pick the session whose module matches the report in the ticket; note session id, SQL text, elapsed seconds and wait event.
3. Check similar past incidents for the typical root cause (missing index, stale statistics, no date filter).

## Decision rules
- Database changes (kill session, add index, gather statistics) are DBA work and are NOT allowed for the agent.
- Always propose `escalate_to_group` to **IT Database (DBA)** with the evidence.
- If no long-running session is found, still escalate to IT Database (DBA) and say no session was found.

## Action to propose
- `escalate_to_group` with params `{group_name: "IT Database (DBA)", comment}`. Risk **low**.
- After approval the ticket is reassigned to the DBA group and stays open (NOT resolved by the agent).

## Worklog (agent_analysis)
Root cause hypothesis: "Report SQL does a full scan (e.g. TRUNC on created_at prevents index use)."
Evidence: session id, module, elapsed time, wait event (`db file scattered read` = full scan), SQL text.
