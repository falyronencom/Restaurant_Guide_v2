-- Migration 039: how many times a card was sent on through the app's
-- «Поделиться», per establishment per day.
--
-- Why (decision of the Coordinator 06.11.2026): the partner sees «Звонки» but
-- not how often the card is passed on. The «Поделились» tile on the partner's
-- card stood at 0 for lack of a counter and was removed by PR #174; this column
-- is what lets it come back with a real number.
--
-- Written by POST /api/v1/establishments/:id/track-share
-- (partnerAnalyticsModel.trackShare). A plain ADD COLUMN with a constant
-- default: no table rewrite, existing rows read as 0.
--
-- The code works without this column (the window between the deploy and this
-- migration, models/shareCountSql.js): the partner's figures read 0 and a write
-- is logged and lost. Nothing else on those screens changes.
--
-- Repeatable: IF NOT EXISTS.
--
-- Operator step: applied on production by hand, after the merge, by a
-- separate word of the Coordinator — scripts/apply-migration-production.js
-- 039_establishment_share_count; check — scripts/check-production-migrations.js.

BEGIN;

-- Wait for the lock at most 5 s; on a timeout nothing changes.
SET LOCAL lock_timeout = '5s';

ALTER TABLE establishment_analytics
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;

COMMIT;
