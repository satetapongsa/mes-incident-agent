-- PL/SQL tests for incident_pkg status rules and action_pkg approval rules.
-- Run: docker compose exec -T oracle sqlplus -s mesapp/MesApp_2026@//localhost/FREEPDB1 < db/tests/test_transitions.sql
-- Everything runs inside one block and is rolled back at the end (no data is left behind).
SET SERVEROUTPUT ON SIZE UNLIMITED
SET FEEDBACK OFF
WHENEVER SQLERROR EXIT FAILURE

DECLARE
  v_id      VARCHAR2(15);
  v_act     NUMBER;
  v_status  VARCHAR2(20);
  v_res     VARCHAR2(4000);
  v_pass    PLS_INTEGER := 0;
  v_fail    PLS_INTEGER := 0;

  PROCEDURE ok(p_name VARCHAR2, p_cond BOOLEAN) IS
  BEGIN
    IF p_cond THEN
      v_pass := v_pass + 1;
      DBMS_OUTPUT.PUT_LINE('PASS  ' || p_name);
    ELSE
      v_fail := v_fail + 1;
      DBMS_OUTPUT.PUT_LINE('FAIL  ' || p_name);
    END IF;
  END;

  -- expects the block to raise the given ORA code
  PROCEDURE expect_error(p_name VARCHAR2, p_code PLS_INTEGER, p_sql VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
    ok(p_name || ' (expected ORA' || p_code || ', got no error)', FALSE);
  EXCEPTION
    WHEN OTHERS THEN
      ok(p_name || ' -> ' || REGEXP_SUBSTR(SQLERRM, '^[^' || CHR(10) || ']+'), SQLCODE = p_code);
  END;

  FUNCTION st RETURN VARCHAR2 IS
    s VARCHAR2(20);
  BEGIN
    SELECT status INTO s FROM incidents WHERE incident_id = v_id;
    RETURN s;
  END;
BEGIN
  SAVEPOINT test_start;

  -- transition matrix
  ok('New -> Assigned allowed',          incident_pkg.is_valid_transition('New', 'Assigned') = 1);
  ok('New -> Resolved not allowed',      incident_pkg.is_valid_transition('New', 'Resolved') = 0);
  ok('Pending -> Resolved allowed',      incident_pkg.is_valid_transition('Pending', 'Resolved') = 1);
  ok('Closed -> In Progress not allowed', incident_pkg.is_valid_transition('Closed', 'In Progress') = 0);
  ok('Same status not a transition',     incident_pkg.is_valid_transition('Pending', 'Pending') = 0);

  incident_pkg.create_incident('TEST transition ticket', 'unit test', 3, NULL, NULL, 'MES', 'Lot Management', 'Lot Hold',
                               'WB-01', 'unit_test', 'manual', NULL, v_id);
  ok('create_incident gives INC id', REGEXP_LIKE(v_id, '^INC[0-9]{9}$'));
  ok('new incident is New', st = 'New');

  expect_error('set_status New -> Pending rejected', -20003,
               'BEGIN incident_pkg.set_status(''' || v_id || ''', ''Pending'', ''unit_test''); END;');
  expect_error('set_status to Resolved must use resolve()', -20004,
               'BEGIN incident_pkg.set_status(''' || v_id || ''', ''Resolved'', ''unit_test''); END;');
  expect_error('invalid status value', -20002,
               'BEGIN incident_pkg.set_status(''' || v_id || ''', ''Done'', ''unit_test''); END;');

  incident_pkg.assign(v_id, 'MES Application Support', NULL, 'unit_test');
  ok('assign moves New -> Assigned', st = 'Assigned');
  incident_pkg.set_status(v_id, 'In Progress', 'unit_test');
  ok('Assigned -> In Progress', st = 'In Progress');

  expect_error('resolve without root cause rejected', -20004,
               'BEGIN incident_pkg.resolve(''' || v_id || ''', NULL, ''fix'', ''human'', ''unit_test''); END;');

  -- action approval rules
  action_pkg.create_request(v_id, NULL, 'escalate_to_group', '{"group_name":"Quality Engineering"}', 'low',
                            'unit test escalation', 'agent', v_act);
  ok('action created Pending', v_act IS NOT NULL);
  expect_error('execute before approval rejected', -20021,
               'DECLARE s VARCHAR2(20); r VARCHAR2(4000); BEGIN action_pkg.execute_action(' || v_act || ', ''sup'', s, r); END;');
  expect_error('agent cannot approve its own action', -20024,
               'BEGIN action_pkg.approve(' || v_act || ', ''agent''); END;');
  expect_error('unknown action type rejected', -20023,
               'DECLARE n NUMBER; BEGIN action_pkg.create_request(''' || v_id || ''', NULL, ''drop_table'', ''{}'', ''low'', ''x reason'', ''agent'', n); END;');
  expect_error('missing params rejected', -20023,
               'DECLARE n NUMBER; BEGIN action_pkg.create_request(''' || v_id || ''', NULL, ''release_lot_hold'', ''{"lot_id":"LT0000-0001"}'', ''medium'', ''x reason'', ''agent'', n); END;');

  action_pkg.approve(v_act, 'sup_chaiwat');
  action_pkg.execute_action(v_act, 'sup_chaiwat', v_status, v_res);
  ok('approved escalation executes', v_status = 'Executed');
  ok('escalation reassigns, ticket stays open', st = 'Assigned');

  incident_pkg.resolve(v_id, 'unit test root cause', 'unit test fix', 'human', 'unit_test');
  ok('resolve with root cause works', st = 'Resolved');
  expect_error('Resolved -> Pending rejected', -20003,
               'BEGIN incident_pkg.set_status(''' || v_id || ''', ''Pending'', ''unit_test''); END;');

  ROLLBACK TO test_start;
  DBMS_OUTPUT.PUT_LINE('----');
  DBMS_OUTPUT.PUT_LINE(v_pass || ' passed, ' || v_fail || ' failed');
  IF v_fail > 0 THEN
    RAISE_APPLICATION_ERROR(-20999, v_fail || ' test(s) failed');
  END IF;
END;
/
EXIT
