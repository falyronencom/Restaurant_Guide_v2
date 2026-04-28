-- Migration 026: Add email_verification_codes table for email verification flow
--
-- Stores 6-digit numeric codes sent to users via email for account verification.
-- Pattern modeled after refresh_tokens: single-use, expiring tokens linked to
-- users via CASCADE FK. CASCADE ensures orphan codes are removed when a user is
-- deleted.
--
-- Architectural choice — 6-digit codes (not token-based deep links):
--   Aligns with existing mobile UI (email_verification_screen.dart uses six
--   TextEditingControllers for digit entry). Avoids deep-link infrastructure
--   setup (universal links / app links, DNS, asset associations).
--
-- Security model:
--   Codes are stored plaintext — a 10^6 search space makes hashing useless.
--   Defense relies on:
--     * short expiry (default 15 minutes, configurable via env)
--     * per-code attempts counter (max 5 verification attempts)
--     * rate limit on send endpoint (per user, per hour)
--
-- Used by:
--   POST /api/v1/auth/send-verification-code  (creates row, invalidates old)
--   POST /api/v1/auth/verify-email-code       (validates, marks used_at)

BEGIN;

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP,
    attempts SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user_id
    ON email_verification_codes(user_id);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at
    ON email_verification_codes(expires_at);

COMMIT;
