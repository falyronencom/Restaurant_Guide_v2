-- Migration 036: refresh tokens at rest — hash the rows written before hashing
--
-- The server now stores a refresh token's SHA-256 ('sha256:' + 64 hex) in
-- refresh_tokens.token instead of the token (utils/refreshTokenStorage.js).
-- Rows written before that still hold the tokens themselves; the code finds
-- them by the token as well, so nobody is signed out by the change. This
-- migration hashes those rows in place, so that no token stays readable in
-- the database: live sessions keep working (found by hash from then on),
-- burned rows keep their part in reuse detection. Skipping it breaks
-- nothing — old rows leave by themselves as sessions rotate (within hours
-- for anyone active) or expire (30 days).
--
-- ORDER IS LOAD-BEARING, and it is the usual one: apply on Railway MANUALLY,
-- AFTER the code that stores hashes is deployed (operator action, script
-- backend/scripts/apply-migration-production.js). The code from before
-- hashing cannot find a hashed row: applied under it, this migration would
-- end every session at its next refresh. The guard below refuses to run
-- until at least one row in the new form exists — that is, until the new
-- code has signed someone in or refreshed a session. Do not apply it after
-- rolling the code back to a version from before hashing.
--
-- A data migration: no schema change, production_schema.sql stays as it is,
-- and it is not part of the CI schema recipe (on an empty table the guard
-- refuses by design); refresh-token-storage.test.js applies it itself.
-- Idempotent: a second run finds nothing left to hash.
-- Not reversible — a hash does not give the token back
-- (036_rollback_hash_refresh_tokens.sql says what that means).

BEGIN;

-- Resolve unqualified table names regardless of inherited session search_path.
SET search_path TO public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM refresh_tokens WHERE token LIKE 'sha256:%') THEN
    RAISE EXCEPTION 'Миграция 036 остановлена, база не изменена: в ней ещё нет ни одного токена в новом виде. Сначала дождитесь, пока выкатится код, который хранит токены отпечатком, и войдите в приложение или на сайт хотя бы раз; затем повторите.';
  END IF;
END $$;

-- The same bytes and the same hash as storedRefreshToken: SHA-256 of the
-- token's UTF-8, lowercase hex.
UPDATE refresh_tokens
   SET token = 'sha256:' || encode(sha256(convert_to(token, 'UTF8')), 'hex')
 WHERE token NOT LIKE 'sha256:%';

COMMIT;
