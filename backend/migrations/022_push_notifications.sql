-- Migration 022: Push Notifications Infrastructure
-- Creates device_tokens and notification_preferences tables
-- for FCM push delivery and per-user notification settings.
--
-- Supports: Component 6 — Push Notifications (Segment A)
-- Tables affected: device_tokens, notification_preferences (CREATE)

-- =====================================================
-- 1. Device Tokens (FCM registration tokens per device)
-- =====================================================

CREATE TABLE device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fcm_token VARCHAR(500) NOT NULL,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
    device_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, fcm_token)
);

CREATE INDEX idx_device_tokens_user_id
ON device_tokens(user_id);

-- =====================================================
-- 2. Notification Preferences (one row per user)
-- =====================================================

CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_push_enabled BOOLEAN DEFAULT TRUE,
    reviews_push_enabled BOOLEAN DEFAULT TRUE,
    promotions_push_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX idx_notification_preferences_user_id
ON notification_preferences(user_id);
