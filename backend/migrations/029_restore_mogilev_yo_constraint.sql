-- Migration 029: Restore Могилёв (ё-variant) in city CHECK constraint
--
-- Context: production_schema.sql regen post-migration 026 lost the
-- 'Могилёв' (ё) variant from establishments_city_check. Only 'Могилев'
-- (без ё) survived. Mobile/web flows accepting input with ё-variant
-- silently failed at INSERT/UPDATE time. Detected during Brief 1
-- Discovery; restored as part of Post-v30 Documentation Sync.
--
-- This migration restores the ё-variant alongside the existing е-variant.
-- Both spellings are valid; expandCityForQuery in urlSlugs.js handles
-- the read side by querying for both.
--
-- Idempotent: DROP IF EXISTS + ADD pattern. Safe to re-run.

ALTER TABLE establishments
  DROP CONSTRAINT IF EXISTS establishments_city_check;

ALTER TABLE establishments
  ADD CONSTRAINT establishments_city_check
  CHECK (city IN ('Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Могилёв', 'Бобруйск'));
