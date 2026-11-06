-- Rollback 040: forget what is still to be removed from the cloud.
--
-- The code keeps working (it checks for the table before use): a deletion goes
-- back to destroying the current picture once, without a retry, and the loop
-- stays silent. Rows still open are lost with the table; the folders stay
-- derivable from the journal (audit_log, action user_delete_account). Look at
-- them first:
--   SELECT status, count(*) FROM avatar_deletions GROUP BY status;

BEGIN;

-- As in 040: wait for the locks at most 5 s; on a timeout nothing is dropped.
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS avatar_deletions;

COMMIT;
