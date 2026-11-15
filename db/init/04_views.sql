-- 04_views.sql : analytics views + analytics_pkg (reads only)
ALTER SESSION SET CONTAINER = FREEPDB1;
ALTER SESSION SET CURRENT_SCHEMA = MESAPP;
SET DEFINE OFF
SET SQLBLANKLINES ON

-- Incident count per category (tier 3) for the Pareto chart
CREATE OR REPLACE VIEW v_incident_pareto AS
SELECT category_tier3,
       MAX(category_tier1) AS category_tier1,
       COUNT(*)            AS incident_count
  FROM incidents
 WHERE category_tier3 IS NOT NULL
 GROUP BY category_tier3;

-- Mean time to resolve per category (hours)
CREATE OR REPLACE VIEW v_mttr_by_category AS
SELECT category_tier3,
       COUNT(*) AS resolved_count,
       ROUND(AVG((CAST(resolved_at AS DATE) - CAST(created_at AS DATE)) * 24), 1)    AS avg_hours,
       ROUND(MEDIAN((CAST(resolved_at AS DATE) - CAST(created_at AS DATE)) * 24), 1) AS median_hours,
       SUM(CASE WHEN resolved_by = 'agent_approved' THEN 1 ELSE 0 END)              AS resolved_by_agent
  FROM incidents
 WHERE resolved_at IS NOT NULL
   AND category_tier3 IS NOT NULL
 GROUP BY category_tier3;

-- Same CI + same category at least 3 times in the last 30 days
CREATE OR REPLACE VIEW v_recurring_issues AS
SELECT ci_name,
       category_tier3,
       COUNT(*)                                                           AS occurrences,
       SUM(CASE WHEN status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS open_count,
       MIN(created_at)                                                    AS first_seen,
       MAX(created_at)                                                    AS last_seen,
       STATS_MODE(root_cause)                                             AS top_root_cause,
       ROUND(AVG(CASE WHEN resolved_at IS NOT NULL
                      THEN (CAST(resolved_at AS DATE) - CAST(created_at AS DATE)) * 24 END), 1) AS avg_mttr_hours
  FROM incidents
 WHERE created_at >= CAST(SYSTIMESTAMP AS DATE) - 30
   AND ci_name IS NOT NULL
   AND category_tier3 IS NOT NULL
 GROUP BY ci_name, category_tier3
HAVING COUNT(*) >= 3;

-- Opened vs resolved per day, last 30 days (days with zero included)
CREATE OR REPLACE VIEW v_daily_trend AS
WITH days AS (
  SELECT TRUNC(CAST(SYSTIMESTAMP AS DATE)) - LEVEL + 1 AS trend_date FROM dual CONNECT BY LEVEL <= 30
)
SELECT d.trend_date,
       (SELECT COUNT(*) FROM incidents i WHERE i.created_at  >= d.trend_date AND i.created_at  < d.trend_date + 1) AS opened,
       (SELECT COUNT(*) FROM incidents i WHERE i.resolved_at >= d.trend_date AND i.resolved_at < d.trend_date + 1) AS resolved,
       (SELECT COUNT(*) FROM incidents i WHERE i.resolved_at >= d.trend_date AND i.resolved_at < d.trend_date + 1
                                           AND i.resolved_by = 'agent_approved') AS resolved_by_agent
  FROM days d;

------------------------------------------------------------------
-- analytics_pkg
------------------------------------------------------------------
CREATE OR REPLACE PACKAGE analytics_pkg AS
  PROCEDURE pareto(p_cur OUT SYS_REFCURSOR);
  PROCEDURE mttr(p_cur OUT SYS_REFCURSOR);
  PROCEDURE recurring(p_cur OUT SYS_REFCURSOR);
  PROCEDURE trend(p_cur OUT SYS_REFCURSOR);
  PROCEDURE kpis(p_cur OUT SYS_REFCURSOR);
END analytics_pkg;
/

CREATE OR REPLACE PACKAGE BODY analytics_pkg AS
  PROCEDURE pareto(p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT category_tier3, category_tier1, incident_count,
             ROUND(100 * SUM(incident_count) OVER (ORDER BY incident_count DESC, category_tier3
                                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                   / SUM(incident_count) OVER (), 1) AS cumulative_pct
        FROM v_incident_pareto
       ORDER BY incident_count DESC, category_tier3;
  END pareto;

  PROCEDURE mttr(p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT category_tier3, resolved_count, avg_hours, median_hours, resolved_by_agent
        FROM v_mttr_by_category
       ORDER BY avg_hours DESC;
  END mttr;

  PROCEDURE recurring(p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT ci_name, category_tier3, occurrences, open_count, first_seen, last_seen, top_root_cause, avg_mttr_hours
        FROM v_recurring_issues
       ORDER BY occurrences DESC, ci_name;
  END recurring;

  PROCEDURE trend(p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT trend_date, opened, resolved, resolved_by_agent FROM v_daily_trend ORDER BY trend_date;
  END trend;

  PROCEDURE kpis(p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT
        (SELECT COUNT(*) FROM incidents WHERE status NOT IN ('Resolved','Closed'))                          AS open_incidents,
        (SELECT COUNT(*) FROM incidents WHERE status = 'New')                                               AS new_incidents,
        (SELECT COUNT(*) FROM incidents WHERE status NOT IN ('Resolved','Closed') AND priority <= 2)       AS open_high_priority,
        (SELECT ROUND(AVG((CAST(resolved_at AS DATE) - CAST(created_at AS DATE)) * 24), 1)
           FROM incidents WHERE resolved_at >= CAST(SYSTIMESTAMP AS DATE) - 30)                             AS mttr_hours_30d,
        (SELECT ROUND(100 * SUM(CASE WHEN resolved_by = 'agent_approved' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1)
           FROM incidents WHERE resolved_at >= CAST(SYSTIMESTAMP AS DATE) - 30)                             AS pct_resolved_by_agent,
        (SELECT COUNT(*) FROM action_requests WHERE status = 'Pending')                                     AS pending_approvals,
        (SELECT COUNT(*) FROM incidents WHERE created_at >= TRUNC(CAST(SYSTIMESTAMP AS DATE)))              AS created_today,
        (SELECT COUNT(*) FROM incidents WHERE resolved_at >= TRUNC(CAST(SYSTIMESTAMP AS DATE)))             AS resolved_today,
        (SELECT COUNT(*) FROM incidents)                                                                    AS total_incidents,
        (SELECT COUNT(*) FROM equipment WHERE state = 'Down' OR interface_status <> 'Online'
                                           OR (CAST(SYSTIMESTAMP AS DATE) - CAST(last_heartbeat AS DATE)) * 86400 > 600) AS equipment_alerts,
        (SELECT COUNT(*) FROM lots WHERE status = 'Hold')                                                   AS lots_on_hold
      FROM dual;
  END kpis;
END analytics_pkg;
/

SHOW ERRORS
