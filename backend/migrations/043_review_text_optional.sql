-- Migration 043: a review may be a rating alone — its text becomes optional.
--
-- Why (the Coordinator's word, 20.11.2026 20:59:29Z, thread «Отзыв без
-- текста», plan and questions В1–В7): a guest can leave a review with stars
-- and no text. The server stores such a review with NULL in both text columns,
-- content and its legacy twin text (reviewService.storedReviewText).
--
-- What the live database is expected to be already: both columns nullable and
-- no CHECK on the text (production_schema.sql — the table, and the note on
-- migration 007). Rows with NULL text are there today: deleting an account
-- erases the text of the person's hidden and deleted reviews
-- (accountDeletionService). Migration 007, though, declared content NOT NULL
-- and check_content_length (length 20..1000); a database that still carries
-- either would answer a review without text with a server failure. This
-- migration removes both wherever they are and changes nothing where they are
-- not: the catalogue and the snapshot agree again (deferred item «reviews
-- content schema-drift»).
--
-- 007 named its CHECK check_content_length (007_reviews_schema_migration.sql,
-- step 3) and set NOT NULL on content only; NOT NULL on text, if a database
-- has it, came from the base schema, which no file here creates.
--
-- No table rewrite, no data touched: dropping NOT NULL and a CHECK only edits
-- the catalogue. Repeatable: a second run, or a run on a database that never
-- had them, changes nothing and raises no error.
--
-- Operator step: applied on production by hand, after the merge and the
-- deploy, by a separate word of the Coordinator —
-- scripts/apply-migration-production.js 043_review_text_optional. Check, read
-- only: information_schema.columns (is_nullable = 'YES' for content and text)
-- and pg_constraint (no CHECK on reviews that reads content or text).

BEGIN;

-- ALTER TABLE takes the table's ACCESS EXCLUSIVE lock until COMMIT: wait for
-- other locks at most 5 s instead of queueing every read of the reviews behind
-- a long transaction — on a timeout nothing is applied, run it again.
SET LOCAL lock_timeout = '5s';

ALTER TABLE reviews ALTER COLUMN content DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN text DROP NOT NULL;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS check_content_length;

COMMIT;
