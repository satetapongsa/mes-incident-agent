-- 01_user.sql
-- The MESAPP user itself is created by the gvenzl image (APP_USER / APP_USER_PASSWORD)
-- in FREEPDB1 before these scripts run. Here we give it the extra privileges it needs.
ALTER SESSION SET CONTAINER = FREEPDB1;

GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE TO mesapp;
ALTER USER mesapp QUOTA UNLIMITED ON users;
GRANT EXECUTE ON sys.utl_match TO mesapp;
GRANT EXECUTE ON sys.dbms_random TO mesapp;
