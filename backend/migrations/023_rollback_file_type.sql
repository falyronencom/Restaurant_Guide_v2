-- =====================================================
-- Rollback 023: Remove file_type column from establishment_media
-- =====================================================
-- Purpose: Reverse migration 023 if deploy issues occur.
--
-- Columns to remove:
-- - file_type (VARCHAR(10), CHECK constraint)
--
-- Indexes to remove:
-- - idx_media_type_file_type
--
-- WARNING: This rollback is DESTRUCTIVE. All file_type data will be lost.
-- PDF media rows will still exist but caller code will be unable to
-- distinguish PDF from image records. Before rollback, ensure no PDF
-- records exist in establishment_media, or back them up.
-- =====================================================

BEGIN;

-- Drop composite index first (depends on file_type column)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'establishment_media'
        AND indexname = 'idx_media_type_file_type'
    ) THEN
        DROP INDEX idx_media_type_file_type;
        RAISE NOTICE 'Dropped index idx_media_type_file_type';
    END IF;
END $$;

-- Drop file_type column (cascades CHECK constraint)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'establishment_media'
        AND column_name = 'file_type'
    ) THEN
        ALTER TABLE establishment_media
        DROP COLUMN file_type;

        RAISE NOTICE 'Dropped column file_type';
        RAISE WARNING 'file_type classification data has been permanently deleted';
    END IF;
END $$;

-- Verify column was dropped
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'establishment_media'
AND column_name = 'file_type';

COMMIT;
