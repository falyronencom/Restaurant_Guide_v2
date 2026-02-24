-- Migration 011: Sync test DB with production schema
-- Adds 4 columns missing from test database that exist in production
-- Root cause of 81 test failures across 5 suites

ALTER TABLE establishments ADD COLUMN IF NOT EXISTS location geography(Point, 4326);
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS average_check_byn NUMERIC(10,2);
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS is_24_hours BOOLEAN DEFAULT false;
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS primary_image_url TEXT;
