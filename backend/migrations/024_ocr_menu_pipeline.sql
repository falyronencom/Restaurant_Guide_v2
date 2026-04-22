-- Migration 024: OCR menu pipeline — persistent job queue, parsed menu items,
-- and promotion extensions for Smart Search Этап 2.
--
-- Tables created:
--   - ocr_jobs: persistent background job queue (PostgreSQL-based, no external queue)
--   - menu_items: parsed menu positions from OCR, denormalized establishment_id
--                 for direct JOIN in Smart Search without traversing establishment_media
--
-- Table extensions:
--   - promotions: valid_from_time, valid_until_time, menu_item_id FK, discount_price_byn
--
-- Extensions used:
--   - pg_trgm: for GIN trigram index on menu_items.item_name to power ILIKE-based
--              dish search in Segment B. Idempotent via IF NOT EXISTS.
--
-- Cascade design:
--   establishments (DELETE)
--     → establishment_media (CASCADE, pre-existing)
--     → menu_items (CASCADE, new)
--     → ocr_jobs (CASCADE, new)
--   promotions.menu_item_id → menu_items(id) ON DELETE SET NULL
--     (promotion survives menu item deletion — moderator hide or media replace)

BEGIN;

-- 1. pg_trgm extension for trigram GIN index
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. OCR job queue
CREATE TABLE IF NOT EXISTS ocr_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES establishment_media(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    error_message TEXT,
    result_summary JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    CONSTRAINT chk_ocr_jobs_status
        CHECK (status IN ('pending', 'processing', 'done', 'failed'))
);

-- Polling index: poller scans for pending jobs ordered by creation time.
-- SELECT ... WHERE status = 'pending' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status_created
    ON ocr_jobs(status, created_at);

-- 3. Parsed menu items
CREATE TABLE IF NOT EXISTS menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES establishment_media(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    price_byn DECIMAL(10,2),
    category_raw VARCHAR(100),
    confidence DECIMAL(3,2),
    sanity_flag JSONB,
    is_hidden_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_menu_items_confidence
        CHECK (confidence IS NULL OR (confidence >= 0.00 AND confidence <= 1.00))
);

-- Filtered scan for dish-queries with moderator-hidden exclusion
CREATE INDEX IF NOT EXISTS idx_menu_items_establishment_hidden
    ON menu_items(establishment_id, is_hidden_by_admin);

-- CASCADE performance + "all items from this PDF" queries
CREATE INDEX IF NOT EXISTS idx_menu_items_media
    ON menu_items(media_id);

-- ILIKE search on dish names (Segment B dish-queries)
CREATE INDEX IF NOT EXISTS idx_menu_items_name_trgm
    ON menu_items USING gin (item_name gin_trgm_ops);

-- 4. Promotion extensions for Etap 2 (time windows, menu item linkage, discount price)
ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS valid_from_time TIME,
    ADD COLUMN IF NOT EXISTS valid_until_time TIME,
    ADD COLUMN IF NOT EXISTS menu_item_id UUID
        REFERENCES menu_items(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS discount_price_byn DECIMAL(10,2);

COMMIT;
