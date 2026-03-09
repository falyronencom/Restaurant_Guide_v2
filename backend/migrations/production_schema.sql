-- =====================================================
-- RESTAURANT GUIDE BELARUS — PRODUCTION SCHEMA
-- Generated for Railway deployment, Feb 2026
-- Combines base schema + all 12 migrations into final state
-- =====================================================

-- Enable PostGIS extension (required for ST_MakePoint in search)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- CORE USER MANAGEMENT
-- =====================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255),
    name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'partner', 'admin')),
    auth_method VARCHAR(20) NOT NULL CHECK (auth_method IN ('email', 'phone', 'google', 'yandex')),
    oauth_provider_id VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);
CREATE UNIQUE INDEX idx_users_oauth_provider ON users(auth_method, oauth_provider_id) WHERE oauth_provider_id IS NOT NULL;

-- =====================================================
-- ESTABLISHMENTS (RESTAURANTS/CAFES/BARS)
-- Status values: draft, pending, active, rejected, suspended, archived
-- =====================================================

CREATE TABLE establishments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Basic Information
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Location
    city VARCHAR(50) NOT NULL CHECK (city IN ('Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Бобруйск')),
    address VARCHAR(500) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    location GEOGRAPHY(Point, 4326),

    -- Contact
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(255),

    -- Categories and Classification
    categories VARCHAR(50)[],          -- Array of categories (max 2)
    cuisines VARCHAR(50)[] NOT NULL,    -- Array of cuisine types (max 3)
    price_range VARCHAR(4) CHECK (price_range IN ('$', '$$', '$$$', '$$$$')),

    -- Operating Information
    working_hours JSONB NOT NULL,      -- Structured schedule
    special_hours JSONB,               -- Breakfast, lunch specials

    -- Attributes (stored as JSONB for flexibility — features filter reads from here)
    attributes JSONB DEFAULT '{}',

    -- Moderation and Status (includes 'rejected' from migration 012)
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'active', 'rejected', 'suspended', 'archived')),
    moderation_notes TEXT,             -- Stores JSON.stringify'd object, parsed on read
    moderated_by UUID REFERENCES users(id),
    moderated_at TIMESTAMP,

    -- Subscription and Monetization
    subscription_tier VARCHAR(20) DEFAULT 'free' CHECK (subscription_tier IN ('free', 'basic', 'standard', 'premium')),
    subscription_started_at TIMESTAMP,
    subscription_expires_at TIMESTAMP,

    -- Ranking and Performance
    base_score INTEGER DEFAULT 0,
    boost_score INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    favorite_count INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    average_rating DECIMAL(3, 2) DEFAULT 0.0,

    -- Denormalized fields (from migrations 005/011)
    primary_image_url TEXT,
    average_check_byn NUMERIC(10, 2),
    is_24_hours BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP
);

CREATE INDEX idx_establishments_partner ON establishments(partner_id);
CREATE INDEX idx_establishments_city ON establishments(city);
CREATE INDEX idx_establishments_status ON establishments(status);
CREATE INDEX idx_establishments_categories ON establishments USING GIN (categories);
CREATE INDEX idx_establishments_cuisines ON establishments USING GIN (cuisines);
CREATE INDEX idx_establishments_ranking ON establishments((base_score + boost_score) DESC, average_rating DESC);
CREATE INDEX idx_establishments_price_range ON establishments(price_range);
CREATE INDEX idx_establishments_subscription_tier ON establishments(subscription_tier);
CREATE INDEX idx_establishments_rating ON establishments(average_rating DESC);

-- =====================================================
-- MEDIA MANAGEMENT
-- =====================================================

CREATE TABLE establishment_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('interior', 'exterior', 'menu', 'dishes')),
    url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    preview_url VARCHAR(500),
    caption VARCHAR(255),
    position INTEGER NOT NULL DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_media_establishment ON establishment_media(establishment_id);
CREATE INDEX idx_media_type ON establishment_media(type);
CREATE INDEX idx_media_primary ON establishment_media(establishment_id, is_primary);

-- =====================================================
-- REVIEWS AND RATINGS
-- Includes: content (mig 007), is_deleted (mig 007),
--           partner_response fields (mig 009)
-- =====================================================

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    text TEXT,                                    -- Legacy column
    content TEXT,                                 -- New standard column (mig 007)
    is_visible BOOLEAN DEFAULT TRUE,
    is_edited BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,             -- Soft deletion (mig 007)
    partner_response TEXT,                        -- Partner reply (mig 009)
    partner_response_at TIMESTAMPTZ,              -- Response timestamp (mig 009)
    partner_responder_id UUID REFERENCES users(id), -- Who responded (mig 009)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reviews_establishment ON reviews(establishment_id);
CREATE INDEX idx_reviews_user ON reviews(user_id);
CREATE INDEX idx_reviews_created_at ON reviews(created_at);
CREATE INDEX idx_reviews_rating ON reviews(rating);
CREATE INDEX idx_reviews_establishment_created ON reviews(establishment_id, created_at DESC);
-- Partial unique index: one review per user per establishment (excluding deleted)
CREATE UNIQUE INDEX idx_reviews_user_establishment_active
    ON reviews(user_id, establishment_id) WHERE is_deleted = FALSE;

-- =====================================================
-- FAVORITES
-- =====================================================

CREATE TABLE favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, establishment_id)
);

CREATE INDEX idx_favorites_user ON favorites(user_id);
CREATE INDEX idx_favorites_establishment ON favorites(establishment_id);

-- =====================================================
-- PROMOTIONS AND SPECIAL OFFERS
-- =====================================================

CREATE TABLE promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    terms_and_conditions TEXT,
    valid_from DATE NOT NULL,
    valid_until DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_promotions_establishment ON promotions(establishment_id);
CREATE INDEX idx_promotions_active ON promotions(establishment_id, is_active);
CREATE INDEX idx_promotions_dates ON promotions(valid_from, valid_until);

-- =====================================================
-- SUBSCRIPTION MANAGEMENT
-- =====================================================

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('basic', 'standard', 'premium')),
    duration_type VARCHAR(20) NOT NULL CHECK (duration_type IN ('day', 'three_days', 'week', 'month')),
    started_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    auto_renew BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subscriptions_establishment ON subscriptions(establishment_id);
CREATE INDEX idx_subscriptions_active ON subscriptions(establishment_id, is_active);
CREATE INDEX idx_subscriptions_expiry ON subscriptions(expires_at);

-- =====================================================
-- ANALYTICS AND METRICS (ghost table — not used by backend code)
-- =====================================================

CREATE TABLE establishment_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    view_count INTEGER DEFAULT 0,
    detail_view_count INTEGER DEFAULT 0,
    favorite_count INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    promotion_view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(establishment_id, date)
);

CREATE INDEX idx_analytics_establishment ON establishment_analytics(establishment_id);
CREATE INDEX idx_analytics_date ON establishment_analytics(date);

-- =====================================================
-- AUDIT LOG (admin moderation tracking)
-- =====================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- =====================================================
-- SESSIONS AND AUTH TOKENS (with rotation support from mig 001)
-- =====================================================

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP,
    replaced_by UUID REFERENCES refresh_tokens(id)
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_used_at ON refresh_tokens(used_at);

-- =====================================================
-- PARTNER VERIFICATION DOCUMENTS
-- =====================================================

CREATE TABLE partner_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_url VARCHAR(500) NOT NULL,
    company_name VARCHAR(255),
    tax_id VARCHAR(50),
    contact_person VARCHAR(100),
    contact_email VARCHAR(255),
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_partner_docs_partner ON partner_documents(partner_id);
CREATE INDEX idx_partner_docs_establishment ON partner_documents(establishment_id);

-- =====================================================
-- NOTIFICATIONS
-- =====================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
  review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- =====================================================
-- TRIGGERS FOR AUTOMATED UPDATES
-- =====================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_establishments_updated_at BEFORE UPDATE ON establishments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update establishment metrics after review changes
CREATE OR REPLACE FUNCTION update_establishment_metrics()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE establishments
    SET
        review_count = (SELECT COUNT(*) FROM reviews WHERE establishment_id = COALESCE(NEW.establishment_id, OLD.establishment_id) AND is_deleted = FALSE),
        average_rating = (SELECT COALESCE(AVG(rating)::DECIMAL(3,2), 0) FROM reviews WHERE establishment_id = COALESCE(NEW.establishment_id, OLD.establishment_id) AND is_deleted = FALSE)
    WHERE id = COALESCE(NEW.establishment_id, OLD.establishment_id);
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_metrics_after_review
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_establishment_metrics();

-- =====================================================
-- DONE — Production schema ready
-- =====================================================
