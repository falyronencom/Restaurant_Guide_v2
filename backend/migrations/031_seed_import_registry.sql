-- Migration 031: seed_import_registry — idempotency/resume sidecar for the
-- bulk-import vehicle (CAT-C-3.5 amendment, CAT-E-2.1/2.2).
--
-- Why a sidecar table (not a column on establishments): keeps the external
-- import key + phase-machine state out of the production entity schema; the row
-- dies with its establishment via ON DELETE CASCADE, so a rollback/wipe leaves
-- no registry orphans.
--
-- KEY = stable_id (CAT-E-2.1: the on-site folder name, byte-for-byte the media
-- directory). Re-running the import keys on this: a row already 'activated' with
-- a matching content_hash is skipped; a phase < 'activated' is resumed.
--
-- Phase machine (adversarial fix — 'creating' precedes createEstablishment so a
-- crash between the service create and the registry write cannot orphan a
-- draft): creating → created → media_done → ocr_enqueued → activated.
--   - establishment_id is NULL during 'creating', set on transition to 'created'.
--   - media_state maps each media relpath → { public_id, media_row_id, urls… },
--     the authoritative record for resume (skip a file only when its media row
--     truly exists) and for rollback (Cloudinary public_ids, snapshotted BEFORE
--     the establishments DELETE that would CASCADE this row away).
--
-- Rollback: 031_rollback_seed_import_registry.sql (drops the table). Idempotent.

BEGIN;

-- Resolve unqualified table names regardless of inherited session search_path.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS seed_import_registry (
    stable_id VARCHAR(64) PRIMARY KEY,
    establishment_id UUID UNIQUE REFERENCES establishments(id) ON DELETE CASCADE,
    batch_id VARCHAR(64) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    phase VARCHAR(20) NOT NULL DEFAULT 'creating',
    media_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    coords_source VARCHAR(20),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_seed_registry_phase
        CHECK (phase IN ('creating', 'created', 'media_done', 'ocr_enqueued', 'activated')),
    CONSTRAINT chk_seed_registry_coords_source
        CHECK (coords_source IS NULL OR coords_source IN ('sheet', 'geocoded', 'city_fallback'))
);

-- Rollback + reporting scan by batch.
CREATE INDEX IF NOT EXISTS idx_seed_registry_batch
    ON seed_import_registry(batch_id);

-- Resume scan: find incomplete rows (phase <> 'activated') for a batch.
CREATE INDEX IF NOT EXISTS idx_seed_registry_phase
    ON seed_import_registry(phase);

COMMIT;
