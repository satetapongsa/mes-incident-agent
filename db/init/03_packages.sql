-- 03_packages.sql : business logic lives here. remedy-api only calls these packages.
--
-- Error codes (RAISE_APPLICATION_ERROR):
--   -20001 incident not found          -20002 invalid status value     -20003 invalid status transition
--   -20004 resolve rules               -20005 invalid priority          -20006 missing required field
--   -20010 lot not found               -20011 equipment not found       -20012 recipe mismatch
--   -20013 equipment not available     -20014 user has no role          -20015 lot on hold
--   -20016 lot in wrong status         -20017 equipment interface down  -20018 invalid equipment state
--   -20019 wrong operation             -20020 action not found          -20021 action not approved
--   -20022 action not pending          -20023 bad action type/params    -20024 agent cannot approve
--   -20025 comment required            -20026 invalid role              -20027 agent run not found
--   -20030 unknown scenario            -20031 no candidate for scenario
ALTER SESSION SET CONTAINER = FREEPDB1;
ALTER SESSION SET CURRENT_SCHEMA = MESAPP;
SET DEFINE OFF
SET SQLBLANKLINES ON

------------------------------------------------------------------
-- audit_pkg
------------------------------------------------------------------
CREATE OR REPLACE PACKAGE audit_pkg AS
  PROCEDURE add_entry(p_who IN VARCHAR2, p_what IN VARCHAR2, p_target IN VARCHAR2,
                      p_before IN VARCHAR2 DEFAULT NULL, p_after IN VARCHAR2 DEFAULT NULL);
  PROCEDURE list_audit(p_limit IN NUMBER, p_cur OUT SYS_REFCURSOR);
END audit_pkg;
/

CREATE OR REPLACE PACKAGE BODY audit_pkg AS
  PROCEDURE add_entry(p_who IN VARCHAR2, p_what IN VARCHAR2, p_target IN VARCHAR2,
                      p_before IN VARCHAR2 DEFAULT NULL, p_after IN VARCHAR2 DEFAULT NULL) IS
  BEGIN
    INSERT INTO audit_log (who, what, target, before_value, after_value)
    VALUES (NVL(p_who, 'unknown'), p_what, NVL(p_target, '-'), SUBSTR(p_before, 1, 4000), SUBSTR(p_after, 1, 4000));
  END add_entry;

  PROCEDURE list_audit(p_limit IN NUMBER, p_cur OUT SYS_REFCURSOR) IS
    v_limit NUMBER := NVL(p_limit, 200);
  BEGIN
    OPEN p_cur FOR
      SELECT id, who, what, target, before_value, after_value, at_time
        FROM audit_log
       ORDER BY id DESC
       FETCH FIRST v_limit ROWS ONLY;
  END list_audit;
END audit_pkg;
/

------------------------------------------------------------------
-- incident_pkg  (Remedy-style incident management)
------------------------------------------------------------------
CREATE OR REPLACE PACKAGE incident_pkg AS
  FUNCTION is_valid_transition(p_from IN VARCHAR2, p_to IN VARCHAR2) RETURN NUMBER;

  PROCEDURE create_incident(p_summary IN VARCHAR2, p_description IN VARCHAR2, p_priority IN NUMBER,
                            p_impact IN VARCHAR2, p_urgency IN VARCHAR2,
                            p_cat1 IN VARCHAR2, p_cat2 IN VARCHAR2, p_cat3 IN VARCHAR2,
                            p_ci_name IN VARCHAR2, p_submitter IN VARCHAR2, p_source IN VARCHAR2,
                            p_assigned_group IN VARCHAR2, p_incident_id OUT VARCHAR2);
  PROCEDURE assign(p_incident_id IN VARCHAR2, p_group IN VARCHAR2, p_assignee IN VARCHAR2, p_user IN VARCHAR2);
  PROCEDURE set_status(p_incident_id IN VARCHAR2, p_status IN VARCHAR2, p_user IN VARCHAR2, p_note IN VARCHAR2 DEFAULT NULL);
  PROCEDURE update_triage(p_incident_id IN VARCHAR2, p_cat1 IN VARCHAR2, p_cat2 IN VARCHAR2, p_cat3 IN VARCHAR2,
                          p_priority IN NUMBER, p_group IN VARCHAR2, p_user IN VARCHAR2);
  PROCEDURE add_worklog(p_incident_id IN VARCHAR2, p_author IN VARCHAR2, p_log_type IN VARCHAR2, p_text IN CLOB);
  PROCEDURE resolve(p_incident_id IN VARCHAR2, p_root_cause IN VARCHAR2, p_resolution IN VARCHAR2,
                    p_resolved_by IN VARCHAR2, p_user IN VARCHAR2);
  PROCEDURE import_incident(p_external_ref IN VARCHAR2, p_summary IN VARCHAR2, p_description IN VARCHAR2,
                            p_priority IN NUMBER, p_cat1 IN VARCHAR2, p_cat2 IN VARCHAR2, p_cat3 IN VARCHAR2,
                            p_ci_name IN VARCHAR2, p_assigned_group IN VARCHAR2, p_submitter IN VARCHAR2,
                            p_status IN VARCHAR2, p_root_cause IN VARCHAR2, p_resolution IN VARCHAR2,
                            p_created_at IN TIMESTAMP, p_resolved_at IN TIMESTAMP,
                            p_incident_id OUT VARCHAR2, p_skipped OUT NUMBER);

  PROCEDURE list_incidents(p_status IN VARCHAR2, p_priority IN NUMBER, p_category IN VARCHAR2,
                           p_search IN VARCHAR2, p_limit IN NUMBER, p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_incident(p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_worklogs(p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  -- Top 5 resolved incidents with a similar summary (Jaro-Winkler) in the same category.
  PROCEDURE find_similar(p_text IN VARCHAR2, p_category IN VARCHAR2, p_exclude_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
END incident_pkg;
/

CREATE OR REPLACE PACKAGE BODY incident_pkg AS

  FUNCTION current_status(p_id IN VARCHAR2) RETURN VARCHAR2 IS
    v_status incidents.status%TYPE;
  BEGIN
    SELECT status INTO v_status FROM incidents WHERE incident_id = p_id;
    RETURN v_status;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20001, 'Incident ' || p_id || ' not found');
  END current_status;

  PROCEDURE check_status_value(p_status IN VARCHAR2) IS
  BEGIN
    IF p_status IS NULL OR p_status NOT IN ('New','Assigned','In Progress','Pending','Resolved','Closed') THEN
      RAISE_APPLICATION_ERROR(-20002, 'Invalid status "' || p_status ||
        '". Allowed: New, Assigned, In Progress, Pending, Resolved, Closed');
    END IF;
  END check_status_value;

  FUNCTION is_valid_transition(p_from IN VARCHAR2, p_to IN VARCHAR2) RETURN NUMBER IS
  BEGIN
    IF p_from = p_to THEN
      RETURN 0;
    END IF;
    RETURN CASE
      WHEN p_from = 'New'         AND p_to IN ('Assigned','In Progress','Closed')     THEN 1
      WHEN p_from = 'Assigned'    AND p_to IN ('In Progress','Pending','Resolved')    THEN 1
      WHEN p_from = 'In Progress' AND p_to IN ('Assigned','Pending','Resolved')       THEN 1
      WHEN p_from = 'Pending'     AND p_to IN ('Assigned','In Progress','Resolved')   THEN 1
      WHEN p_from = 'Resolved'    AND p_to IN ('Closed','In Progress')                THEN 1
      ELSE 0
    END;
  END is_valid_transition;

  PROCEDURE add_worklog(p_incident_id IN VARCHAR2, p_author IN VARCHAR2, p_log_type IN VARCHAR2, p_text IN CLOB) IS
    v_status incidents.status%TYPE;
  BEGIN
    v_status := current_status(p_incident_id);
    IF p_text IS NULL OR DBMS_LOB.GETLENGTH(p_text) = 0 THEN
      RAISE_APPLICATION_ERROR(-20006, 'Worklog text is required');
    END IF;
    IF NVL(p_log_type, 'note') NOT IN ('note','agent_analysis','action','resolution') THEN
      RAISE_APPLICATION_ERROR(-20006, 'Invalid worklog type "' || p_log_type || '"');
    END IF;
    INSERT INTO worklogs (incident_id, author, log_type, text)
    VALUES (p_incident_id, NVL(p_author, 'unknown'), NVL(p_log_type, 'note'), p_text);
  END add_worklog;

  PROCEDURE create_incident(p_summary IN VARCHAR2, p_description IN VARCHAR2, p_priority IN NUMBER,
                            p_impact IN VARCHAR2, p_urgency IN VARCHAR2,
                            p_cat1 IN VARCHAR2, p_cat2 IN VARCHAR2, p_cat3 IN VARCHAR2,
                            p_ci_name IN VARCHAR2, p_submitter IN VARCHAR2, p_source IN VARCHAR2,
                            p_assigned_group IN VARCHAR2, p_incident_id OUT VARCHAR2) IS
    v_status incidents.status%TYPE := 'New';
  BEGIN
    IF TRIM(p_summary) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'Summary is required');
    END IF;
    IF TRIM(p_submitter) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'Submitter is required');
    END IF;
    IF NVL(p_priority, 3) NOT BETWEEN 1 AND 4 THEN
      RAISE_APPLICATION_ERROR(-20005, 'Priority must be 1 (Critical) .. 4 (Low)');
    END IF;
    IF NVL(p_source, 'manual') NOT IN ('manual','simulator','agent','script','import') THEN
      RAISE_APPLICATION_ERROR(-20006, 'Invalid source "' || p_source || '"');
    END IF;
    IF p_assigned_group IS NOT NULL THEN
      v_status := 'Assigned';
    END IF;

    p_incident_id := 'INC' || LPAD(incident_seq.NEXTVAL, 9, '0');
    INSERT INTO incidents (incident_id, summary, description, status, priority, impact, urgency,
                           category_tier1, category_tier2, category_tier3, ci_name, assigned_group,
                           submitter, source)
    VALUES (p_incident_id, SUBSTR(TRIM(p_summary), 1, 200), p_description, v_status, NVL(p_priority, 3),
            NVL(p_impact, '3-Moderate/Limited'), NVL(p_urgency, '3-Medium'),
            p_cat1, p_cat2, p_cat3, UPPER(p_ci_name), p_assigned_group, p_submitter, NVL(p_source, 'manual'));

    add_worklog(p_incident_id, p_submitter, 'note', 'Incident submitted via ' || NVL(p_source, 'manual'));
    audit_pkg.add_entry(p_submitter, 'CREATE_INCIDENT', p_incident_id, NULL, SUBSTR(p_summary, 1, 200));
  END create_incident;

  PROCEDURE set_status(p_incident_id IN VARCHAR2, p_status IN VARCHAR2, p_user IN VARCHAR2, p_note IN VARCHAR2 DEFAULT NULL) IS
    v_from incidents.status%TYPE;
  BEGIN
    check_status_value(p_status);
    v_from := current_status(p_incident_id);
    IF p_status = 'Resolved' THEN
      RAISE_APPLICATION_ERROR(-20004, 'Use resolve() to resolve an incident (root cause and resolution are required)');
    END IF;
    IF is_valid_transition(v_from, p_status) = 0 THEN
      RAISE_APPLICATION_ERROR(-20003, 'Invalid status transition ' || v_from || ' -> ' || p_status ||
                                      ' for ' || p_incident_id);
    END IF;

    UPDATE incidents SET status = p_status, updated_at = SYSTIMESTAMP WHERE incident_id = p_incident_id;
    add_worklog(p_incident_id, p_user, 'note',
                'Status changed ' || v_from || ' -> ' || p_status || CASE WHEN p_note IS NOT NULL THEN ': ' || p_note END);
    audit_pkg.add_entry(p_user, 'SET_STATUS', p_incident_id, v_from, p_status);
  END set_status;

  PROCEDURE assign(p_incident_id IN VARCHAR2, p_group IN VARCHAR2, p_assignee IN VARCHAR2, p_user IN VARCHAR2) IS
    v_from   incidents.status%TYPE;
    v_before VARCHAR2(200);
  BEGIN
    IF TRIM(p_group) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'Assigned group is required');
    END IF;
    v_from := current_status(p_incident_id);
    IF v_from IN ('Resolved','Closed') THEN
      RAISE_APPLICATION_ERROR(-20003, 'Cannot assign ' || p_incident_id || ': incident is ' || v_from);
    END IF;
    SELECT NVL(assigned_group, '-') || ' / ' || NVL(assignee, '-') INTO v_before
      FROM incidents WHERE incident_id = p_incident_id;

    UPDATE incidents
       SET assigned_group = p_group,
           assignee       = p_assignee,
           status         = CASE WHEN is_valid_transition(v_from, 'Assigned') = 1 THEN 'Assigned' ELSE status END,
           updated_at     = SYSTIMESTAMP
     WHERE incident_id = p_incident_id;

    add_worklog(p_incident_id, p_user, 'note',
                'Assigned to group ' || p_group || CASE WHEN p_assignee IS NOT NULL THEN ' (' || p_assignee || ')' END);
    audit_pkg.add_entry(p_user, 'ASSIGN', p_incident_id, v_before, p_group || ' / ' || NVL(p_assignee, '-'));
  END assign;

  PROCEDURE update_triage(p_incident_id IN VARCHAR2, p_cat1 IN VARCHAR2, p_cat2 IN VARCHAR2, p_cat3 IN VARCHAR2,
                          p_priority IN NUMBER, p_group IN VARCHAR2, p_user IN VARCHAR2) IS
    v_from   incidents.status%TYPE;
    v_before VARCHAR2(400);
  BEGIN
    v_from := current_status(p_incident_id);
    IF v_from IN ('Resolved','Closed') THEN
      RAISE_APPLICATION_ERROR(-20003, 'Cannot triage ' || p_incident_id || ': incident is ' || v_from);
    END IF;
    IF p_priority IS NOT NULL AND p_priority NOT BETWEEN 1 AND 4 THEN
      RAISE_APPLICATION_ERROR(-20005, 'Priority must be 1 (Critical) .. 4 (Low)');
    END IF;
    SELECT 'P' || priority || ' ' || NVL(category_tier1, '-') || '/' || NVL(category_tier2, '-') || '/' ||
           NVL(category_tier3, '-') || ' ' || NVL(assigned_group, '-')
      INTO v_before FROM incidents WHERE incident_id = p_incident_id;

    UPDATE incidents
       SET category_tier1 = NVL(p_cat1, category_tier1),
           category_tier2 = NVL(p_cat2, category_tier2),
           category_tier3 = NVL(p_cat3, category_tier3),
           priority       = NVL(p_priority, priority),
           urgency        = CASE NVL(p_priority, priority) WHEN 1 THEN '1-Critical' WHEN 2 THEN '2-High'
                                                           WHEN 3 THEN '3-Medium' ELSE '4-Low' END,
           assigned_group = NVL(p_group, assigned_group),
           status         = CASE WHEN p_group IS NOT NULL AND v_from = 'New' THEN 'Assigned' ELSE status END,
           updated_at     = SYSTIMESTAMP
     WHERE incident_id = p_incident_id;

    add_worklog(p_incident_id, p_user, 'note',
                'Triage: ' || p_cat1 || ' / ' || p_cat2 || ' / ' || p_cat3 || ', priority P' || p_priority ||
                ', group ' || p_group);
    audit_pkg.add_entry(p_user, 'TRIAGE', p_incident_id, v_before,
                        'P' || p_priority || ' ' || p_cat1 || '/' || p_cat2 || '/' || p_cat3 || ' ' || p_group);
  END update_triage;

  PROCEDURE resolve(p_incident_id IN VARCHAR2, p_root_cause IN VARCHAR2, p_resolution IN VARCHAR2,
                    p_resolved_by IN VARCHAR2, p_user IN VARCHAR2) IS
    v_from incidents.status%TYPE;
  BEGIN
    v_from := current_status(p_incident_id);
    IF TRIM(p_root_cause) IS NULL OR TRIM(p_resolution) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20004, 'Root cause and resolution are both required to resolve ' || p_incident_id);
    END IF;
    IF NVL(p_resolved_by, 'human') NOT IN ('human','agent_approved') THEN
      RAISE_APPLICATION_ERROR(-20004, 'resolved_by must be human or agent_approved');
    END IF;
    IF is_valid_transition(v_from, 'Resolved') = 0 THEN
      RAISE_APPLICATION_ERROR(-20003, 'Invalid status transition ' || v_from || ' -> Resolved for ' || p_incident_id);
    END IF;

    UPDATE incidents
       SET status = 'Resolved', root_cause = SUBSTR(p_root_cause, 1, 2000), resolution = SUBSTR(p_resolution, 1, 2000),
           resolved_at = SYSTIMESTAMP, resolved_by = NVL(p_resolved_by, 'human'), updated_at = SYSTIMESTAMP
     WHERE incident_id = p_incident_id;

    add_worklog(p_incident_id, p_user, 'resolution',
                'Resolved (' || NVL(p_resolved_by, 'human') || '). Root cause: ' || p_root_cause ||
                CHR(10) || 'Resolution: ' || p_resolution);
    audit_pkg.add_entry(p_user, 'RESOLVE', p_incident_id, v_from, 'Resolved by ' || NVL(p_resolved_by, 'human'));
  END resolve;

  PROCEDURE import_incident(p_external_ref IN VARCHAR2, p_summary IN VARCHAR2, p_description IN VARCHAR2,
                            p_priority IN NUMBER, p_cat1 IN VARCHAR2, p_cat2 IN VARCHAR2, p_cat3 IN VARCHAR2,
                            p_ci_name IN VARCHAR2, p_assigned_group IN VARCHAR2, p_submitter IN VARCHAR2,
                            p_status IN VARCHAR2, p_root_cause IN VARCHAR2, p_resolution IN VARCHAR2,
                            p_created_at IN TIMESTAMP, p_resolved_at IN TIMESTAMP,
                            p_incident_id OUT VARCHAR2, p_skipped OUT NUMBER) IS
    v_cnt NUMBER;
  BEGIN
    p_skipped := 0;
    IF TRIM(p_external_ref) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'external_ref is required for import');
    END IF;
    SELECT COUNT(*) INTO v_cnt FROM incidents WHERE external_ref = p_external_ref;
    IF v_cnt > 0 THEN
      SELECT incident_id INTO p_incident_id FROM incidents WHERE external_ref = p_external_ref;
      p_skipped := 1;
      RETURN;
    END IF;
    check_status_value(NVL(p_status, 'New'));
    IF TRIM(p_summary) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'Summary is required');
    END IF;
    IF NVL(p_status, 'New') IN ('Resolved','Closed') AND (TRIM(p_root_cause) IS NULL OR TRIM(p_resolution) IS NULL) THEN
      RAISE_APPLICATION_ERROR(-20004, 'Imported resolved incident ' || p_external_ref || ' needs root cause and resolution');
    END IF;
    IF NVL(p_priority, 3) NOT BETWEEN 1 AND 4 THEN
      RAISE_APPLICATION_ERROR(-20005, 'Priority must be 1 (Critical) .. 4 (Low)');
    END IF;

    p_incident_id := 'INC' || LPAD(incident_seq.NEXTVAL, 9, '0');
    INSERT INTO incidents (incident_id, summary, description, status, priority, category_tier1, category_tier2,
                           category_tier3, ci_name, assigned_group, submitter, source, root_cause, resolution,
                           external_ref, created_at, updated_at, resolved_at, resolved_by)
    VALUES (p_incident_id, SUBSTR(p_summary, 1, 200), p_description, NVL(p_status, 'New'), NVL(p_priority, 3),
            p_cat1, p_cat2, p_cat3, UPPER(p_ci_name), p_assigned_group, NVL(p_submitter, 'remedy-import'), 'import',
            p_root_cause, p_resolution, p_external_ref, NVL(p_created_at, SYSTIMESTAMP),
            NVL(p_resolved_at, NVL(p_created_at, SYSTIMESTAMP)),
            CASE WHEN NVL(p_status, 'New') IN ('Resolved','Closed') THEN NVL(p_resolved_at, SYSTIMESTAMP) END,
            CASE WHEN NVL(p_status, 'New') IN ('Resolved','Closed') THEN 'human' END);
    add_worklog(p_incident_id, 'remedy-import', 'note', 'Imported from Remedy export, original id ' || p_external_ref);
    audit_pkg.add_entry('remedy-import', 'IMPORT_INCIDENT', p_incident_id, NULL, p_external_ref);
  END import_incident;

  PROCEDURE list_incidents(p_status IN VARCHAR2, p_priority IN NUMBER, p_category IN VARCHAR2,
                           p_search IN VARCHAR2, p_limit IN NUMBER, p_cur OUT SYS_REFCURSOR) IS
    v_limit  NUMBER := LEAST(NVL(p_limit, 200), 2000);
    v_search VARCHAR2(200) := '%' || UPPER(TRIM(p_search)) || '%';
  BEGIN
    OPEN p_cur FOR
      SELECT incident_id, summary, status, priority, impact, urgency, category_tier1, category_tier2,
             category_tier3, ci_name, assigned_group, assignee, submitter, source, created_at, updated_at,
             resolved_at, resolved_by,
             ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(created_at AS DATE)) * 24, 1) AS age_hours,
             ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(updated_at AS DATE)) * 24, 1) AS idle_hours
        FROM incidents
       WHERE (p_status IS NULL
              OR status = p_status
              OR (p_status = 'Open' AND status NOT IN ('Resolved','Closed')))
         AND (p_priority IS NULL OR priority = p_priority)
         AND (p_category IS NULL OR category_tier3 = p_category OR category_tier1 = p_category)
         AND (TRIM(p_search) IS NULL
              OR UPPER(summary) LIKE v_search
              OR incident_id LIKE v_search
              OR UPPER(ci_name) LIKE v_search)
       ORDER BY created_at DESC, incident_id DESC
       FETCH FIRST v_limit ROWS ONLY;
  END list_incidents;

  PROCEDURE get_incident(p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT incident_id, summary, description, status, priority, impact, urgency, category_tier1,
             category_tier2, category_tier3, ci_name, assigned_group, assignee, submitter, source,
             root_cause, resolution, external_ref, created_at, updated_at, resolved_at, resolved_by,
             ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(created_at AS DATE)) * 24, 1) AS age_hours,
             ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(updated_at AS DATE)) * 24, 1) AS idle_hours
        FROM incidents
       WHERE incident_id = UPPER(p_incident_id);
  END get_incident;

  PROCEDURE get_worklogs(p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT id, incident_id, author, log_type, text, created_at
        FROM worklogs
       WHERE incident_id = UPPER(p_incident_id)
       ORDER BY created_at, id;
  END get_worklogs;

  PROCEDURE find_similar(p_text IN VARCHAR2, p_category IN VARCHAR2, p_exclude_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
    v_text VARCHAR2(200) := UPPER(SUBSTR(TRIM(p_text), 1, 200));
  BEGIN
    IF v_text IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'Text is required for find_similar');
    END IF;
    OPEN p_cur FOR
      SELECT * FROM (
        SELECT i.incident_id, i.summary, i.category_tier3, i.ci_name, i.priority, i.root_cause, i.resolution,
               i.resolved_by, i.resolved_at,
               UTL_MATCH.JARO_WINKLER_SIMILARITY(UPPER(SUBSTR(i.summary, 1, 200)), v_text) AS score
          FROM incidents i
         WHERE i.status IN ('Resolved','Closed')
           AND (p_category IS NULL OR i.category_tier3 = p_category OR i.category_tier1 = p_category)
           AND (p_exclude_id IS NULL OR i.incident_id <> p_exclude_id)
         ORDER BY score DESC, i.resolved_at DESC
      ) WHERE ROWNUM <= 5;
  END find_similar;
END incident_pkg;
/

------------------------------------------------------------------
-- mes_pkg  (Opcenter-style MES transactions)
------------------------------------------------------------------
CREATE OR REPLACE PACKAGE mes_pkg AS
  FUNCTION recipe_for(p_operation IN VARCHAR2, p_product IN VARCHAR2) RETURN VARCHAR2;
  FUNCTION next_operation(p_operation IN VARCHAR2) RETURN VARCHAR2;
  PROCEDURE log_history(p_lot_id IN VARCHAR2, p_event IN VARCHAR2, p_operation IN VARCHAR2, p_equipment_id IN VARCHAR2,
                        p_user IN VARCHAR2, p_comments IN VARCHAR2, p_at IN TIMESTAMP DEFAULT NULL);

  PROCEDURE track_in(p_lot_id IN VARCHAR2, p_equipment_id IN VARCHAR2, p_user IN VARCHAR2);
  PROCEDURE track_out(p_lot_id IN VARCHAR2, p_user IN VARCHAR2);
  PROCEDURE hold_lot(p_lot_id IN VARCHAR2, p_hold_code IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2);
  PROCEDURE release_hold(p_lot_id IN VARCHAR2, p_user IN VARCHAR2, p_comment IN VARCHAR2);
  PROCEDURE set_equipment_state(p_equipment_id IN VARCHAR2, p_state IN VARCHAR2, p_user IN VARCHAR2,
                                p_recipe IN VARCHAR2 DEFAULT NULL);
  PROCEDURE heartbeat(p_equipment_id IN VARCHAR2);
  PROCEDURE heartbeat_all(p_count OUT NUMBER);
  PROCEDURE reset_interface(p_equipment_id IN VARCHAR2, p_user IN VARCHAR2);
  PROCEDURE grant_role(p_user_name IN VARCHAR2, p_role IN VARCHAR2, p_operation IN VARCHAR2, p_granted_by IN VARCHAR2);

  PROCEDURE list_lots(p_status IN VARCHAR2, p_equipment_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_lot(p_lot_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_lot_history(p_lot_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  PROCEDURE list_equipment(p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_equipment(p_equipment_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_user_roles(p_user_name IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  PROCEDURE list_db_sessions(p_min_elapsed IN NUMBER, p_cur OUT SYS_REFCURSOR);
END mes_pkg;
/

CREATE OR REPLACE PACKAGE BODY mes_pkg AS

  FUNCTION lot_row(p_lot_id IN VARCHAR2) RETURN lots%ROWTYPE IS
    r lots%ROWTYPE;
  BEGIN
    SELECT * INTO r FROM lots WHERE lot_id = UPPER(p_lot_id);
    RETURN r;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20010, 'Lot ' || p_lot_id || ' not found');
  END lot_row;

  FUNCTION eq_row(p_equipment_id IN VARCHAR2) RETURN equipment%ROWTYPE IS
    r equipment%ROWTYPE;
  BEGIN
    SELECT * INTO r FROM equipment WHERE equipment_id = UPPER(p_equipment_id);
    RETURN r;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20011, 'Equipment ' || p_equipment_id || ' not found');
  END eq_row;

  FUNCTION recipe_for(p_operation IN VARCHAR2, p_product IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE p_operation
             WHEN 'DIE_ATTACH' THEN 'DA' WHEN 'WIRE_BOND' THEN 'WB' WHEN 'MOLD' THEN 'MD'
             WHEN 'FINAL_TEST' THEN 'TS' WHEN 'WAFER_SORT' THEN 'WP' ELSE 'XX'
           END || '-' || p_product || '-A';
  END recipe_for;

  FUNCTION next_operation(p_operation IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE p_operation
             WHEN 'DIE_ATTACH' THEN 'WIRE_BOND'
             WHEN 'WIRE_BOND'  THEN 'MOLD'
             WHEN 'MOLD'       THEN 'FINAL_TEST'
             ELSE NULL   -- FINAL_TEST and WAFER_SORT are the last step of their route
           END;
  END next_operation;

  PROCEDURE log_history(p_lot_id IN VARCHAR2, p_event IN VARCHAR2, p_operation IN VARCHAR2, p_equipment_id IN VARCHAR2,
                        p_user IN VARCHAR2, p_comments IN VARCHAR2, p_at IN TIMESTAMP DEFAULT NULL) IS
  BEGIN
    INSERT INTO lot_history (lot_id, event, operation, equipment_id, user_name, comments, created_at)
    VALUES (p_lot_id, p_event, p_operation, p_equipment_id, NVL(p_user, 'system'), SUBSTR(p_comments, 1, 500),
            NVL(p_at, SYSTIMESTAMP));
  END log_history;

  PROCEDURE track_in(p_lot_id IN VARCHAR2, p_equipment_id IN VARCHAR2, p_user IN VARCHAR2) IS
    l     lots%ROWTYPE;
    e     equipment%ROWTYPE;
    v_cnt NUMBER;
  BEGIN
    l := lot_row(p_lot_id);
    e := eq_row(p_equipment_id);

    IF l.status = 'Hold' THEN
      RAISE_APPLICATION_ERROR(-20015, 'Lot ' || l.lot_id || ' is on hold (' || l.hold_code || '): ' || l.hold_reason);
    END IF;
    IF l.status <> 'Waiting' THEN
      RAISE_APPLICATION_ERROR(-20016, 'Lot ' || l.lot_id || ' is ' || l.status || '; only Waiting lots can be tracked in');
    END IF;
    IF e.state IN ('Down','Engineering') THEN
      RAISE_APPLICATION_ERROR(-20013, 'Equipment ' || e.equipment_id || ' is ' || e.state || ', not available for production');
    END IF;
    IF e.interface_status <> 'Online' THEN
      RAISE_APPLICATION_ERROR(-20017, 'Equipment ' || e.equipment_id || ' interface is ' || e.interface_status ||
                                      ' (SECS/GEM host communication failed)');
    END IF;
    IF e.operation <> l.operation THEN
      RAISE_APPLICATION_ERROR(-20019, 'Equipment ' || e.equipment_id || ' runs ' || e.operation ||
                                      ' but lot ' || l.lot_id || ' is at ' || l.operation);
    END IF;
    SELECT COUNT(*) INTO v_cnt FROM user_roles WHERE user_name = p_user AND operation IN (l.operation, '*');
    IF v_cnt = 0 THEN
      RAISE_APPLICATION_ERROR(-20014, 'User ' || p_user || ' has no role for operation ' || l.operation ||
                                      ' (not authorized to track in)');
    END IF;
    IF NVL(e.current_recipe, '-') <> l.recipe_required THEN
      RAISE_APPLICATION_ERROR(-20012, 'Recipe mismatch: equipment ' || e.equipment_id || ' has recipe ' ||
                                      NVL(e.current_recipe, '(none)') || ' but lot ' || l.lot_id || ' requires ' ||
                                      l.recipe_required);
    END IF;

    UPDATE lots SET status = 'Running', equipment_id = e.equipment_id, updated_at = SYSTIMESTAMP
     WHERE lot_id = l.lot_id;
    UPDATE equipment SET state = 'Productive', updated_at = SYSTIMESTAMP WHERE equipment_id = e.equipment_id;
    log_history(l.lot_id, 'TRACK_IN', l.operation, e.equipment_id, p_user, 'Track-in with recipe ' || e.current_recipe);
    audit_pkg.add_entry(p_user, 'TRACK_IN', l.lot_id, 'Waiting', 'Running on ' || e.equipment_id);
  END track_in;

  PROCEDURE track_out(p_lot_id IN VARCHAR2, p_user IN VARCHAR2) IS
    l       lots%ROWTYPE;
    v_next  VARCHAR2(30);
    v_cnt   NUMBER;
  BEGIN
    l := lot_row(p_lot_id);
    IF l.status <> 'Running' THEN
      RAISE_APPLICATION_ERROR(-20016, 'Lot ' || l.lot_id || ' is ' || l.status || '; only Running lots can be tracked out');
    END IF;
    v_next := next_operation(l.operation);
    log_history(l.lot_id, 'TRACK_OUT', l.operation, l.equipment_id, p_user, 'Track-out qty ' || l.qty);
    IF v_next IS NULL THEN
      UPDATE lots SET status = 'Completed', updated_at = SYSTIMESTAMP WHERE lot_id = l.lot_id;
    ELSE
      UPDATE lots SET status = 'Waiting', operation = v_next, equipment_id = NULL,
                      recipe_required = recipe_for(v_next, product), updated_at = SYSTIMESTAMP
       WHERE lot_id = l.lot_id;
      log_history(l.lot_id, 'MOVE', v_next, NULL, p_user, 'Moved to ' || v_next);
    END IF;
    SELECT COUNT(*) INTO v_cnt FROM lots WHERE equipment_id = l.equipment_id AND status = 'Running';
    IF v_cnt = 0 THEN
      UPDATE equipment SET state = 'Standby', updated_at = SYSTIMESTAMP
       WHERE equipment_id = l.equipment_id AND state = 'Productive';
    END IF;
    audit_pkg.add_entry(p_user, 'TRACK_OUT', l.lot_id, 'Running at ' || l.operation, NVL(v_next, 'Completed'));
  END track_out;

  PROCEDURE hold_lot(p_lot_id IN VARCHAR2, p_hold_code IN VARCHAR2, p_reason IN VARCHAR2, p_user IN VARCHAR2) IS
    l lots%ROWTYPE;
  BEGIN
    l := lot_row(p_lot_id);
    IF l.status IN ('Hold','Completed') THEN
      RAISE_APPLICATION_ERROR(-20016, 'Lot ' || l.lot_id || ' is ' || l.status || ' and cannot be put on hold');
    END IF;
    IF TRIM(p_hold_code) IS NULL OR TRIM(p_reason) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20025, 'Hold code and reason are required');
    END IF;
    UPDATE lots SET status = 'Hold', hold_code = p_hold_code, hold_reason = p_reason, updated_at = SYSTIMESTAMP
     WHERE lot_id = l.lot_id;
    log_history(l.lot_id, 'HOLD', l.operation, l.equipment_id, p_user, p_hold_code || ': ' || p_reason);
    audit_pkg.add_entry(p_user, 'HOLD_LOT', l.lot_id, l.status, 'Hold ' || p_hold_code);
  END hold_lot;

  PROCEDURE release_hold(p_lot_id IN VARCHAR2, p_user IN VARCHAR2, p_comment IN VARCHAR2) IS
    l lots%ROWTYPE;
  BEGIN
    l := lot_row(p_lot_id);
    IF l.status <> 'Hold' THEN
      RAISE_APPLICATION_ERROR(-20016, 'Lot ' || l.lot_id || ' is ' || l.status || ', not on hold');
    END IF;
    IF TRIM(p_comment) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20025, 'A release comment is required');
    END IF;
    UPDATE lots SET status = 'Waiting', hold_code = NULL, hold_reason = NULL, updated_at = SYSTIMESTAMP
     WHERE lot_id = l.lot_id;
    log_history(l.lot_id, 'RELEASE', l.operation, l.equipment_id, p_user, 'Released ' || l.hold_code || ': ' || p_comment);
    audit_pkg.add_entry(p_user, 'RELEASE_HOLD', l.lot_id, 'Hold ' || l.hold_code, 'Waiting');
  END release_hold;

  PROCEDURE set_equipment_state(p_equipment_id IN VARCHAR2, p_state IN VARCHAR2, p_user IN VARCHAR2,
                                p_recipe IN VARCHAR2 DEFAULT NULL) IS
    e equipment%ROWTYPE;
  BEGIN
    e := eq_row(p_equipment_id);
    IF p_state IS NULL OR p_state NOT IN ('Productive','Standby','Down','Engineering') THEN
      RAISE_APPLICATION_ERROR(-20018, 'Invalid equipment state "' || p_state || '". Allowed: Productive, Standby, Down, Engineering');
    END IF;
    UPDATE equipment
       SET state = p_state, current_recipe = NVL(p_recipe, current_recipe), updated_at = SYSTIMESTAMP
     WHERE equipment_id = e.equipment_id;
    audit_pkg.add_entry(p_user, 'SET_EQUIPMENT_STATE', e.equipment_id,
                        e.state || ' / ' || NVL(e.current_recipe, '-'),
                        p_state || ' / ' || NVL(p_recipe, NVL(e.current_recipe, '-')));
  END set_equipment_state;

  PROCEDURE heartbeat(p_equipment_id IN VARCHAR2) IS
    e equipment%ROWTYPE;
  BEGIN
    e := eq_row(p_equipment_id);
    UPDATE equipment SET last_heartbeat = SYSTIMESTAMP WHERE equipment_id = e.equipment_id;
  END heartbeat;

  -- Called every 30 s by the simulator ("the factory"). Equipment with a hung agent sends nothing.
  PROCEDURE heartbeat_all(p_count OUT NUMBER) IS
  BEGIN
    UPDATE equipment
       SET last_heartbeat = SYSTIMESTAMP
     WHERE interface_status <> 'Offline'
       AND NVL(sim_fault, '-') <> 'HEARTBEAT_STALE';
    p_count := SQL%ROWCOUNT;
  END heartbeat_all;

  PROCEDURE reset_interface(p_equipment_id IN VARCHAR2, p_user IN VARCHAR2) IS
    e equipment%ROWTYPE;
  BEGIN
    e := eq_row(p_equipment_id);
    UPDATE equipment
       SET interface_status = 'Online', last_heartbeat = SYSTIMESTAMP, sim_fault = NULL, updated_at = SYSTIMESTAMP
     WHERE equipment_id = e.equipment_id;
    audit_pkg.add_entry(p_user, 'RESET_INTERFACE', e.equipment_id,
                        'interface ' || e.interface_status || ', heartbeat ' || TO_CHAR(e.last_heartbeat, 'YYYY-MM-DD HH24:MI:SS'),
                        'interface Online, heartbeat now');
  END reset_interface;

  PROCEDURE grant_role(p_user_name IN VARCHAR2, p_role IN VARCHAR2, p_operation IN VARCHAR2, p_granted_by IN VARCHAR2) IS
    v_cnt NUMBER;
  BEGIN
    IF p_role IS NULL OR p_role NOT IN ('OPERATOR','TECHNICIAN','ENGINEER','SUPERVISOR') THEN
      RAISE_APPLICATION_ERROR(-20026, 'Invalid role "' || p_role || '"');
    END IF;
    IF TRIM(p_user_name) IS NULL OR TRIM(p_operation) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'User name and operation are required');
    END IF;
    SELECT COUNT(*) INTO v_cnt FROM user_roles
     WHERE user_name = p_user_name AND role = p_role AND operation = p_operation;
    IF v_cnt = 0 THEN
      INSERT INTO user_roles (user_name, role, operation, granted_by) VALUES (p_user_name, p_role, p_operation, p_granted_by);
    END IF;
    audit_pkg.add_entry(p_granted_by, 'GRANT_ROLE', p_user_name,
                        CASE WHEN v_cnt = 0 THEN 'no ' || p_role || ' role for ' || p_operation ELSE 'already granted' END,
                        p_role || ' @ ' || p_operation);
  END grant_role;

  PROCEDURE list_lots(p_status IN VARCHAR2, p_equipment_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT l.lot_id, l.product, l.route, l.operation, l.equipment_id, l.status, l.hold_code, l.hold_reason,
             l.qty, l.recipe_required, l.updated_at
        FROM lots l
       WHERE (p_status IS NULL OR l.status = p_status)
         AND (p_equipment_id IS NULL OR l.equipment_id = UPPER(p_equipment_id))
       ORDER BY CASE l.status WHEN 'Hold' THEN 1 WHEN 'Running' THEN 2 WHEN 'Waiting' THEN 3 ELSE 4 END, l.lot_id;
  END list_lots;

  PROCEDURE get_lot(p_lot_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT l.lot_id, l.product, l.route, l.operation, l.equipment_id, l.status, l.hold_code, l.hold_reason,
             l.qty, l.recipe_required, l.updated_at,
             e.current_recipe   AS equipment_recipe,
             e.state            AS equipment_state,
             e.interface_status AS equipment_interface,
             CASE WHEN e.equipment_id IS NULL THEN NULL
                  WHEN e.current_recipe = l.recipe_required THEN 'Y' ELSE 'N' END AS recipe_match,
             ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(l.updated_at AS DATE)) * 24 * 60) AS minutes_in_status
        FROM lots l
        LEFT JOIN equipment e ON e.equipment_id = l.equipment_id
       WHERE l.lot_id = UPPER(p_lot_id);
  END get_lot;

  PROCEDURE get_lot_history(p_lot_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT id, lot_id, event, operation, equipment_id, user_name, comments, created_at
        FROM lot_history
       WHERE lot_id = UPPER(p_lot_id)
       ORDER BY created_at, id;
  END get_lot_history;

  PROCEDURE list_equipment(p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT e.equipment_id, e.eq_type, e.area, e.operation, e.state, e.current_recipe, e.last_heartbeat,
             e.interface_status, e.updated_at,
             ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(e.last_heartbeat AS DATE)) * 86400) AS heartbeat_age_sec,
             (SELECT COUNT(*) FROM lots l WHERE l.equipment_id = e.equipment_id AND l.status = 'Running') AS running_lots,
             (SELECT COUNT(*) FROM lots l WHERE l.equipment_id = e.equipment_id AND l.status IN ('Waiting','Hold')) AS queued_lots
        FROM equipment e
       ORDER BY e.equipment_id;
  END list_equipment;

  PROCEDURE get_equipment(p_equipment_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT e.equipment_id, e.eq_type, e.area, e.operation, e.state, e.current_recipe, e.last_heartbeat,
             e.interface_status, e.updated_at,
             ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(e.last_heartbeat AS DATE)) * 86400) AS heartbeat_age_sec,
             (SELECT COUNT(*) FROM lots l WHERE l.equipment_id = e.equipment_id AND l.status = 'Running') AS running_lots,
             (SELECT COUNT(*) FROM lots l WHERE l.equipment_id = e.equipment_id AND l.status IN ('Waiting','Hold')) AS queued_lots
        FROM equipment e
       WHERE e.equipment_id = UPPER(p_equipment_id);
  END get_equipment;

  PROCEDURE get_user_roles(p_user_name IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT user_name, role, operation, granted_by, granted_at
        FROM user_roles
       WHERE user_name = LOWER(p_user_name)
       ORDER BY operation, role;
  END get_user_roles;

  PROCEDURE list_db_sessions(p_min_elapsed IN NUMBER, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT session_id, username, module, sql_id, sql_text, elapsed_sec, wait_event, status, started_at
        FROM db_sessions
       WHERE elapsed_sec >= NVL(p_min_elapsed, 0)
       ORDER BY elapsed_sec DESC;
  END list_db_sessions;
END mes_pkg;
/

------------------------------------------------------------------
-- action_pkg  (human-approved actions proposed by the agent)
------------------------------------------------------------------
CREATE OR REPLACE PACKAGE action_pkg AS
  PROCEDURE create_request(p_incident_id IN VARCHAR2, p_run_id IN NUMBER, p_action_type IN VARCHAR2,
                           p_params IN CLOB, p_risk IN VARCHAR2, p_reason IN VARCHAR2, p_requested_by IN VARCHAR2,
                           p_id OUT NUMBER);
  PROCEDURE approve(p_id IN NUMBER, p_user IN VARCHAR2);
  PROCEDURE reject(p_id IN NUMBER, p_user IN VARCHAR2, p_comment IN VARCHAR2);
  -- Only runs when status = Approved. Maps action_type to mes_pkg / incident_pkg calls.
  PROCEDURE execute_action(p_id IN NUMBER, p_approver IN VARCHAR2, p_status OUT VARCHAR2, p_result OUT VARCHAR2);
  PROCEDURE list_requests(p_status IN VARCHAR2, p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_request(p_id IN NUMBER, p_cur OUT SYS_REFCURSOR);
END action_pkg;
/

CREATE OR REPLACE PACKAGE BODY action_pkg AS

  FUNCTION req_row(p_id IN NUMBER, p_lock IN BOOLEAN DEFAULT FALSE) RETURN action_requests%ROWTYPE IS
    r action_requests%ROWTYPE;
  BEGIN
    IF p_lock THEN
      SELECT * INTO r FROM action_requests WHERE id = p_id FOR UPDATE;
    ELSE
      SELECT * INTO r FROM action_requests WHERE id = p_id;
    END IF;
    RETURN r;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20020, 'Action request #' || p_id || ' not found');
  END req_row;

  PROCEDURE require_param(p_value IN VARCHAR2, p_name IN VARCHAR2, p_type IN VARCHAR2) IS
  BEGIN
    IF TRIM(p_value) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20023, 'Missing parameter "' || p_name || '" for action ' || p_type);
    END IF;
  END require_param;

  PROCEDURE create_request(p_incident_id IN VARCHAR2, p_run_id IN NUMBER, p_action_type IN VARCHAR2,
                           p_params IN CLOB, p_risk IN VARCHAR2, p_reason IN VARCHAR2, p_requested_by IN VARCHAR2,
                           p_id OUT NUMBER) IS
    v_cnt    NUMBER;
    v_status incidents.status%TYPE;
    v_lot VARCHAR2(100); v_comment VARCHAR2(500); v_eq VARCHAR2(100); v_state VARCHAR2(100);
    v_user VARCHAR2(100); v_role VARCHAR2(100); v_op VARCHAR2(100); v_group VARCHAR2(100);
  BEGIN
    BEGIN
      SELECT status INTO v_status FROM incidents WHERE incident_id = p_incident_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20001, 'Incident ' || p_incident_id || ' not found');
    END;
    IF v_status IN ('Resolved','Closed') THEN
      RAISE_APPLICATION_ERROR(-20003, 'Incident ' || p_incident_id || ' is ' || v_status || '; cannot propose actions');
    END IF;
    IF p_action_type IS NULL OR p_action_type NOT IN
       ('release_lot_hold','set_equipment_state','reset_interface','grant_user_role','escalate_to_group') THEN
      RAISE_APPLICATION_ERROR(-20023, 'Unknown action_type "' || p_action_type || '"');
    END IF;
    IF p_risk IS NULL OR p_risk NOT IN ('low','medium','high') THEN
      RAISE_APPLICATION_ERROR(-20023, 'Risk must be low, medium or high');
    END IF;
    IF TRIM(p_reason) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20023, 'A reason is required for every action request');
    END IF;
    SELECT COUNT(*) INTO v_cnt FROM dual WHERE p_params IS JSON;
    IF v_cnt = 0 THEN
      RAISE_APPLICATION_ERROR(-20023, 'params must be a valid JSON object');
    END IF;

    SELECT JSON_VALUE(p_params, '$.lot_id'), JSON_VALUE(p_params, '$.comment'),
           JSON_VALUE(p_params, '$.equipment_id'), JSON_VALUE(p_params, '$.state'),
           JSON_VALUE(p_params, '$.user_name'), JSON_VALUE(p_params, '$.role'),
           JSON_VALUE(p_params, '$.operation'), JSON_VALUE(p_params, '$.group_name')
      INTO v_lot, v_comment, v_eq, v_state, v_user, v_role, v_op, v_group
      FROM dual;

    CASE p_action_type
      WHEN 'release_lot_hold'    THEN require_param(v_lot, 'lot_id', p_action_type);
                                      require_param(v_comment, 'comment', p_action_type);
      WHEN 'set_equipment_state' THEN require_param(v_eq, 'equipment_id', p_action_type);
                                      require_param(v_state, 'state', p_action_type);
      WHEN 'reset_interface'     THEN require_param(v_eq, 'equipment_id', p_action_type);
      WHEN 'grant_user_role'     THEN require_param(v_user, 'user_name', p_action_type);
                                      require_param(v_role, 'role', p_action_type);
                                      require_param(v_op, 'operation', p_action_type);
      WHEN 'escalate_to_group'   THEN require_param(v_group, 'group_name', p_action_type);
    END CASE;

    -- Only one open proposal per incident: older pending ones are superseded.
    UPDATE action_requests
       SET status = 'Rejected', decided_by = 'system', decided_at = SYSTIMESTAMP,
           result = 'Superseded by a newer proposal'
     WHERE incident_id = p_incident_id AND status = 'Pending';

    INSERT INTO action_requests (incident_id, run_id, action_type, params, risk, reason, requested_by)
    VALUES (p_incident_id, p_run_id, p_action_type, p_params, p_risk, SUBSTR(p_reason, 1, 2000), NVL(p_requested_by, 'agent'))
    RETURNING id INTO p_id;

    incident_pkg.add_worklog(p_incident_id, NVL(p_requested_by, 'agent'), 'action',
                             'Proposed action #' || p_id || ' ' || p_action_type || ' (risk ' || p_risk ||
                             ') - waiting for human approval. Reason: ' || p_reason);
    audit_pkg.add_entry(NVL(p_requested_by, 'agent'), 'PROPOSE_ACTION', 'ACTION#' || p_id,
                        NULL, p_action_type || ' ' || DBMS_LOB.SUBSTR(p_params, 3000, 1));
  END create_request;

  PROCEDURE approve(p_id IN NUMBER, p_user IN VARCHAR2) IS
    r action_requests%ROWTYPE;
  BEGIN
    r := req_row(p_id, TRUE);
    IF TRIM(p_user) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'Approver name is required');
    END IF;
    IF LOWER(p_user) IN ('agent','mcp-server','system') THEN
      RAISE_APPLICATION_ERROR(-20024, 'The agent cannot approve its own action requests; a human must approve');
    END IF;
    IF r.status <> 'Pending' THEN
      RAISE_APPLICATION_ERROR(-20022, 'Action request #' || p_id || ' is ' || r.status || ', not Pending');
    END IF;
    UPDATE action_requests SET status = 'Approved', decided_by = p_user, decided_at = SYSTIMESTAMP WHERE id = p_id;
    incident_pkg.add_worklog(r.incident_id, p_user, 'action', 'Action #' || p_id || ' ' || r.action_type || ' approved by ' || p_user);
    audit_pkg.add_entry(p_user, 'APPROVE_ACTION', 'ACTION#' || p_id, 'Pending', 'Approved');
  END approve;

  PROCEDURE reject(p_id IN NUMBER, p_user IN VARCHAR2, p_comment IN VARCHAR2) IS
    r        action_requests%ROWTYPE;
    v_status incidents.status%TYPE;
  BEGIN
    r := req_row(p_id, TRUE);
    IF TRIM(p_user) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20006, 'Reviewer name is required');
    END IF;
    IF r.status <> 'Pending' THEN
      RAISE_APPLICATION_ERROR(-20022, 'Action request #' || p_id || ' is ' || r.status || ', not Pending');
    END IF;
    UPDATE action_requests
       SET status = 'Rejected', decided_by = p_user, decided_at = SYSTIMESTAMP,
           result = 'Rejected: ' || NVL(p_comment, '(no comment)')
     WHERE id = p_id;
    incident_pkg.add_worklog(r.incident_id, p_user, 'action',
                             'Action #' || p_id || ' ' || r.action_type || ' rejected by ' || p_user || ': ' || NVL(p_comment, '(no comment)'));
    SELECT status INTO v_status FROM incidents WHERE incident_id = r.incident_id;
    IF v_status = 'Pending' THEN
      incident_pkg.set_status(r.incident_id, 'In Progress', p_user, 'agent proposal rejected, back to manual handling');
    END IF;
    audit_pkg.add_entry(p_user, 'REJECT_ACTION', 'ACTION#' || p_id, 'Pending', 'Rejected');
  END reject;

  PROCEDURE execute_action(p_id IN NUMBER, p_approver IN VARCHAR2, p_status OUT VARCHAR2, p_result OUT VARCHAR2) IS
    r     action_requests%ROWTYPE;
    v_res VARCHAR2(4000);
    v_lot VARCHAR2(100); v_comment VARCHAR2(500); v_eq VARCHAR2(100); v_state VARCHAR2(100); v_recipe VARCHAR2(100);
    v_user VARCHAR2(100); v_role VARCHAR2(100); v_op VARCHAR2(100); v_group VARCHAR2(100);
    v_who VARCHAR2(60);
  BEGIN
    r := req_row(p_id, TRUE);
    IF r.status <> 'Approved' THEN
      RAISE_APPLICATION_ERROR(-20021, 'Action request #' || p_id || ' is ' || r.status || '; only Approved actions can be executed');
    END IF;
    v_who := NVL(r.decided_by, p_approver);

    SELECT JSON_VALUE(r.params, '$.lot_id'), JSON_VALUE(r.params, '$.comment'),
           JSON_VALUE(r.params, '$.equipment_id'), JSON_VALUE(r.params, '$.state'), JSON_VALUE(r.params, '$.recipe'),
           JSON_VALUE(r.params, '$.user_name'), JSON_VALUE(r.params, '$.role'),
           JSON_VALUE(r.params, '$.operation'), JSON_VALUE(r.params, '$.group_name')
      INTO v_lot, v_comment, v_eq, v_state, v_recipe, v_user, v_role, v_op, v_group
      FROM dual;

    SAVEPOINT before_execute;
    BEGIN
      CASE r.action_type
        WHEN 'release_lot_hold' THEN
          mes_pkg.release_hold(v_lot, v_who, v_comment || ' (approved action #' || p_id || ')');
          v_res := 'Lot ' || v_lot || ' released from hold, status is now Waiting';
        WHEN 'set_equipment_state' THEN
          mes_pkg.set_equipment_state(v_eq, v_state, v_who, v_recipe);
          v_res := 'Equipment ' || v_eq || ' set to ' || v_state || CASE WHEN v_recipe IS NOT NULL THEN ' with recipe ' || v_recipe END;
        WHEN 'reset_interface' THEN
          mes_pkg.reset_interface(v_eq, v_who);
          v_res := 'Equipment ' || v_eq || ' interface reset, status Online, heartbeat refreshed';
        WHEN 'grant_user_role' THEN
          mes_pkg.grant_role(LOWER(v_user), v_role, v_op, v_who);
          v_res := 'Granted ' || v_role || ' for ' || v_op || ' to ' || LOWER(v_user);
        WHEN 'escalate_to_group' THEN
          incident_pkg.assign(r.incident_id, v_group, NULL, v_who);
          v_res := 'Incident escalated to ' || v_group || ' (no automatic fix)';
      END CASE;

      UPDATE action_requests SET status = 'Executed', executed_at = SYSTIMESTAMP, result = v_res WHERE id = p_id;
      incident_pkg.add_worklog(r.incident_id, v_who, 'action', 'Action #' || p_id || ' ' || r.action_type ||
                               ' executed (approved by ' || v_who || '): ' || v_res);
      audit_pkg.add_entry(v_who, 'EXECUTE_ACTION', 'ACTION#' || p_id || ' ' || r.action_type,
                          DBMS_LOB.SUBSTR(r.params, 3000, 1), v_res);
      p_status := 'Executed';
    EXCEPTION
      WHEN OTHERS THEN
        v_res := SUBSTR(REGEXP_REPLACE(SQLERRM, '^ORA-[0-9]+: ', ''), 1, 4000);
        ROLLBACK TO before_execute;
        UPDATE action_requests SET status = 'Failed', executed_at = SYSTIMESTAMP, result = v_res WHERE id = p_id;
        incident_pkg.add_worklog(r.incident_id, v_who, 'action', 'Action #' || p_id || ' ' || r.action_type || ' FAILED: ' || v_res);
        audit_pkg.add_entry(v_who, 'EXECUTE_ACTION_FAILED', 'ACTION#' || p_id || ' ' || r.action_type,
                            DBMS_LOB.SUBSTR(r.params, 3000, 1), v_res);
        p_status := 'Failed';
    END;
    p_result := v_res;
  END execute_action;

  PROCEDURE list_requests(p_status IN VARCHAR2, p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT a.id, a.incident_id, a.run_id, a.action_type, a.params, a.risk, a.reason, a.status, a.requested_by,
             a.created_at, a.decided_by, a.decided_at, a.executed_at, a.result,
             i.summary AS incident_summary, i.priority AS incident_priority, i.status AS incident_status
        FROM action_requests a
        JOIN incidents i ON i.incident_id = a.incident_id
       WHERE (p_status IS NULL OR a.status = p_status)
         AND (p_incident_id IS NULL OR a.incident_id = UPPER(p_incident_id))
       ORDER BY a.id DESC;
  END list_requests;

  PROCEDURE get_request(p_id IN NUMBER, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT a.id, a.incident_id, a.run_id, a.action_type, a.params, a.risk, a.reason, a.status, a.requested_by,
             a.created_at, a.decided_by, a.decided_at, a.executed_at, a.result,
             i.summary AS incident_summary, i.priority AS incident_priority, i.status AS incident_status
        FROM action_requests a
        JOIN incidents i ON i.incident_id = a.incident_id
       WHERE a.id = p_id;
  END get_request;
END action_pkg;
/

------------------------------------------------------------------
-- agent_pkg  (persist agent runs and steps)
------------------------------------------------------------------
CREATE OR REPLACE PACKAGE agent_pkg AS
  PROCEDURE start_run(p_incident_id IN VARCHAR2, p_llm_mode IN VARCHAR2, p_run_id OUT NUMBER);
  PROCEDURE add_step(p_run_id IN NUMBER, p_step_type IN VARCHAR2, p_content IN CLOB, p_step_no OUT NUMBER);
  PROCEDURE finish_run(p_run_id IN NUMBER, p_status IN VARCHAR2, p_skill_used IN VARCHAR2, p_summary IN VARCHAR2,
                       p_root_cause IN VARCHAR2, p_tool_calls IN NUMBER);
  PROCEDURE get_run(p_run_id IN NUMBER, p_cur OUT SYS_REFCURSOR);
  PROCEDURE get_steps(p_run_id IN NUMBER, p_cur OUT SYS_REFCURSOR);
  PROCEDURE list_runs(p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR);
END agent_pkg;
/

CREATE OR REPLACE PACKAGE BODY agent_pkg AS
  PROCEDURE start_run(p_incident_id IN VARCHAR2, p_llm_mode IN VARCHAR2, p_run_id OUT NUMBER) IS
    v_cnt NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_cnt FROM incidents WHERE incident_id = UPPER(p_incident_id);
    IF v_cnt = 0 THEN
      RAISE_APPLICATION_ERROR(-20001, 'Incident ' || p_incident_id || ' not found');
    END IF;
    IF NVL(p_llm_mode, '-') NOT IN ('llm','mock') THEN
      RAISE_APPLICATION_ERROR(-20006, 'llm_mode must be llm or mock');
    END IF;
    INSERT INTO agent_runs (incident_id, llm_mode) VALUES (UPPER(p_incident_id), p_llm_mode)
    RETURNING run_id INTO p_run_id;
    audit_pkg.add_entry('agent', 'START_RUN', 'RUN#' || p_run_id, NULL, UPPER(p_incident_id) || ' mode ' || p_llm_mode);
  END start_run;

  PROCEDURE add_step(p_run_id IN NUMBER, p_step_type IN VARCHAR2, p_content IN CLOB, p_step_no OUT NUMBER) IS
    v_cnt NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_cnt FROM agent_runs WHERE run_id = p_run_id;
    IF v_cnt = 0 THEN
      RAISE_APPLICATION_ERROR(-20027, 'Agent run ' || p_run_id || ' not found');
    END IF;
    SELECT NVL(MAX(step_no), 0) + 1 INTO p_step_no FROM agent_steps WHERE run_id = p_run_id;
    INSERT INTO agent_steps (run_id, step_no, step_type, content) VALUES (p_run_id, p_step_no, p_step_type, p_content);
  END add_step;

  PROCEDURE finish_run(p_run_id IN NUMBER, p_status IN VARCHAR2, p_skill_used IN VARCHAR2, p_summary IN VARCHAR2,
                       p_root_cause IN VARCHAR2, p_tool_calls IN NUMBER) IS
  BEGIN
    UPDATE agent_runs
       SET status = NVL(p_status, 'Completed'), skill_used = NVL(p_skill_used, skill_used),
           summary = SUBSTR(NVL(p_summary, summary), 1, 4000), root_cause = SUBSTR(NVL(p_root_cause, root_cause), 1, 2000),
           tool_calls = NVL(p_tool_calls, tool_calls), finished_at = SYSTIMESTAMP
     WHERE run_id = p_run_id;
    IF SQL%ROWCOUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20027, 'Agent run ' || p_run_id || ' not found');
    END IF;
  END finish_run;

  PROCEDURE get_run(p_run_id IN NUMBER, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT run_id, incident_id, skill_used, status, llm_mode, tool_calls, root_cause, summary, started_at, finished_at
        FROM agent_runs WHERE run_id = p_run_id;
  END get_run;

  PROCEDURE get_steps(p_run_id IN NUMBER, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT run_id, step_no, step_type, content, created_at
        FROM agent_steps WHERE run_id = p_run_id ORDER BY step_no;
  END get_steps;

  PROCEDURE list_runs(p_incident_id IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_cur FOR
      SELECT run_id, incident_id, skill_used, status, llm_mode, tool_calls, root_cause, summary, started_at, finished_at
        FROM agent_runs
       WHERE (p_incident_id IS NULL OR incident_id = UPPER(p_incident_id))
       ORDER BY run_id DESC
       FETCH FIRST 50 ROWS ONLY;
  END list_runs;
END agent_pkg;
/

------------------------------------------------------------------
-- sim_pkg  (failure injection: breaks MES data, then opens a ticket like an operator would)
------------------------------------------------------------------
CREATE OR REPLACE PACKAGE sim_pkg AS
  PROCEDURE inject(p_scenario IN VARCHAR2, p_target IN VARCHAR2, p_incident_id OUT VARCHAR2, p_detail OUT VARCHAR2);
END sim_pkg;
/

CREATE OR REPLACE PACKAGE BODY sim_pkg AS
  -- Thai phrases as UNISTR so the script does not depend on the client character set
  FUNCTION th(p_key IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE p_key
      WHEN 'urgent'   THEN UNISTR('\0E0A\0E48\0E27\0E22\0E14\0E39\0E14\0E48\0E27\0E19')
      WHEN 'norecv'   THEN UNISTR('\0E40\0E04\0E23\0E37\0E48\0E2D\0E07\0E44\0E21\0E48\0E23\0E31\0E1A')
      WHEN 'slow'     THEN UNISTR('\0E0A\0E49\0E32\0E21\0E32\0E01')
      WHEN 'ka'       THEN UNISTR('\0E04\0E48\0E30')
      WHEN 'krub'     THEN UNISTR('\0E04\0E23\0E31\0E1A')
      WHEN 'cannot'   THEN UNISTR('\0E44\0E21\0E48\0E44\0E14\0E49')
      WHEN 'newstaff' THEN UNISTR('\0E1E\0E19\0E31\0E01\0E07\0E32\0E19\0E43\0E2B\0E21\0E48')
      WHEN 'thanks'   THEN UNISTR('\0E02\0E2D\0E1A\0E04\0E38\0E13\0E04\0E23\0E31\0E1A')
    END;
  END th;

  FUNCTION clean_err(p_msg IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REGEXP_REPLACE(REGEXP_SUBSTR(p_msg, '^[^' || CHR(10) || ']+'), '^ORA-[0-9]+: ', '');
  END clean_err;

  FUNCTION rnd_product RETURN VARCHAR2 IS
    v NUMBER := TRUNC(DBMS_RANDOM.VALUE(1, 6));
  BEGIN
    RETURN CASE v WHEN 1 THEN 'QFN48' WHEN 2 THEN 'TSSOP20' WHEN 3 THEN 'LQFP64' WHEN 4 THEN 'TO247' ELSE 'DFN8' END;
  END rnd_product;

  FUNCTION pick_operator(p_operation IN VARCHAR2) RETURN VARCHAR2 IS
    v VARCHAR2(60);
  BEGIN
    SELECT user_name INTO v FROM (
      SELECT user_name FROM user_roles
       WHERE role = 'OPERATOR' AND operation = p_operation
       ORDER BY DBMS_RANDOM.VALUE)
     WHERE ROWNUM = 1;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      INSERT INTO user_roles (user_name, role, operation, granted_by) VALUES ('op_somchai', 'OPERATOR', p_operation, 'simulator');
      RETURN 'op_somchai';
  END pick_operator;

  FUNCTION new_lot(p_operation IN VARCHAR2) RETURN lots%ROWTYPE IS
    r lots%ROWTYPE;
  BEGIN
    r.lot_id          := 'LT' || TO_CHAR(SYSDATE, 'YYMM') || '-' || LPAD(lot_seq.NEXTVAL, 4, '0');
    r.product         := rnd_product;
    r.route           := CASE p_operation WHEN 'FINAL_TEST' THEN 'TEST-STD' WHEN 'WAFER_SORT' THEN 'WSORT-STD' ELSE 'ASSY-STD' END;
    r.operation       := p_operation;
    r.status          := 'Waiting';
    r.qty             := ROUND(DBMS_RANDOM.VALUE(800, 5000), -2);
    r.recipe_required := mes_pkg.recipe_for(p_operation, r.product);
    r.updated_at      := SYSTIMESTAMP;
    INSERT INTO lots VALUES r;
    mes_pkg.log_history(r.lot_id, 'MOVE', p_operation, NULL, 'mes_dispatcher', 'Lot arrived at ' || p_operation);
    RETURN r;
  END new_lot;

  FUNCTION pick_waiting_lot(p_operation IN VARCHAR2, p_lot_id IN VARCHAR2 DEFAULT NULL) RETURN lots%ROWTYPE IS
    r lots%ROWTYPE;
  BEGIN
    IF p_lot_id IS NOT NULL THEN
      SELECT * INTO r FROM lots WHERE lot_id = UPPER(p_lot_id);
      RETURN r;
    END IF;
    SELECT * INTO r FROM (
      SELECT * FROM lots WHERE status = 'Waiting' AND operation = p_operation ORDER BY DBMS_RANDOM.VALUE)
     WHERE ROWNUM = 1;
    RETURN r;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      IF p_lot_id IS NOT NULL THEN
        RAISE_APPLICATION_ERROR(-20010, 'Lot ' || p_lot_id || ' not found');
      END IF;
      RETURN new_lot(p_operation);
  END pick_waiting_lot;

  -- Equipment that can take a lot right now: available, online, no fault, no running lot.
  FUNCTION free_equipment(p_operation IN VARCHAR2) RETURN VARCHAR2 IS
    v VARCHAR2(20);
  BEGIN
    SELECT equipment_id INTO v FROM (
      SELECT e.equipment_id FROM equipment e
       WHERE e.operation = p_operation
         AND e.state IN ('Standby','Productive')
         AND e.interface_status = 'Online'
         AND e.sim_fault IS NULL
         AND NOT EXISTS (SELECT 1 FROM lots l WHERE l.equipment_id = e.equipment_id AND l.status = 'Running')
       ORDER BY DBMS_RANDOM.VALUE)
     WHERE ROWNUM = 1;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END free_equipment;

  FUNCTION any_equipment(p_operation IN VARCHAR2) RETURN VARCHAR2 IS
    v VARCHAR2(20);
  BEGIN
    SELECT equipment_id INTO v FROM (
      SELECT equipment_id FROM equipment WHERE operation = p_operation ORDER BY DBMS_RANDOM.VALUE)
     WHERE ROWNUM = 1;
    RETURN v;
  END any_equipment;

  PROCEDURE inject(p_scenario IN VARCHAR2, p_target IN VARCHAR2, p_incident_id OUT VARCHAR2, p_detail OUT VARCHAR2) IS
    v_lot     lots%ROWTYPE;
    v_eq      VARCHAR2(20);
    v_op      VARCHAR2(30);
    v_user    VARCHAR2(60);
    v_err     VARCHAR2(500);
    v_summary VARCHAR2(200);
    v_desc    VARCHAR2(4000);
    v_ci      VARCHAR2(50);
    v_product VARCHAR2(30);
    v_cnt     NUMBER;
    v_sid     NUMBER;
    v_elapsed NUMBER;
  BEGIN
    CASE p_scenario
    ------------------------------------------------------------------
    WHEN 'lot-hold-stuck' THEN
      v_op  := CASE WHEN DBMS_RANDOM.VALUE < 0.5 THEN 'WIRE_BOND' ELSE 'MOLD' END;
      v_lot := pick_waiting_lot(v_op, p_target);
      v_op  := v_lot.operation;
      v_eq  := any_equipment(v_op);
      UPDATE lots
         SET status = 'Hold', hold_code = 'SPC-OOC', equipment_id = v_eq,
             hold_reason = 'SPC out of control: ' || CASE v_op WHEN 'MOLD' THEN 'mold void rate above UCL'
                                                               ELSE 'wire pull strength below LCL' END,
             updated_at = SYSTIMESTAMP - INTERVAL '3' HOUR
       WHERE lot_id = v_lot.lot_id;
      mes_pkg.log_history(v_lot.lot_id, 'HOLD', v_op, v_eq, 'spc_system',
                          'SPC-OOC: auto hold by SPC rule WE1 (1 point beyond control limit)', SYSTIMESTAMP - INTERVAL '3' HOUR);
      mes_pkg.log_history(v_lot.lot_id, 'SPC_REVIEW', v_op, v_eq, 'qe_kanya',
                          'SPC review completed. Disposition: RELEASE. Re-measured 32 units, all within spec.',
                          SYSTIMESTAMP - INTERVAL '70' MINUTE);
      v_user    := pick_operator(v_op);
      v_ci      := v_eq;
      v_summary := 'Lot ' || v_lot.lot_id || ' still on HOLD after SPC review done';
      v_desc    := 'Hi, lot ' || v_lot.lot_id || ' (' || v_lot.product || ') at ' || v_eq ||
                   ' still status Hold code SPC-OOC. QE (K. Kanya) already reviewed and approved release about 1 hour ago' ||
                   ' but MES status not change. Line is waiting for this lot, please release ' || th('ka');
      p_detail  := 'lot ' || v_lot.lot_id || ' put on SPC hold with completed SPC review';

    ------------------------------------------------------------------
    WHEN 'trackin-recipe-mismatch' THEN
      IF p_target IS NOT NULL THEN
        v_eq := UPPER(p_target);
        SELECT operation INTO v_op FROM equipment WHERE equipment_id = v_eq;
      ELSE
        v_op := CASE WHEN DBMS_RANDOM.VALUE < 0.5 THEN 'WIRE_BOND' ELSE 'DIE_ATTACH' END;
        v_eq := free_equipment(v_op);
        IF v_eq IS NULL THEN
          v_op := CASE v_op WHEN 'WIRE_BOND' THEN 'DIE_ATTACH' ELSE 'WIRE_BOND' END;
          v_eq := free_equipment(v_op);
        END IF;
        IF v_eq IS NULL THEN
          RAISE_APPLICATION_ERROR(-20031, 'No free wire bonder or die attach equipment for this scenario');
        END IF;
      END IF;
      v_lot := pick_waiting_lot(v_op);
      LOOP
        v_product := rnd_product;
        EXIT WHEN v_product <> v_lot.product;
      END LOOP;
      UPDATE equipment SET current_recipe = mes_pkg.recipe_for(v_op, v_product), state = 'Standby', updated_at = SYSTIMESTAMP
       WHERE equipment_id = v_eq;
      UPDATE lots SET equipment_id = v_eq WHERE lot_id = v_lot.lot_id;
      v_user := pick_operator(v_op);
      BEGIN
        mes_pkg.track_in(v_lot.lot_id, v_eq, v_user);
      EXCEPTION WHEN OTHERS THEN
        v_err := clean_err(SQLERRM);
      END;
      mes_pkg.log_history(v_lot.lot_id, 'TRACKIN_FAIL', v_op, v_eq, v_user, v_err);
      v_ci      := v_eq;
      v_summary := 'Cannot track-in lot ' || v_lot.lot_id || ' on ' || v_eq || ' - recipe mismatch error';
      v_desc    := 'Track in fail at ' || v_eq || ' for lot ' || v_lot.lot_id || ': "' || v_err || '". ' ||
                   'Product changeover just finished on this machine. Lot cannot start, ' || th('urgent');
      p_detail  := v_eq || ' loaded with wrong recipe for lot ' || v_lot.lot_id;

    ------------------------------------------------------------------
    WHEN 'equipment-heartbeat-stale' THEN
      IF p_target IS NOT NULL THEN
        v_eq := UPPER(p_target);
      ELSE
        SELECT COUNT(*) INTO v_cnt FROM equipment WHERE equipment_id = 'TS-02' AND sim_fault IS NULL AND state <> 'Down';
        IF v_cnt > 0 AND DBMS_RANDOM.VALUE < 0.5 THEN
          v_eq := 'TS-02';
        ELSE
          BEGIN
            SELECT equipment_id INTO v_eq FROM (
              SELECT equipment_id FROM equipment
               WHERE state = 'Productive' AND interface_status = 'Online' AND sim_fault IS NULL
               ORDER BY DBMS_RANDOM.VALUE) WHERE ROWNUM = 1;
          EXCEPTION WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20031, 'No productive equipment without a fault for this scenario');
          END;
        END IF;
      END IF;
      UPDATE equipment
         SET state = 'Productive', interface_status = 'Online', sim_fault = 'HEARTBEAT_STALE',
             last_heartbeat = SYSTIMESTAMP - INTERVAL '25' MINUTE, updated_at = SYSTIMESTAMP
       WHERE equipment_id = v_eq;
      v_user    := 'op_malee';
      v_ci      := v_eq;
      v_summary := v_eq || ' shows Productive in MES but no update since 20 min';
      v_desc    := 'MES dashboard show ' || v_eq || ' Productive but lot qty not move for 20+ min and no new data.' ||
                   ' Tool screen looks normal. MES not update? ' || th('urgent');
      p_detail  := v_eq || ' equipment agent stopped sending heartbeats';

    ------------------------------------------------------------------
    WHEN 'interface-timeout' THEN
      IF p_target IS NOT NULL THEN
        v_eq := UPPER(p_target);
      ELSE
        SELECT COUNT(*) INTO v_cnt FROM equipment WHERE equipment_id = 'WB-03' AND sim_fault IS NULL AND state <> 'Down';
        IF v_cnt > 0 AND DBMS_RANDOM.VALUE < 0.6 THEN
          v_eq := 'WB-03';
        ELSE
          BEGIN
            SELECT equipment_id INTO v_eq FROM (
              SELECT equipment_id FROM equipment
               WHERE state IN ('Productive','Standby') AND interface_status = 'Online' AND sim_fault IS NULL
                 AND operation IN ('WIRE_BOND','DIE_ATTACH','MOLD')
               ORDER BY DBMS_RANDOM.VALUE) WHERE ROWNUM = 1;
          EXCEPTION WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20031, 'No online assembly equipment for this scenario');
          END;
        END IF;
      END IF;
      SELECT operation INTO v_op FROM equipment WHERE equipment_id = v_eq;
      UPDATE equipment SET interface_status = 'Timeout', sim_fault = 'INTERFACE_TIMEOUT', updated_at = SYSTIMESTAMP
       WHERE equipment_id = v_eq;
      v_lot  := pick_waiting_lot(v_op);
      UPDATE lots SET equipment_id = v_eq WHERE lot_id = v_lot.lot_id;
      v_user := pick_operator(v_op);
      BEGIN
        mes_pkg.track_in(v_lot.lot_id, v_eq, v_user);
      EXCEPTION WHEN OTHERS THEN
        v_err := clean_err(SQLERRM);
      END;
      mes_pkg.log_history(v_lot.lot_id, 'TRACKIN_FAIL', v_op, v_eq, v_user, v_err);
      v_ci      := v_eq;
      v_summary := v_eq || ' cannot start lot - SECS/GEM communication timeout';
      v_desc    := 'Host show S1F13 communication timeout on ' || v_eq || '. ' || th('norecv') || ' lot ' || v_lot.lot_id ||
                   '. Operator already restart tool UI, still same. Error: "' || v_err || '"';
      p_detail  := v_eq || ' SECS/GEM interface set to Timeout';

    ------------------------------------------------------------------
    WHEN 'user-permission-missing' THEN
      v_eq := NULL;
      FOR o IN (SELECT column_value AS op FROM TABLE(sys.odcivarchar2list('FINAL_TEST','WAFER_SORT','MOLD','DIE_ATTACH','WIRE_BOND'))
                 ORDER BY CASE WHEN column_value IN ('FINAL_TEST','WAFER_SORT','MOLD') THEN 0 ELSE 1 END, DBMS_RANDOM.VALUE) LOOP
        v_eq := free_equipment(o.op);
        IF v_eq IS NOT NULL THEN
          v_op := o.op;
          EXIT;
        END IF;
      END LOOP;
      IF v_eq IS NULL THEN
        RAISE_APPLICATION_ERROR(-20031, 'No free equipment for this scenario');
      END IF;
      v_lot := pick_waiting_lot(v_op);
      -- equipment is set up correctly for the lot: the only problem will be the missing role
      UPDATE equipment SET current_recipe = v_lot.recipe_required, state = 'Standby', updated_at = SYSTIMESTAMP
       WHERE equipment_id = v_eq;
      UPDATE lots SET equipment_id = v_eq WHERE lot_id = v_lot.lot_id;
      IF p_target IS NOT NULL THEN
        v_user := LOWER(p_target);
      ELSE
        v_user := CASE TRUNC(DBMS_RANDOM.VALUE(1, 4)) WHEN 1 THEN 'op_pranee' WHEN 2 THEN 'op_thanakorn' ELSE 'op_jiraporn' END;
      END IF;
      DELETE FROM user_roles WHERE user_name = v_user AND operation IN (v_op, '*');
      SELECT COUNT(*) INTO v_cnt FROM user_roles WHERE user_name = v_user;
      IF v_cnt = 0 THEN
        INSERT INTO user_roles (user_name, role, operation, granted_by)
        VALUES (v_user, 'OPERATOR', CASE WHEN v_op = 'DIE_ATTACH' THEN 'WIRE_BOND' ELSE 'DIE_ATTACH' END, 'hr_onboarding');
      END IF;
      BEGIN
        mes_pkg.track_in(v_lot.lot_id, v_eq, v_user);
      EXCEPTION WHEN OTHERS THEN
        v_err := clean_err(SQLERRM);
      END;
      mes_pkg.log_history(v_lot.lot_id, 'TRACKIN_FAIL', v_op, v_eq, v_user, v_err);
      v_ci      := v_eq;
      v_summary := 'Operator ' || v_user || ' cannot track-in at ' || v_op || ' - not authorized';
      v_desc    := v_user || ' (' || th('newstaff') || ', moved from line 2) ' || th('cannot') || ' track in lot ' ||
                   v_lot.lot_id || ' on ' || v_eq || '. Error: "' || v_err || '". Training finished last week. ' || th('thanks');
      p_detail  := 'role for ' || v_op || ' removed from ' || v_user;

    ------------------------------------------------------------------
    WHEN 'db-slow-query' THEN
      SELECT NVL(MAX(session_id), 1000) + TRUNC(DBMS_RANDOM.VALUE(1, 50)) INTO v_sid FROM db_sessions;
      v_elapsed := TRUNC(DBMS_RANDOM.VALUE(1500, 2400));
      INSERT INTO db_sessions (session_id, username, module, sql_id, sql_text, elapsed_sec, wait_event, status, started_at)
      VALUES (v_sid, 'RPT_USER', 'YieldReport', DBMS_RANDOM.STRING('l', 13),
              'SELECT l.product, h.operation, COUNT(*) FROM lot_history h JOIN lots l ON l.lot_id = h.lot_id ' ||
              'WHERE TRUNC(h.created_at) BETWEEN :d1 AND :d2 GROUP BY l.product, h.operation',
              v_elapsed, 'db file scattered read', 'ACTIVE', SYSTIMESTAMP - NUMTODSINTERVAL(v_elapsed, 'SECOND'));
      v_user    := 'sup_chaiwat';
      v_ci      := 'MESDB01';
      v_summary := 'Yield report page very slow (more than 5 min)';
      v_desc    := 'Yield report page loading > 5 min since morning, ' || th('slow') ||
                   '. Other MES pages OK. Need this report for 9:00 production meeting.';
      p_detail  := 'long running report session ' || v_sid || ' (' || v_elapsed || ' s)';

    ELSE
      RAISE_APPLICATION_ERROR(-20030, 'Unknown scenario "' || p_scenario || '". Use lot-hold-stuck, trackin-recipe-mismatch, ' ||
                                      'equipment-heartbeat-stale, interface-timeout, user-permission-missing, db-slow-query');
    END CASE;

    incident_pkg.create_incident(v_summary, v_desc, 3, '3-Moderate/Limited', '3-Medium', NULL, NULL, NULL,
                                 v_ci, v_user, 'simulator', NULL, p_incident_id);
    audit_pkg.add_entry('simulator', 'INJECT_FAILURE', p_scenario, NULL, p_incident_id || ': ' || p_detail);
  END inject;
END sim_pkg;
/

SHOW ERRORS
