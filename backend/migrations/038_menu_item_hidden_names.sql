-- Migration 038: the dishes a moderator hid in an establishment, remembered
-- apart from the menu files.
--
-- Why (decision of the Coordinator 29.10.2026, п. 3а; П1–П7 of
-- HIDE_FOLLOWS_DISH_DISCOVERY_REPORT): a dish the moderator hid must stay
-- hidden in every menu file of the establishment — a new photo or PDF of the
-- same menu, and a file deleted and uploaded again. menu_items rows belong to
-- a file and go with it (menu_items_media_id_fkey ON DELETE CASCADE), so the
-- decision needs a place of its own that outlives the file.
--
-- One row: «in this establishment a dish of this name (in this section) is
-- hidden, for this reason». The name and the section are stored AS READ;
-- what counts as the same dish (case, spaces, quotes, dashes, ё/е) is decided
-- in code by one function (utils/menuItemName.js dishKey) on both sides. So
-- the backfill below is a plain copy and SQL never has to repeat the rule.
--
-- Written by «Скрыть», erased by «Показать снова», read by every write of a
-- recognised file (menuItemModel.replaceForMedia). Goes with the card
-- (ON DELETE CASCADE on establishment_id).
--
-- The code works without this table (the window between the deploy and this
-- migration): it then follows the dish only into files whose hidden rows are
-- still there.
--
-- Repeatable: IF NOT EXISTS, and the backfill copies only what is not there.
--
-- Operator step: applied on production by hand, after the merge, by a
-- separate word of the Coordinator — scripts/apply-migration-production.js
-- 038_menu_item_hidden_names; check — scripts/check-production-migrations.js.

BEGIN;

-- The foreign key takes a lock on establishments until COMMIT: wait for it at
-- most 5 s instead of queueing every card write behind a long transaction —
-- on a timeout nothing is applied, run it again.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS menu_item_hidden_names (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    category_raw VARCHAR(100),
    hidden_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_menu_item_hidden_names_establishment
    ON menu_item_hidden_names(establishment_id);

-- The dishes hidden before this migration: every hidden row, once per
-- (establishment, name, section, reason) as stored.
INSERT INTO menu_item_hidden_names (establishment_id, item_name, category_raw, hidden_reason)
SELECT DISTINCT mi.establishment_id, mi.item_name, mi.category_raw, mi.hidden_reason
FROM menu_items mi
WHERE mi.is_hidden_by_admin = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM menu_item_hidden_names h
    WHERE h.establishment_id = mi.establishment_id
      AND h.item_name = mi.item_name
      AND h.category_raw IS NOT DISTINCT FROM mi.category_raw
      AND h.hidden_reason IS NOT DISTINCT FROM mi.hidden_reason
  );

COMMIT;
