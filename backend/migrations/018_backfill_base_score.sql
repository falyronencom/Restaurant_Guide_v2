-- Migration 018: Backfill base_score (completeness score) for all establishments
--
-- Calculates base_score from optional fields:
--   description (25), price_range (25), attributes (20),
--   phone (15), email (10), website (5)
-- Maximum: 100
--
-- Safe to run multiple times (idempotent).

UPDATE establishments
SET base_score = (
  CASE WHEN description IS NOT NULL AND LENGTH(description) > 0 THEN 25 ELSE 0 END
  + CASE WHEN price_range IS NOT NULL THEN 25 ELSE 0 END
  + CASE WHEN attributes IS NOT NULL AND attributes::text != '{}' AND attributes::text != 'null' THEN 20 ELSE 0 END
  + CASE WHEN phone IS NOT NULL AND LENGTH(phone) > 0 THEN 15 ELSE 0 END
  + CASE WHEN email IS NOT NULL AND LENGTH(email) > 0 THEN 10 ELSE 0 END
  + CASE WHEN website IS NOT NULL AND LENGTH(website) > 0 THEN 5 ELSE 0 END
)
WHERE base_score = 0 OR base_score IS NULL;
