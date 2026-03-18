-- Migration: Add oauth_provider_id column to users table
-- Purpose: Store external user ID from OAuth providers (Google sub, Yandex id)
-- Date: 2026-03-06

-- Add column for OAuth provider's external user ID
ALTER TABLE users ADD COLUMN oauth_provider_id VARCHAR(255);

-- Unique compound index: prevents duplicate OAuth accounts per provider
-- Partial index (WHERE NOT NULL) so email/phone users aren't affected
CREATE UNIQUE INDEX idx_users_oauth_provider
  ON users(auth_method, oauth_provider_id)
  WHERE oauth_provider_id IS NOT NULL;
