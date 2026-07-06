-- Rollback 030: drop the canon CHECK constraints on categories + cuisines.
--
-- Only the constraints are dropped. The Phase-1 data normalization (English →
-- Cyrillic, 'Кальян' → 'Кальянная', dedupe) is NOT reverted: those values are
-- canonically correct regardless of whether the constraint is present, and
-- reverting them would re-break the discoverability surfaces. Idempotent.

BEGIN;

ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_categories_canon_check;
ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_cuisines_canon_check;

COMMIT;
