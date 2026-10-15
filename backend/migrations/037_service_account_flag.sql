-- Migration 037: users.is_service_account — the accounts that hold the platform
--
-- Which account owns the platform's cards (the seed house) was known only by
-- its e-mail address, written out as a literal in seven operator scripts —
-- an address at a domain the project does not own (2026-10-15, cloud critic
-- 2B S1). Moving that account to an address of ours would have left every
-- seed script unable to find it, and the scripts that create the seed house
-- when they do not find it would have opened a second one on the old address.
-- From this migration the account is recognised by this flag, set by the
-- operator (scripts/mark-service-account.js), never by its address.
--
-- What the flag changes in the server (directive service_accounts 2026-10-15,
-- B2): a service account's access is restored only by the operator's scripts —
-- «forgot password» issues nothing for it and an old link does not work, and
-- Google/Yandex sign-in neither opens a session for it nor links a provider to
-- it. Panel accounts (admin, viewer) are held to the same rules by their role.
-- The account Apple's reviewers use is NOT a service account: it is an ordinary
-- user, on our mailbox, and must behave as any user for the review to mean
-- anything.
--
-- Deploy order is NOT load-bearing: the code reads the column through
-- to_jsonb(users) — false while it does not exist. Until this migration is
-- applied and the seed house marked, the seed scripts stop (they no longer
-- create a seed house) and B2 holds for the panel roles only. Apply on Railway
-- MANUALLY after merge (backend/scripts/apply-migration-production.js);
-- regenerate production_schema.sql only after that — the snapshot mirrors
-- production, not the catalogue.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). A NOT NULL column with a constant
-- default is a catalogue change on PostgreSQL 11+ — no table rewrite.
-- Rollback: 037_rollback_service_account_flag.sql.

BEGIN;

SET search_path TO public;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_service_account BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_service_account IS
    'Account that holds the platform (the seed house). Set by the operator (scripts/mark-service-account.js); access restored only by operator scripts.';

COMMIT;
