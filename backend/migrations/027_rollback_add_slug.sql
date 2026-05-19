-- Rollback for migration 027 (both 027a and 027b)
--
-- Idempotent: handles partial state safely.
--   - Only 027a applied (nullable column, no constraints): drops column.
--   - Both 027a and 027b applied: drops index, constraint, then column.
--   - Nothing applied: no-op (IF EXISTS clauses tolerate missing objects).
--
-- Use case: development reset, or recovery from failed deployment.
-- Production rollback should also clear any in-flight 027 work — verify
-- no concurrent backfill is running before applying this.

BEGIN;

DROP INDEX IF EXISTS idx_establishments_slug;

ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_slug_unique;

ALTER TABLE establishments DROP COLUMN IF EXISTS slug;

COMMIT;
