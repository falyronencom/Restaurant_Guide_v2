-- Rollback for Migration 024: OCR menu pipeline
--
-- Reverse order: drop columns referencing menu_items first, then drop tables,
-- then keep pg_trgm extension intact (may be used by other features in future).
--
-- Warning: Dropping menu_items and ocr_jobs destroys all parsed menu data and job history.
-- This is acceptable for rollback since the OCR pipeline has no source-of-truth data —
-- items can be re-parsed from PDFs/photos by re-queueing OCR jobs.

BEGIN;

-- 1. Remove promotions columns in reverse order of addition.
-- discount_price_byn first (no FK dependency), then menu_item_id (has FK to menu_items),
-- then time windows.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promotions' AND column_name = 'discount_price_byn'
    ) THEN
        ALTER TABLE promotions DROP COLUMN discount_price_byn;
        RAISE NOTICE 'Dropped promotions.discount_price_byn';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promotions' AND column_name = 'menu_item_id'
    ) THEN
        ALTER TABLE promotions DROP COLUMN menu_item_id;
        RAISE NOTICE 'Dropped promotions.menu_item_id (FK to menu_items)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promotions' AND column_name = 'valid_until_time'
    ) THEN
        ALTER TABLE promotions DROP COLUMN valid_until_time;
        RAISE NOTICE 'Dropped promotions.valid_until_time';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promotions' AND column_name = 'valid_from_time'
    ) THEN
        ALTER TABLE promotions DROP COLUMN valid_from_time;
        RAISE NOTICE 'Dropped promotions.valid_from_time';
    END IF;
END $$;

-- 2. Drop tables. menu_items has FK to establishment_media (ON DELETE CASCADE),
-- no other tables reference these.
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS ocr_jobs CASCADE;

-- 3. pg_trgm extension is intentionally NOT dropped — it may be used elsewhere
-- and is a schema-global dependency. If explicit removal needed, run manually:
-- DROP EXTENSION IF EXISTS pg_trgm;

COMMIT;
