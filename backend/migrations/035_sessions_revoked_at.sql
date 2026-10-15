-- Migration 035: users.sessions_revoked_at — tokens issued before it are refused
--
-- An access token lives JWT_ACCESS_EXPIRY (4 h), and until now nothing but
-- switching the account off (services/accountStatus.js, 2026-10-07) ended it
-- early. A password reset, a detected refresh-token reuse and the takeover of
-- an unconfirmed record by the owner of its address burned (or deleted) every
-- refresh token, while the access tokens already issued kept working until
-- they expired (remainder of critics' finding F-18 / C-05). Each of those
-- events now stamps this column; a token issued before the stamp is refused
-- from the next request — an access token by authenticate, a refresh token by
-- the refresh endpoint — with 401 TOKEN_REVOKED.
--
-- TIMESTAMPTZ, unlike the naive timestamps elsewhere in this schema: the stamp
-- is compared with the issue time carried inside the token (milliseconds since
-- the epoch, an absolute instant). A naive column would come back shifted by
-- the process's offset.
--
-- Deploy order is NOT load-bearing: the code reads the column through
-- to_jsonb(users) — NULL while it does not exist — and writes it under a
-- savepoint, skipping the write (with a warning in the log) when the column is
-- missing. Until this migration is applied, the three events behave exactly as
-- before 035: refresh tokens die, access tokens live out their TTL. Apply on
-- Railway MANUALLY after merge (operator action, script
-- backend/scripts/apply-migration-production.js); regenerate
-- production_schema.sql only after that — the snapshot mirrors production,
-- not the catalogue.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). A nullable column without a default
-- changes the catalogue only — no table rewrite.
-- Rollback: 035_rollback_sessions_revoked_at.sql.

BEGIN;

-- Resolve unqualified table names regardless of inherited session search_path.
SET search_path TO public;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;

COMMIT;
