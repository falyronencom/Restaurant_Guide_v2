-- =====================================================
-- Migration 019: Claiming Infrastructure
--
-- Adds columns to support admin-driven establishment claiming:
-- - is_seed: marks establishments created by seed script
-- - claimed_at: timestamp when establishment was claimed by a real partner
-- - claimed_by: UUID of the admin who performed the claiming action
--
-- Backfill: marks all establishments owned by the seed partner account
-- (seed.data.generator@restaurantguide.by) as is_seed=TRUE.
-- =====================================================

-- Add claiming columns
ALTER TABLE establishments
  ADD COLUMN IF NOT EXISTS is_seed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES users(id);

-- Index for querying unclaimed seed establishments
CREATE INDEX IF NOT EXISTS idx_establishments_is_seed
  ON establishments(is_seed) WHERE is_seed = TRUE;

-- Backfill: mark seed-generated establishments
UPDATE establishments
SET is_seed = TRUE
WHERE partner_id = (
  SELECT id FROM users WHERE email = 'seed.data.generator@restaurantguide.by'
);
