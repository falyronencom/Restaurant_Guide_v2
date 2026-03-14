-- =====================================================
-- Migration 013: Add Analytics Performance Indexes
-- =====================================================
-- Purpose: Add B-tree indexes on created_at columns for tables
-- used in analytics timeline queries (users, establishments,
-- reviews, audit_log).
--
-- Queries that benefit:
--   - getUserRegistrationTimeline()  → users.created_at
--   - getEstablishmentCreationTimeline() → establishments.created_at
--   - getReviewTimeline(), countReviewsInPeriod() → reviews.created_at
--   - getModerationCounts() → audit_log.created_at
--
-- The reviews index is partial (WHERE is_deleted = false AND is_visible = true)
-- to match the exact filter pattern used by all analytics review queries.
--
-- Current data is small (~77 establishments, ~281 reviews), but these
-- indexes prevent degradation as data grows.
-- =====================================================

-- Users: registration timeline queries
CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users(created_at DESC);

-- Establishments: creation timeline queries
CREATE INDEX IF NOT EXISTS idx_establishments_created_at
  ON establishments(created_at DESC);

-- Reviews: timeline + period count queries (partial index matching analytics filters)
CREATE INDEX IF NOT EXISTS idx_reviews_created_at_visible
  ON reviews(created_at DESC)
  WHERE is_deleted = false AND is_visible = true;

-- Audit log: moderation actions timeline queries
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log(created_at DESC);
