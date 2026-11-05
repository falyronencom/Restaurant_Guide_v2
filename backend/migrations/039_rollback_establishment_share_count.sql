-- Rollback 039: forget how many times cards were sent on.
--
-- The counted shares are lost. The code keeps working (models/shareCountSql.js):
-- the partner's figures read 0.

BEGIN;

-- As in 039: wait for the lock at most 5 s; on a timeout nothing is dropped.
SET LOCAL lock_timeout = '5s';

ALTER TABLE establishment_analytics DROP COLUMN IF EXISTS share_count;

COMMIT;
