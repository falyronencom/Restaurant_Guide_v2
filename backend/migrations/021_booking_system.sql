-- Migration 021: Booking System
-- Creates booking_settings and bookings tables, adds booking_enabled
-- to establishments, adds booking analytics columns.
--
-- Supports: Component 5 — Reservations
-- Tables affected: establishments, establishment_analytics (ALTER),
--                  booking_settings, bookings (CREATE)

-- =====================================================
-- 1. Booking Settings (one row per establishment)
-- =====================================================

CREATE TABLE booking_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT FALSE,
    max_guests_per_booking INTEGER NOT NULL DEFAULT 10,
    confirmation_timeout_hours INTEGER NOT NULL DEFAULT 4
        CHECK (confirmation_timeout_hours IN (2, 4, 6)),
    max_days_ahead INTEGER NOT NULL DEFAULT 7
        CHECK (max_days_ahead IN (0, 1, 3, 7, 14, 30)),
    min_hours_before INTEGER NOT NULL DEFAULT 2
        CHECK (min_hours_before IN (1, 2, 3, 6, 12, 24)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(establishment_id)
);

CREATE INDEX idx_booking_settings_establishment
ON booking_settings(establishment_id);

-- =====================================================
-- 2. Bookings (reservation records)
-- =====================================================

CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_date DATE NOT NULL,
    booking_time TIME NOT NULL,
    guest_count INTEGER NOT NULL CHECK (guest_count >= 1),
    comment TEXT,
    contact_phone VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'expired', 'no_show', 'completed')),
    decline_reason TEXT,
    expires_at TIMESTAMP NOT NULL,
    confirmed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Partner queries: list bookings for establishment filtered by status
CREATE INDEX idx_bookings_establishment_status
ON bookings(establishment_id, status);

-- User queries: list bookings for user filtered by status
CREATE INDEX idx_bookings_user_status
ON bookings(user_id, status);

-- Lazy expiry: find pending bookings past their deadline
CREATE INDEX idx_bookings_expires
ON bookings(expires_at) WHERE status = 'pending';

-- =====================================================
-- 3. Denormalized flag on establishments
-- =====================================================

ALTER TABLE establishments
ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT FALSE;

-- =====================================================
-- 4. Analytics extension
-- =====================================================

ALTER TABLE establishment_analytics
ADD COLUMN IF NOT EXISTS booking_request_count INTEGER DEFAULT 0;

ALTER TABLE establishment_analytics
ADD COLUMN IF NOT EXISTS booking_confirmed_count INTEGER DEFAULT 0;
