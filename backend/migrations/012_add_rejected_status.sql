-- Migration 012: Add 'rejected' to establishments status CHECK constraint
-- Previously rejected establishments were stored as 'draft', losing semantic meaning.
-- Now rejected establishments have their own distinct status, enabling the
-- moderation feedback loop (partner sees rejection reason, can resubmit).
--
-- Safe: DROP + ADD constraint is atomic within a transaction.
-- Backward compatible: existing 'draft' rows remain valid.

ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_status_check;
ALTER TABLE establishments ADD CONSTRAINT establishments_status_check
  CHECK (status IN ('draft', 'pending', 'active', 'rejected', 'suspended', 'archived'));
