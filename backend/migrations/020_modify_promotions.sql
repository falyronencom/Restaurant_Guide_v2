-- Migration 020: Modify promotions table for Component 4
-- Adds image URL columns, replaces is_active BOOLEAN with status VARCHAR,
-- adds updated_at trigger, and updates indexes.
--
-- Existing table: production_schema.sql:189-205
-- Changes: +image_url, +thumbnail_url, +preview_url, is_active→status, updated index

-- 1. Add image URL columns (three-tier Cloudinary pattern)
ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS preview_url VARCHAR(500);

-- 2. Replace is_active BOOLEAN with status VARCHAR
-- First: add new status column with default derived from is_active
ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Migrate existing data: is_active=true → 'active', is_active=false → 'expired'
UPDATE promotions SET status = CASE
  WHEN is_active = true THEN 'active'
  ELSE 'expired'
END
WHERE status IS NULL OR status = 'active';

-- Add CHECK constraint on status
ALTER TABLE promotions
  ADD CONSTRAINT chk_promotions_status
  CHECK (status IN ('active', 'expired', 'hidden_by_admin'));

-- Drop old is_active column
ALTER TABLE promotions DROP COLUMN IF EXISTS is_active;

-- 3. Make valid_from optional (default to today), valid_until nullable (null = indefinite)
ALTER TABLE promotions ALTER COLUMN valid_from SET DEFAULT CURRENT_DATE;
ALTER TABLE promotions ALTER COLUMN valid_until DROP NOT NULL;

-- 4. Drop old index and create new one on (establishment_id, status)
DROP INDEX IF EXISTS idx_promotions_active;
CREATE INDEX idx_promotions_status ON promotions(establishment_id, status);
