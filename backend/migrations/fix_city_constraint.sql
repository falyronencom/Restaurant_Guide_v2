-- HISTORICAL INCIDENT: Mogilev ё-variant regression
--
-- Discovered: Brief 1 (Май 2026) — production_schema.sql regen after
-- migration 026 silently lost 'Могилёв' (ё) variant from the city CHECK
-- constraint; only 'Могилев' (без ё) survived. Mobile/web inputs with
-- the ё-variant failed at INSERT/UPDATE time.
--
-- Resolved: Post-v30 Documentation Sync (Май 2026) via dedicated
-- migration 029_restore_mogilev_yo_constraint.sql + canonical
-- production_schema.sql update.
--
-- This file is retained as incident documentation only. DO NOT EXECUTE
-- on a live database with real data — the DELETE statements below were
-- a partial-seed recovery specific to that incident and will wipe all
-- establishments. Use migration 029 instead.

-- Fix city CHECK constraint: add Могилёв (with ё) alongside Могилев
ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_city_check;
ALTER TABLE establishments ADD CONSTRAINT establishments_city_check
  CHECK (city IN ('Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Могилёв', 'Бобруйск'));

-- Clean partial seed data from failed run (NOT idempotent — destructive)
DELETE FROM establishment_media;
DELETE FROM establishments;
DELETE FROM users WHERE email = 'seed.data.generator@restaurantguide.by';
