-- Rollback for Migration 032: drop password_reset_tokens table
--
-- Idempotent via IF EXISTS — safe to re-run.

BEGIN;

DROP TABLE IF EXISTS password_reset_tokens;

COMMIT;
