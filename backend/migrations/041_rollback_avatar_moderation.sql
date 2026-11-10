-- Rollback 041: forget the approvals and the files still to be removed.
--
-- The code keeps working (it reads the column through to_jsonb and asks for the
-- table before use): nobody's photo is shown to other people again until 041 is
-- applied anew and a moderator approves it; the panel's approve and take-down
-- refuse with a text; a person's own clear or replace removes the old file once,
-- without a retry. Rows still open are lost with the table — look at them first:
--   SELECT status, reason, count(*) FROM avatar_file_deletions GROUP BY 1, 2;

BEGIN;

-- As in 041: wait for the locks at most 5 s; on a timeout nothing is dropped.
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS avatar_file_deletions;

ALTER TABLE users DROP COLUMN IF EXISTS avatar_approved_url;

COMMIT;
