-- Migration 014: Add performance index on audit_log.action
-- Improves filtering by action type in admin audit log screen
-- Note: created_at index was already added in migration 013

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
