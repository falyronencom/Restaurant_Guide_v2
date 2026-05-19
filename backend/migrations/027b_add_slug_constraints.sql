-- Migration 027b: Lock slug column with NOT NULL + UNIQUE constraints
--
-- Phase B of 027. Run AFTER scripts/backfill-slugs.js has populated all rows.
--
-- Will fail with constraint violation if:
--   - any rows still have NULL slug → backfill incomplete, re-run script
--   - duplicate slugs exist → slugGenerator collision-resolver bug, investigate
--
-- Both failure modes are signals, not bugs — they indicate operator workflow
-- error. The transaction rollback leaves the DB in 027a state (nullable column)
-- so re-running backfill + this file is safe.
--
-- Rollback: 027_rollback_add_slug.sql.

BEGIN;

ALTER TABLE establishments ALTER COLUMN slug SET NOT NULL;

ALTER TABLE establishments ADD CONSTRAINT establishments_slug_unique UNIQUE (slug);

CREATE INDEX idx_establishments_slug ON establishments(slug);

COMMIT;
