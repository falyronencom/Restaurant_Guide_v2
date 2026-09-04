-- Rollback for Migration 033: drop menu_push_enabled from notification_preferences
--
-- Idempotent via IF EXISTS — safe to re-run. Data loss is limited to the
-- per-user «Меню» toggle; on re-apply every user is back to the default TRUE.
-- Application code tolerates the missing column (SELECT * + conditional
-- UPSERT shape), so rolling back the schema alone does not break reads.

BEGIN;

SET search_path TO public;

ALTER TABLE notification_preferences
    DROP COLUMN IF EXISTS menu_push_enabled;

COMMIT;
