-- Migration 040: what is still to be removed from the cloud after an account
-- is deleted.
--
-- Why (the Coordinator's decision, 05.11.2026, thread «Хвосты записи», fork 5;
-- decision log CAT-D-3.1): when we answer «удалено», the person's pictures must
-- leave the cloud whatever fails and whenever the process restarts. Until now
-- the deletion fired one destroy after COMMIT: a failure left the file for good,
-- because the same transaction had erased the only link to it.
--
-- One row per deleted account: the folder avatars/<user_id>/ is to be emptied.
-- The row is written in the transaction of the deletion
-- (accountDeletionService.anonymiseAccount), so the task cannot be lost apart
-- from the deletion, and the operator's script gets it the same way. The loop
-- services/avatarDeletionLoop.js works through it.
--
-- status: pending — due at next_attempt_at; done — the folder was emptied,
-- files_deleted says how many went; failed — the attempts ran out: the row stays,
-- and the journal has its line.
-- To try a failed row again:
--   UPDATE avatar_deletions SET status = 'pending', attempts = 0,
--     next_attempt_at = NOW() WHERE status = 'failed';
--
-- Accounts deleted while the table was not there have no task, and a later request
-- writes none: it stops at «already deleted». Their folders follow from the journal:
--   INSERT INTO avatar_deletions (user_id)
--   SELECT DISTINCT a.entity_id FROM audit_log a JOIN users u ON u.id = a.entity_id
--    WHERE a.entity_type = 'user' AND a.action = 'user_delete_account'
--   ON CONFLICT (user_id) DO NOTHING;
--
-- Times are TIMESTAMPTZ and only ever compared with the database's own NOW().
--
-- The users row of a deleted account stays as an empty shell, so the reference
-- holds. ON DELETE CASCADE only for the seed clean-up, which removes rows of
-- accounts that never had a picture (scripts/clear-reviews.js).
--
-- The code works without this table (the window between the deploy and this
-- migration): it asks to_regclass before the transaction and then deletes the
-- current picture as it did before; the loop stays silent.
--
-- Repeatable: IF NOT EXISTS.
--
-- Operator step: applied on production by hand, after the merge, by a separate
-- word of the Coordinator — scripts/apply-migration-production.js
-- 040_avatar_deletions; check — scripts/check-production-migrations.js.

BEGIN;

-- The foreign key takes a lock on users until COMMIT: wait for it at most 5 s
-- instead of queueing every sign-in behind a long transaction — on a timeout
-- nothing is applied, run it again.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS avatar_deletions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    files_deleted INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_avatar_deletions_due
    ON avatar_deletions(next_attempt_at)
    WHERE status = 'pending';

COMMIT;
