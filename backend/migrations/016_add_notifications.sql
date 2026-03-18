-- Migration: Add notifications table
-- Date: 2026-03-09
-- Description: Notification system for partners and users
--   Supports: establishment moderation events, new reviews,
--   partner responses, review moderation events.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
  review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Partial index for fast unread count queries (polling endpoint)
CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- Index for paginated list sorted by date
CREATE INDEX idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
