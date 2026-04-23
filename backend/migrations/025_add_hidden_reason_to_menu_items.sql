-- Migration 025: Add hidden_reason to menu_items for admin moderation actions
--
-- Adds a nullable TEXT column to capture the motivation when a moderator hides
-- a menu item via POST /admin/menu-items/:id/hide. Stored alongside the boolean
-- is_hidden_by_admin flag (added in 024) to decouple hide state from reason text.
--
-- Chosen as a dedicated column rather than a key inside sanity_flag JSONB to keep
-- admin-driven state separate from OCR-driven sanity metadata — those evolve on
-- different lifecycles (sanity_flag may be dismissed or recomputed; hidden_reason
-- persists across the admin action).

BEGIN;

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

COMMIT;
