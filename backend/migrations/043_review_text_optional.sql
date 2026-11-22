-- Migration 043: a review may be a rating alone — its text becomes optional.
--
-- The server stores a review without text with NULL in both text columns,
-- content and its legacy twin text (the Coordinator's word, 20.11.2026, thread
-- «Отзыв без текста»). The snapshot of production (production_schema.sql)
-- has both nullable and no CHECK on the text, and rows with NULL text exist
-- there already (deleting an account erases them). Migration 007 declared
-- content NOT NULL and check_content_length (length 20..1000): where NOT NULL
-- is still on, a review without text fails with a server error; where the
-- CHECK is, a text shorter than 20 characters is refused (a CHECK lets NULL
-- through). 043 drops both wherever they are, changes nothing where they are
-- not; NOT NULL on text, if any, came from the base schema. Catalogue only:
-- no table rewrite, no data touched. Repeatable.
--
-- Operator step: on production by hand, after the merge and the deploy, by a
-- separate word of the Coordinator —
-- scripts/apply-migration-production.js 043_review_text_optional. Check, read
-- only: information_schema.columns (is_nullable 'YES' for content and text),
-- pg_constraint (no CHECK on reviews reads content or text). This file keeps
-- under 40 lines: the script shows the operator its first 40 before «yes».

BEGIN;

-- ALTER TABLE holds ACCESS EXCLUSIVE until COMMIT: wait for other locks at
-- most 5 s instead of queueing the reads of reviews behind a long
-- transaction; on a timeout nothing is applied — run it again.
SET LOCAL lock_timeout = '5s';

ALTER TABLE reviews ALTER COLUMN content DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN text DROP NOT NULL;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS check_content_length;

COMMIT;
