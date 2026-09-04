-- Migration 033: menu_push_enabled — fourth push-preference toggle
--
-- Enables push delivery for the `menu_parsed` notification (OCR finished
-- parsing a partner's uploaded menu). Coordinator decision 2026-09-04
-- (artifact audit, slice C, item Р-3 (б)): the missing push was a gap, not
-- an intention. Until now pushService.TYPE_CATEGORY_MAP had no `menu`
-- category, so the event reached partners in-app only — a partner who does
-- not open the mobile «Меню» section never learned the menu was parsed.
--
-- Column semantics mirror the three siblings from 022
-- (booking_/reviews_/promotions_push_enabled): BOOLEAN DEFAULT TRUE, the
-- per-user row is created lazily by UPSERT, a missing row means "all on".
-- `menu_item_hidden_by_admin` stays OUTSIDE the push map on purpose — silent
-- moderation action, same class as review_hidden / review_deleted.
--
-- Deploy order is NOT load-bearing: notificationPreferencesModel reads with
-- SELECT * and references this column only when a client actually sends
-- menu_push_enabled, so a backend deployed before this migration keeps
-- serving pre-033 clients. Apply on Railway MANUALLY after merge (operator
-- action, runbook script backend/scripts/apply-migration-production.js);
-- regenerate production_schema.sql only after that — the snapshot mirrors
-- production, not the catalogue.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- Rollback: 033_rollback_menu_push_preference.sql.

BEGIN;

-- Resolve unqualified table names regardless of inherited session search_path.
SET search_path TO public;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS menu_push_enabled BOOLEAN DEFAULT TRUE;

COMMIT;
