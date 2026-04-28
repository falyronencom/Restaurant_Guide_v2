-- Rollback for Migration 026: drop email_verification_codes table
--
-- Idempotent via IF EXISTS — safe to re-run.

BEGIN;

DROP TABLE IF EXISTS email_verification_codes;

COMMIT;
