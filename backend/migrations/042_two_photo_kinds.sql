-- Migration 042: a card's facade and dish photos become photos of the venue.
--
-- Why (the Coordinator's word, 09.11.2026 21:22:55Z, thread «Фото людей»;
-- decision log, amendments of CAT-E-2.1 and CAT-E-2.3): a card has two kinds of
-- photos — «Фото заведения» (the room, the facade and the dishes) and «Меню».
-- The partner's app and site have only ever sent `interior` and `menu`; the
-- team's import wrote `exterior` and `dishes`, which the moderator's card and
-- the partner's cabinet never showed, and a save from the cabinet replaced a
-- facade cover with the first room photo. The code reads those values as
-- photos of the venue already (backend/src/constants/mediaKinds.js); this
-- migration only makes the stored rows say so.
--
-- What the guests see does not change: the gallery's order is position, then
-- created_at — the type takes no part in it — and the cover is
-- establishments.primary_image_url and the is_primary flag, untouched here.
-- Nothing is deleted: a card that now holds more than 30 photos of the venue
-- keeps them, and its next upload is refused with a text until there are fewer.
--
-- establishment_media_kinds_042 keeps each moved row's former type, so the
-- rollback can put it back; a photo deleted later takes its line with it.
--
-- The CHECK on establishment_media.type keeps the four values: code deployed
-- before this migration may still read them, and the import of an older
-- version of the scripts writes them.
--
-- Repeatable: a second run finds nothing to move.
--
-- Operator step: applied on production by hand, after the merge, by a separate
-- word of the Coordinator — scripts/apply-migration-production.js
-- 042_two_photo_kinds; check — scripts/check-production-migrations.js.

BEGIN;

-- The new table's foreign key locks establishment_media against writes until
-- COMMIT (SHARE ROW EXCLUSIVE), and the UPDATE its moved rows: the transaction
-- is short, and it waits for other locks at most 5 s instead of queueing a
-- partner's save behind a long one — on a timeout nothing is applied, run it
-- again. Operator: SELECT type, count(*) FROM establishment_media GROUP BY 1
-- before and after; establishment_media_kinds_042 has the moved count.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS establishment_media_kinds_042 (
    media_id UUID PRIMARY KEY REFERENCES establishment_media(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO establishment_media_kinds_042 (media_id, type)
SELECT id, type FROM establishment_media WHERE type IN ('exterior', 'dishes')
ON CONFLICT (media_id) DO NOTHING;

UPDATE establishment_media SET type = 'interior' WHERE type IN ('exterior', 'dishes');

COMMIT;
