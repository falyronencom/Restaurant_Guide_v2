-- Rollback for Migration 035: drop sessions_revoked_at from users
--
-- Idempotent via IF EXISTS — safe to re-run. Application code tolerates the
-- missing column (read through to_jsonb, write under a savepoint), so rolling
-- back the schema alone does not break login, refresh or any authenticated
-- request. What is lost: access tokens issued before an account's last
-- password reset, reuse alarm or takeover work again until they expire
-- (at most JWT_ACCESS_EXPIRY, 4 h) — the behaviour before 035.

BEGIN;

SET search_path TO public;

ALTER TABLE users
    DROP COLUMN IF EXISTS sessions_revoked_at;

COMMIT;
