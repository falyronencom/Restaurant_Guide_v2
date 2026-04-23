-- Rollback for Migration 025: drop hidden_reason from menu_items
--
-- Idempotent via DO-block existence check — safe to re-run.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'menu_items' AND column_name = 'hidden_reason'
    ) THEN
        ALTER TABLE menu_items DROP COLUMN hidden_reason;
        RAISE NOTICE 'Dropped menu_items.hidden_reason';
    END IF;
END $$;

COMMIT;
