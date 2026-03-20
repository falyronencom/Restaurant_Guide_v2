-- Migration 017: Activate Partner Analytics
-- Adds call_count column to the ghost establishment_analytics table
-- and creates a composite index for efficient partner queries.
--
-- The establishment_analytics table already exists (production_schema.sql:231-245)
-- with columns: view_count, detail_view_count, favorite_count, review_count,
-- promotion_view_count. This migration adds the missing call_count column
-- and optimizes indexes for partner-scoped time-series queries.

-- Add call_count column for phone tap tracking
ALTER TABLE establishment_analytics
ADD COLUMN IF NOT EXISTS call_count INTEGER DEFAULT 0;

-- Composite index for partner analytics queries:
-- efficiently supports WHERE establishment_id = X AND date BETWEEN Y AND Z
CREATE INDEX IF NOT EXISTS idx_analytics_establishment_date
ON establishment_analytics(establishment_id, date);

-- Update the production_schema.sql comment to reflect activation
COMMENT ON TABLE establishment_analytics IS 'Per-day event counters for partner analytics. Activated in migration 017.';
