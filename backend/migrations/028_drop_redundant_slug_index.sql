-- Migration 028: Drop redundant explicit B-tree index on establishments.slug
--
-- Brief 0 (migration 027b) created TWO B-tree indexes on the same column:
--   1. The implicit index backing the UNIQUE constraint
--      (establishments_slug_unique)
--   2. An explicit additional index (idx_establishments_slug)
--
-- The two indexes serve identical query patterns (equality lookups via
-- findEstablishmentBySlug). PostgreSQL optimizer picks one and ignores
-- the other; meanwhile every INSERT/UPDATE touching the slug column
-- pays the maintenance cost on both, and both occupy disk space.
--
-- The UNIQUE constraint's implicit index is sufficient. This migration
-- drops the redundant explicit index. No application-level behaviour
-- change — findEstablishmentBySlug continues to use index-backed lookup.
--
-- Discovered: Brief 1 post-implementation review (2026-05-20).
-- Rollback: 028_rollback_drop_redundant_slug_index.sql.

BEGIN;

DROP INDEX IF EXISTS idx_establishments_slug;

COMMIT;
