-- Migration 032: Add password_reset_tokens table for password reset flow
--
-- Stores single-use, expiring reset tokens linked to users via CASCADE FK.
-- Pattern modeled after email_verification_codes (026) / refresh_tokens.
--
-- Security model:
--   Tokens are high-entropy (32 random bytes, hex-encoded in the email link)
--   and stored HASHED (SHA-256, 64 hex chars) — a database leak yields no
--   usable reset tokens. Unlike the 6-digit verification codes (10^6 search
--   space makes hashing useless there), a 256-bit token makes hashing at
--   rest meaningful. Defense layers:
--     * hash at rest
--     * short expiry (default 30 minutes, env PASSWORD_RESET_EXPIRY_MINUTES)
--     * single-use (used_at set on consume, claim-before-update)
--     * per-user issue throttle in service layer (5/hour, DB count)
--     * per-IP rate limit on both endpoints (Redis)
--
-- Used by:
--   POST /api/v1/auth/forgot-password  (creates row, invalidates prior active)
--   POST /api/v1/auth/reset-password   (validates, marks used_at, revokes all
--                                       refresh tokens for the user)

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
    ON password_reset_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
    ON password_reset_tokens(token_hash);

COMMIT;
