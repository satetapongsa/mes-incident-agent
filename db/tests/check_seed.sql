SET PAGESIZE 100 LINESIZE 200 FEEDBACK OFF
COLUMN category_tier3 FORMAT A20
COLUMN ci_name FORMAT A14
COLUMN summary FORMAT A72
COLUMN sim_fault FORMAT A18
COLUMN current_recipe FORMAT A14
PROMPT == Pareto ==
SELECT category_tier3, incident_count FROM v_incident_pareto ORDER BY incident_count DESC;
PROMPT == Recurring (30 days) ==
SELECT ci_name, category_tier3, occurrences, open_count FROM v_recurring_issues ORDER BY occurrences DESC;
PROMPT == Open incidents ==
SELECT incident_id, status, summary FROM incidents WHERE status NOT IN ('Resolved','Closed') ORDER BY incident_id;
PROMPT == Lots ==
SELECT status, COUNT(*) AS n FROM lots GROUP BY status;
PROMPT == Equipment ==
SELECT equipment_id, state, interface_status, sim_fault, current_recipe FROM equipment ORDER BY 1;
PROMPT == MTTR ==
SELECT * FROM v_mttr_by_category;
EXIT
