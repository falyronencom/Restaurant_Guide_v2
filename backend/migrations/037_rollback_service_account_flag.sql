-- Rollback for Migration 037: drop is_service_account from users
--
-- Idempotent via IF EXISTS — safe to re-run. Application code tolerates the
-- missing column (read through to_jsonb), so rolling back the schema alone
-- does not break login or any request. What is lost: the seed house is no
-- longer recognised — «forgot password» and Google/Yandex sign-in work for it
-- again as for any partner, and the seed scripts stop until the flag returns.

BEGIN;

SET search_path TO public;

ALTER TABLE users
    DROP COLUMN IF EXISTS is_service_account;

COMMIT;
