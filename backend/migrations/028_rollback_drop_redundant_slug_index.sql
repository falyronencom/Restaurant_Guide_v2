-- Rollback for migration 028.
--
-- Recreates the explicit B-tree index on establishments.slug. Functionally
-- redundant with the UNIQUE constraint's implicit index — this rollback
-- exists for pattern consistency with other migration pairs and to restore
-- pre-028 schema shape exactly.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_establishments_slug ON establishments(slug);

COMMIT;
