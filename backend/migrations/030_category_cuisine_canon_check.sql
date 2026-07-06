-- Migration 030: Canon CHECK on establishments.categories + .cuisines (CAT-C-2.9)
--
-- Makes category/cuisine values canonical-Cyrillic at-rest a HARD DB invariant,
-- so the four coupled discoverability surfaces (sitemap, catalog browse,
-- canonical URL, cuisine filter) hold for real content — the import-prep step
-- for the real-500 seed run.
--
-- SELF-CONTAINED + IDEMPOTENT (re-runnable). Two phases in one transaction:
--   1. Normalize legacy/stray values → canon (array_replace replay + dedupe).
--   2. DROP IF EXISTS + ADD the two canon CHECK constraints.
--
-- TRIGGER DISCIPLINE: apply AFTER the placeholder-seed wipe. Placeholder rows
-- carry English tokens (restaurant/cafe/european/…) and two unmappable strays
-- (indian, mediterranean) that have no canon target — they must be gone before
-- the constraint lands, or step 2 fails 23514. The census (2026-07-06) confirmed
-- those unmappable values live ONLY on seed-partner rows (wiped); the sole
-- off-canon value on real rows is 'Кальян' (Cyrillic, one row), repaired in
-- step 1 below. run-normalize.js does NOT cover 'Кальян' (it is Cyrillic, not
-- English) — that is exactly why this repair lives here, not only in that script.
--
-- LOCK: SHARE ROW EXCLUSIVE blocks concurrent writes (the live mobile wizard)
-- for the transaction, closing the window where a row could be written between
-- the normalize replay and the ADD CONSTRAINT.
--
-- Rollback: 030_rollback_category_cuisine_canon_check.sql (drops both CHECKs;
-- the data normalization is not reverted — canon values are correct regardless).

BEGIN;

-- Resolve unqualified table names regardless of inherited session search_path
-- (a chained pg_dump apply can leave search_path empty).
SET search_path TO public;

LOCK TABLE establishments IN SHARE ROW EXCLUSIVE MODE;

-- ── Phase 1a: normalize legacy English → Cyrillic canon ─────────────────────
-- Mirrors backend/scripts/run-normalize.js (the converter already proven on
-- prod). Each statement is guarded by = ANY(...) so re-runs are no-ops.
-- Cuisines:
UPDATE establishments SET cuisines = array_replace(cuisines, 'belarusian',    'Народная')      WHERE 'belarusian'    = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'national',       'Народная')      WHERE 'national'      = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'european',       'Европейская')   WHERE 'european'      = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'continental',    'Европейская')   WHERE 'continental'   = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'italian',        'Итальянская')   WHERE 'italian'       = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'asian',          'Азиатская')     WHERE 'asian'         = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'american',       'Американская')  WHERE 'american'      = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'georgian',       'Грузинская')    WHERE 'georgian'      = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'japanese',       'Японская')      WHERE 'japanese'      = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'vegetarian',     'Вегетарианская') WHERE 'vegetarian'   = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'mixed',          'Смешанная')     WHERE 'mixed'         = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'international',   'Смешанная')     WHERE 'international'  = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'fusion',         'Авторская')     WHERE 'fusion'        = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'author',         'Авторская')     WHERE 'author'        = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'chinese',        'Китайская')     WHERE 'chinese'       = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'eastern',        'Восточная')     WHERE 'eastern'       = ANY(cuisines);
-- Categories:
UPDATE establishments SET categories = array_replace(categories, 'restaurant',    'Ресторан')     WHERE 'restaurant'    = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'cafe',          'Кофейня')      WHERE 'cafe'          = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'cafe_dining',   'Кафе')         WHERE 'cafe_dining'   = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'bar',           'Бар')          WHERE 'bar'           = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'fast_food',     'Фаст-фуд')     WHERE 'fast_food'     = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'pizzeria',      'Пиццерия')     WHERE 'pizzeria'      = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'bakery',        'Пекарня')      WHERE 'bakery'        = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'pub',           'Паб')          WHERE 'pub'           = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'canteen',       'Столовая')     WHERE 'canteen'       = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'hookah_lounge', 'Кальянная')    WHERE 'hookah_lounge' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'hookah_bar',    'Кальянная')    WHERE 'hookah_bar'    = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'bowling',       'Боулинг')      WHERE 'bowling'       = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'karaoke',       'Караоке')      WHERE 'karaoke'       = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'billiards',     'Бильярд')      WHERE 'billiards'     = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'nightclub',     'Клуб')         WHERE 'nightclub'     = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'confectionery', 'Кондитерская') WHERE 'confectionery' = ANY(categories);

-- ── Phase 1b: repair Cyrillic strays that run-normalize.js does NOT cover ────
-- 'Кальян' (bare, non-canon) → 'Кальянная' (canon). One real row at census time.
UPDATE establishments SET categories = array_replace(categories, 'Кальян', 'Кальянная') WHERE 'Кальян' = ANY(categories);

-- ── Phase 1c: dedupe ────────────────────────────────────────────────────────
-- array_replace can produce a duplicate when a row held BOTH the legacy and the
-- canon form of one value (e.g. ['Кальянная','Кальян'] → ['Кальянная','Кальянная']).
-- Collapse to first-occurrence-ordered distinct. Fires only on genuinely
-- duplicated rows (0 at census time); order preserved so the primary (first)
-- category is unchanged.
UPDATE establishments e SET categories = d.arr
FROM (
  SELECT s.id, array_agg(s.val ORDER BY s.ord) AS arr
  FROM (
    SELECT id, val, min(ord) AS ord
    FROM establishments, unnest(categories) WITH ORDINALITY AS u(val, ord)
    GROUP BY id, val
  ) s GROUP BY s.id
) d
WHERE e.id = d.id
  AND cardinality(e.categories) <> cardinality(d.arr);

UPDATE establishments e SET cuisines = d.arr
FROM (
  SELECT s.id, array_agg(s.val ORDER BY s.ord) AS arr
  FROM (
    SELECT id, val, min(ord) AS ord
    FROM establishments, unnest(cuisines) WITH ORDINALITY AS u(val, ord)
    GROUP BY id, val
  ) s GROUP BY s.id
) d
WHERE e.id = d.id
  AND cardinality(e.cuisines) <> cardinality(d.arr);

-- ── Phase 2: canon CHECK constraints (idempotent DROP IF EXISTS + ADD) ───────
-- categories is NULLABLE → tolerate NULL; reject empty array '{}' (cardinality
-- is otherwise a service-layer concern, but an empty array is never valid — use
-- NULL for "no categories"). Subset (<@) enforces every element is canon; a
-- non-contained NULL *element* makes <@ evaluate to FALSE (not NULL) on PG16 —
-- empirically confirmed + pinned by canon-check.integration.test.js — so a NULL
-- element is rejected, not silently admitted.
ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_categories_canon_check;
ALTER TABLE establishments ADD CONSTRAINT establishments_categories_canon_check CHECK (
  categories IS NULL OR (
    categories <> '{}'::varchar[]
    AND categories <@ ARRAY[
      'Ресторан','Кофейня','Кафе','Фаст-фуд','Бар','Кондитерская','Пиццерия',
      'Пекарня','Паб','Столовая','Кальянная','Боулинг','Караоке','Бильярд','Клуб'
    ]::varchar[]
  )
);

-- cuisines is NOT NULL → no NULL branch; reject empty array; subset-canon.
ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_cuisines_canon_check;
ALTER TABLE establishments ADD CONSTRAINT establishments_cuisines_canon_check CHECK (
  cuisines <> '{}'::varchar[]
  AND cuisines <@ ARRAY[
    'Народная','Авторская','Азиатская','Американская','Вегетарианская','Японская',
    'Грузинская','Итальянская','Смешанная','Европейская','Китайская','Восточная'
  ]::varchar[]
);

COMMIT;
