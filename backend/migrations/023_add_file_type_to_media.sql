-- Migration 023: Add file_type column to establishment_media
-- Enables storing PDF menu files alongside image media.
-- Existing rows default to 'image' (all current media are photos).
--
-- Supports: Task 1 — PDF Menu Upload (Segment A, architecture contract 2026-04-17)
-- Tables affected: establishment_media (ADD COLUMN)

-- =====================================================
-- 1. Add file_type column with CHECK constraint
-- =====================================================

ALTER TABLE establishment_media
    ADD COLUMN IF NOT EXISTS file_type VARCHAR(10) NOT NULL DEFAULT 'image'
    CHECK (file_type IN ('image', 'pdf'));

-- =====================================================
-- 2. Index for filtering menu PDFs separately in gallery
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_media_type_file_type
    ON establishment_media(establishment_id, type, file_type);
