-- Migration 027a: Add nullable slug column to establishments
--
-- Phase A of 027 (slug infrastructure for Phase A web platform routing).
-- Adds the slug column as nullable to allow backfill before constraints.
--
-- Two-step workflow:
--   1. Apply THIS file → adds nullable slug column
--   2. Run scripts/backfill-slugs.js → populates slugs using slugGenerator
--   3. Apply 027b_add_slug_constraints.sql → NOT NULL + UNIQUE
--
-- Why split: backfill requires JavaScript slugGenerator (single source of
-- truth, consistent with future inserts via service layer). PostgreSQL
-- PL/pgSQL re-implementation of transliteration would diverge from
-- slugGenerator.js over time.
--
-- Rollback: 027_rollback_add_slug.sql (handles both 027a and 027b state).

BEGIN;

ALTER TABLE establishments ADD COLUMN slug VARCHAR(150);

COMMIT;
