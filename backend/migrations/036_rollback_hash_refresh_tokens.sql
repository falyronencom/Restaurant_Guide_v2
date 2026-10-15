-- Rollback for Migration 036: there is none, and this file refuses to run.
--
-- 036 replaced the tokens still stored in refresh_tokens with their hashes.
-- A hash does not give the token back, so the rows cannot be restored.
--
-- Nothing needs restoring while the current code runs: it finds every
-- session by hash. Rolling the CODE back to a version from before hashing is
-- what would cost sessions — that code finds a row only by the token itself,
-- so every session whose row holds a hash (all of them after 036; without
-- 036, every one opened or refreshed since the deploy) ends at its next
-- refresh and its user signs in again. That is the price of such a rollback,
-- with or without 036; there is no SQL that avoids it.

DO $$
BEGIN
  RAISE EXCEPTION 'Миграцию 036 откатить нельзя: отпечаток не возвращает токен. Откат кода к версии до хранения отпечатком завершит сеансы — пользователи войдут заново.';
END $$;
