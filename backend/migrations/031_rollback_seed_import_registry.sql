-- Rollback 031: drop the seed_import_registry sidecar table.
-- Idempotent. Dropping the table does not touch establishments (the FK is from
-- registry → establishments, not the reverse).

BEGIN;

DROP TABLE IF EXISTS seed_import_registry;

COMMIT;
