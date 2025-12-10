-- =====================================================
-- Partner Responses Migration
-- =====================================================
-- Purpose: Add partner response fields to reviews table (MVP, single response)
-- Date: 2025-12-10
-- Author: Codex Max Testing Session
-- =====================================================

BEGIN;

-- Add columns for a single partner response per review
ALTER TABLE reviews
ADD COLUMN IF NOT EXISTS partner_response TEXT,
ADD COLUMN IF NOT EXISTS partner_response_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS partner_responder_id UUID REFERENCES users(id);

-- Optional comment for clarity
COMMENT ON COLUMN reviews.partner_response IS 'Official partner response text for this review (one per review)';
COMMENT ON COLUMN reviews.partner_response_at IS 'Timestamp when partner response was created/updated';
COMMENT ON COLUMN reviews.partner_responder_id IS 'Partner user ID who authored the response';

COMMIT;

