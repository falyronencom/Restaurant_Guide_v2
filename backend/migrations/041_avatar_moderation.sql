-- Migration 041: a person's photo reaches other people only after a moderator
-- approves it; a photo taken down, cleared or replaced leaves the cloud.
--
-- Why (the Coordinator's word, 09.11.2026, thread «Фото людей»,
-- docs/handoffs/ugc_moderation_step1_20261110/DIRECTIVE.md): anyone signed in
-- could put any picture next to every review they wrote, in the app and on the
-- site, with no moderator ever seeing it; the stores' rules (Apple 1.2, Google
-- Play «User Generated Content») ask for a filter before publication, and the
-- cloud's terms make us answer for what our users upload.
--
-- 1. users.avatar_approved_url — the link a moderator approved. Other people
--    see the photo only while users.avatar_url equals it
--    (models/avatarModerationModel.js, publicAvatarSql). The approval belongs to
--    one link, not to the account: every write of a new photo — an upload,
--    PUT /auth/profile, a Google or Yandex sign-in — leaves the two columns
--    unequal by itself, so no writer can forget to send the photo back for
--    review. Empty for every account at the start: the photos already uploaded
--    go through the same queue once, and until a moderator looks at them other
--    people see the initial.
--
-- 2. avatar_file_deletions — one file of a person's avatar folder to remove from
--    the cloud: the photo a moderator took down, the one the person cleared or
--    replaced, the registrant's photo of an account taken over. One row per
--    file, written in the transaction that drops the link, so the task cannot be
--    lost apart from it; services/avatarDeletionLoop.js works through it with the
--    pauses of the folder queue (040) and drops the CDN's copies with the file.
--    The folder queue (040) stays for deleted accounts: one row a person, the
--    whole folder.
--
--    reason: moderator_removed | cleared | replaced | taken_over.
--    status: pending — due at next_attempt_at; done — gone from the cloud;
--    failed — the attempts ran out: the row stays, and the journal has its line.
--    To try failed rows again:
--      UPDATE avatar_file_deletions SET status = 'pending', attempts = 0,
--        next_attempt_at = NOW() WHERE status = 'failed';
--
-- The code works without this migration (the window between the deploy and
-- here): the column is read through to_jsonb(users), where a missing column is
-- NULL — nobody's photo is shown to other people, nothing fails; the panel's
-- approve and take-down refuse with a text; a person's own clear or replace
-- asks to_regclass before its transaction and removes the old file the old way,
-- once, without a retry.
--
-- Times are TIMESTAMPTZ and only ever compared with the database's own NOW().
--
-- Repeatable: IF NOT EXISTS.
--
-- Operator step: applied on production by hand, after the merge, by a separate
-- word of the Coordinator — scripts/apply-migration-production.js
-- 041_avatar_moderation; check — scripts/check-production-migrations.js.

BEGIN;

-- ADD COLUMN and the foreign key take a lock on users until COMMIT: wait for it
-- at most 5 s instead of queueing every sign-in behind a long transaction — on
-- a timeout nothing is applied, run it again. A nullable column without a
-- default rewrites nothing.
SET LOCAL lock_timeout = '5s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_approved_url VARCHAR(500);

COMMENT ON COLUMN users.avatar_approved_url IS
    'The avatar link a moderator approved; other people see avatar_url only while it equals this (migration 041).';

CREATE TABLE IF NOT EXISTS avatar_file_deletions (
    public_id VARCHAR(500) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(20) NOT NULL
        CHECK (reason IN ('moderator_removed', 'cleared', 'replaced', 'taken_over')),
    status VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_avatar_file_deletions_due
    ON avatar_file_deletions(next_attempt_at)
    WHERE status = 'pending';

COMMIT;
