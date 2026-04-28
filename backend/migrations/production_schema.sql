-- =====================================================
-- RESTAURANT GUIDE BELARUS — PRODUCTION SCHEMA
-- =====================================================
-- Includes migrations 001-025 (last update: April 2026).
-- Generated via pg_dump --schema-only against a fresh DB to which all
-- migrations were applied sequentially. This file is the authoritative
-- snapshot used to bootstrap fresh databases (e.g. Railway initial deploy
-- or local dev). For incremental schema evolution use the numbered files
-- in backend/migrations/ instead.
--
-- Migrations covered (chronological):
--   001 token rotation columns           014 audit action index
--   002 PostGIS extension                 015 oauth_provider_id on users
--   003 location GEOGRAPHY column         016 notifications table
--   004 rename category -> cuisines       017 activate partner analytics
--   005 denormalised cards columns        018 backfill base_score
--   006 indexing pass                     019 claiming infrastructure
--   007 reviews schema                    020 promotions overhaul
--   008 price_range length fix            021 booking system
--   009 partner responses                 022 push notifications
--   010 audit_log table                   023 file_type on media
--   011 sync test DB columns              024 OCR menu pipeline (pg_trgm)
--   012 rejected status                   025 hidden_reason on menu_items
--   013 analytics indexes
--
-- Regeneration recipe (Option B from Audit Phase 3 Brief #2):
--   1. docker exec pg-test psql -U postgres -c "DROP DATABASE IF EXISTS schema_rebuild;"
--   2. docker exec pg-test psql -U postgres -c "CREATE DATABASE schema_rebuild;"
--   3. for f in 001..020 (existing snapshot) THEN 021..025 (sequential): apply via psql
--   4. docker exec pg-test pg_dump -U postgres --schema-only --no-owner \
--        --no-privileges --no-comments -d schema_rebuild > production_schema.sql
--   5. Replace this header block, keep the body.
-- =====================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: update_establishment_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_establishment_metrics() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE establishments
    SET
        review_count = (SELECT COUNT(*) FROM reviews WHERE establishment_id = COALESCE(NEW.establishment_id, OLD.establishment_id) AND is_deleted = FALSE),
        average_rating = (SELECT COALESCE(AVG(rating)::DECIMAL(3,2), 0) FROM reviews WHERE establishment_id = COALESCE(NEW.establishment_id, OLD.establishment_id) AND is_deleted = FALSE)
    WHERE id = COALESCE(NEW.establishment_id, OLD.establishment_id);
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid,
    old_data jsonb,
    new_data jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: booking_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    is_enabled boolean DEFAULT false,
    max_guests_per_booking integer DEFAULT 10 NOT NULL,
    confirmation_timeout_hours integer DEFAULT 4 NOT NULL,
    max_days_ahead integer DEFAULT 7 NOT NULL,
    min_hours_before integer DEFAULT 2 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT booking_settings_confirmation_timeout_hours_check CHECK ((confirmation_timeout_hours = ANY (ARRAY[2, 4, 6]))),
    CONSTRAINT booking_settings_max_days_ahead_check CHECK ((max_days_ahead = ANY (ARRAY[0, 1, 3, 7, 14, 30]))),
    CONSTRAINT booking_settings_min_hours_before_check CHECK ((min_hours_before = ANY (ARRAY[1, 2, 3, 6, 12, 24])))
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    booking_date date NOT NULL,
    booking_time time without time zone NOT NULL,
    guest_count integer NOT NULL,
    comment text,
    contact_phone character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    decline_reason text,
    expires_at timestamp without time zone NOT NULL,
    confirmed_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bookings_guest_count_check CHECK ((guest_count >= 1)),
    CONSTRAINT bookings_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'confirmed'::character varying, 'declined'::character varying, 'cancelled'::character varying, 'expired'::character varying, 'no_show'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    fcm_token character varying(500) NOT NULL,
    platform character varying(10) NOT NULL,
    device_name character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT device_tokens_platform_check CHECK (((platform)::text = ANY ((ARRAY['ios'::character varying, 'android'::character varying])::text[])))
);


--
-- Name: establishment_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.establishment_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    date date NOT NULL,
    view_count integer DEFAULT 0,
    detail_view_count integer DEFAULT 0,
    favorite_count integer DEFAULT 0,
    review_count integer DEFAULT 0,
    call_count integer DEFAULT 0,
    promotion_view_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    booking_request_count integer DEFAULT 0,
    booking_confirmed_count integer DEFAULT 0
);


--
-- Name: establishment_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.establishment_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    url character varying(500) NOT NULL,
    thumbnail_url character varying(500),
    preview_url character varying(500),
    caption character varying(255),
    "position" integer DEFAULT 0 NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    file_type character varying(10) DEFAULT 'image'::character varying NOT NULL,
    CONSTRAINT establishment_media_file_type_check CHECK (((file_type)::text = ANY ((ARRAY['image'::character varying, 'pdf'::character varying])::text[]))),
    CONSTRAINT establishment_media_type_check CHECK (((type)::text = ANY ((ARRAY['interior'::character varying, 'exterior'::character varying, 'menu'::character varying, 'dishes'::character varying])::text[])))
);


--
-- Name: establishments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.establishments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    city character varying(50) NOT NULL,
    address character varying(500) NOT NULL,
    latitude numeric(10,8) NOT NULL,
    longitude numeric(11,8) NOT NULL,
    location public.geography(Point,4326),
    phone character varying(20),
    email character varying(255),
    website character varying(255),
    categories character varying(50)[],
    cuisines character varying(50)[] NOT NULL,
    price_range character varying(4),
    working_hours jsonb NOT NULL,
    special_hours jsonb,
    attributes jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    moderation_notes text,
    moderated_by uuid,
    moderated_at timestamp without time zone,
    subscription_tier character varying(20) DEFAULT 'free'::character varying,
    subscription_started_at timestamp without time zone,
    subscription_expires_at timestamp without time zone,
    base_score integer DEFAULT 0,
    boost_score integer DEFAULT 0,
    view_count integer DEFAULT 0,
    favorite_count integer DEFAULT 0,
    review_count integer DEFAULT 0,
    average_rating numeric(3,2) DEFAULT 0.0,
    primary_image_url text,
    average_check_byn numeric(10,2),
    is_24_hours boolean DEFAULT false,
    is_seed boolean DEFAULT false,
    claimed_at timestamp without time zone,
    claimed_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    published_at timestamp without time zone,
    booking_enabled boolean DEFAULT false,
    CONSTRAINT establishments_city_check CHECK (((city)::text = ANY ((ARRAY['Минск'::character varying, 'Гродно'::character varying, 'Брест'::character varying, 'Гомель'::character varying, 'Витебск'::character varying, 'Могилев'::character varying, 'Бобруйск'::character varying])::text[]))),
    CONSTRAINT establishments_price_range_check CHECK (((price_range)::text = ANY ((ARRAY['$'::character varying, '$$'::character varying, '$$$'::character varying, '$$$$'::character varying])::text[]))),
    CONSTRAINT establishments_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'pending'::character varying, 'active'::character varying, 'rejected'::character varying, 'suspended'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT establishments_subscription_tier_check CHECK (((subscription_tier)::text = ANY ((ARRAY['free'::character varying, 'basic'::character varying, 'standard'::character varying, 'premium'::character varying])::text[])))
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    establishment_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    media_id uuid NOT NULL,
    item_name character varying(255) NOT NULL,
    price_byn numeric(10,2),
    category_raw character varying(100),
    confidence numeric(3,2),
    sanity_flag jsonb,
    is_hidden_by_admin boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    hidden_reason text,
    CONSTRAINT chk_menu_items_confidence CHECK (((confidence IS NULL) OR ((confidence >= 0.00) AND (confidence <= 1.00))))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    booking_push_enabled boolean DEFAULT true,
    reviews_push_enabled boolean DEFAULT true,
    promotions_push_enabled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    establishment_id uuid,
    review_id uuid,
    is_read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ocr_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    media_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    error_message text,
    result_summary jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    CONSTRAINT chk_ocr_jobs_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'done'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: partner_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    establishment_id uuid,
    document_type character varying(50) NOT NULL,
    document_url character varying(500) NOT NULL,
    company_name character varying(255),
    tax_id character varying(50),
    contact_person character varying(100),
    contact_email character varying(255),
    verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    terms_and_conditions text,
    image_url character varying(500),
    thumbnail_url character varying(500),
    preview_url character varying(500),
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date,
    status character varying(20) DEFAULT 'active'::character varying,
    "position" integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    valid_from_time time without time zone,
    valid_until_time time without time zone,
    menu_item_id uuid,
    discount_price_byn numeric(10,2),
    CONSTRAINT promotions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'expired'::character varying, 'hidden_by_admin'::character varying])::text[])))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token character varying(500) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp without time zone,
    replaced_by uuid
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    establishment_id uuid NOT NULL,
    rating integer NOT NULL,
    text text,
    content text,
    is_visible boolean DEFAULT true,
    is_edited boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    partner_response text,
    partner_response_at timestamp with time zone,
    partner_responder_id uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    establishment_id uuid NOT NULL,
    tier character varying(20) NOT NULL,
    duration_type character varying(20) NOT NULL,
    started_at timestamp without time zone NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    is_active boolean DEFAULT true,
    auto_renew boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subscriptions_duration_type_check CHECK (((duration_type)::text = ANY ((ARRAY['day'::character varying, 'three_days'::character varying, 'week'::character varying, 'month'::character varying])::text[]))),
    CONSTRAINT subscriptions_tier_check CHECK (((tier)::text = ANY ((ARRAY['basic'::character varying, 'standard'::character varying, 'premium'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255),
    phone character varying(20),
    password_hash character varying(255),
    name character varying(100) NOT NULL,
    avatar_url character varying(500),
    role character varying(20) NOT NULL,
    auth_method character varying(20) NOT NULL,
    oauth_provider_id character varying(255),
    email_verified boolean DEFAULT false,
    phone_verified boolean DEFAULT false,
    is_active boolean DEFAULT true,
    last_login_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_auth_method_check CHECK (((auth_method)::text = ANY ((ARRAY['email'::character varying, 'phone'::character varying, 'google'::character varying, 'yandex'::character varying])::text[]))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'partner'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: booking_settings booking_settings_establishment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_establishment_id_key UNIQUE (establishment_id);


--
-- Name: booking_settings booking_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_user_id_fcm_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fcm_token_key UNIQUE (user_id, fcm_token);


--
-- Name: establishment_analytics establishment_analytics_establishment_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishment_analytics
    ADD CONSTRAINT establishment_analytics_establishment_id_date_key UNIQUE (establishment_id, date);


--
-- Name: establishment_analytics establishment_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishment_analytics
    ADD CONSTRAINT establishment_analytics_pkey PRIMARY KEY (id);


--
-- Name: establishment_media establishment_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishment_media
    ADD CONSTRAINT establishment_media_pkey PRIMARY KEY (id);


--
-- Name: establishments establishments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishments
    ADD CONSTRAINT establishments_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_user_id_establishment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_establishment_id_key UNIQUE (user_id, establishment_id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_key UNIQUE (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ocr_jobs ocr_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_jobs
    ADD CONSTRAINT ocr_jobs_pkey PRIMARY KEY (id);


--
-- Name: partner_documents partner_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT partner_documents_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_analytics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_date ON public.establishment_analytics USING btree (date);


--
-- Name: idx_analytics_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_establishment ON public.establishment_analytics USING btree (establishment_id);


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created ON public.audit_log USING btree (created_at);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_log USING btree (user_id);


--
-- Name: idx_booking_settings_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_settings_establishment ON public.booking_settings USING btree (establishment_id);


--
-- Name: idx_bookings_establishment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_establishment_status ON public.bookings USING btree (establishment_id, status);


--
-- Name: idx_bookings_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_expires ON public.bookings USING btree (expires_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_bookings_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_user_status ON public.bookings USING btree (user_id, status);


--
-- Name: idx_device_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_tokens_user_id ON public.device_tokens USING btree (user_id);


--
-- Name: idx_establishments_categories; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_categories ON public.establishments USING gin (categories);


--
-- Name: idx_establishments_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_city ON public.establishments USING btree (city);


--
-- Name: idx_establishments_cuisines; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_cuisines ON public.establishments USING gin (cuisines);


--
-- Name: idx_establishments_is_seed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_is_seed ON public.establishments USING btree (is_seed) WHERE (is_seed = true);


--
-- Name: idx_establishments_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_partner ON public.establishments USING btree (partner_id);


--
-- Name: idx_establishments_price_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_price_range ON public.establishments USING btree (price_range);


--
-- Name: idx_establishments_ranking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_ranking ON public.establishments USING btree (((base_score + boost_score)) DESC, average_rating DESC);


--
-- Name: idx_establishments_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_rating ON public.establishments USING btree (average_rating DESC);


--
-- Name: idx_establishments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_status ON public.establishments USING btree (status);


--
-- Name: idx_establishments_subscription_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_subscription_tier ON public.establishments USING btree (subscription_tier);


--
-- Name: idx_favorites_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_favorites_establishment ON public.favorites USING btree (establishment_id);


--
-- Name: idx_favorites_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_favorites_user ON public.favorites USING btree (user_id);


--
-- Name: idx_media_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_establishment ON public.establishment_media USING btree (establishment_id);


--
-- Name: idx_media_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_primary ON public.establishment_media USING btree (establishment_id, is_primary);


--
-- Name: idx_media_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_type ON public.establishment_media USING btree (type);


--
-- Name: idx_media_type_file_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_type_file_type ON public.establishment_media USING btree (establishment_id, type, file_type);


--
-- Name: idx_menu_items_establishment_hidden; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_establishment_hidden ON public.menu_items USING btree (establishment_id, is_hidden_by_admin);


--
-- Name: idx_menu_items_media; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_media ON public.menu_items USING btree (media_id);


--
-- Name: idx_menu_items_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_name_trgm ON public.menu_items USING gin (item_name public.gin_trgm_ops);


--
-- Name: idx_notification_preferences_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_preferences_user_id ON public.notification_preferences USING btree (user_id);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read) WHERE (is_read = false);


--
-- Name: idx_ocr_jobs_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ocr_jobs_status_created ON public.ocr_jobs USING btree (status, created_at);


--
-- Name: idx_partner_docs_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_docs_establishment ON public.partner_documents USING btree (establishment_id);


--
-- Name: idx_partner_docs_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_docs_partner ON public.partner_documents USING btree (partner_id);


--
-- Name: idx_promotions_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotions_dates ON public.promotions USING btree (valid_from, valid_until);


--
-- Name: idx_promotions_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotions_establishment ON public.promotions USING btree (establishment_id);


--
-- Name: idx_promotions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotions_status ON public.promotions USING btree (establishment_id, status);


--
-- Name: idx_refresh_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_token ON public.refresh_tokens USING btree (token);


--
-- Name: idx_refresh_tokens_used_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_used_at ON public.refresh_tokens USING btree (used_at);


--
-- Name: idx_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_reviews_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_created_at ON public.reviews USING btree (created_at);


--
-- Name: idx_reviews_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_establishment ON public.reviews USING btree (establishment_id);


--
-- Name: idx_reviews_establishment_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_establishment_created ON public.reviews USING btree (establishment_id, created_at DESC);


--
-- Name: idx_reviews_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_rating ON public.reviews USING btree (rating);


--
-- Name: idx_reviews_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user ON public.reviews USING btree (user_id);


--
-- Name: idx_reviews_user_establishment_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_reviews_user_establishment_active ON public.reviews USING btree (user_id, establishment_id) WHERE (is_deleted = false);


--
-- Name: idx_subscriptions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_active ON public.subscriptions USING btree (establishment_id, is_active);


--
-- Name: idx_subscriptions_establishment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_establishment ON public.subscriptions USING btree (establishment_id);


--
-- Name: idx_subscriptions_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_expiry ON public.subscriptions USING btree (expires_at);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_oauth_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_oauth_provider ON public.users USING btree (auth_method, oauth_provider_id) WHERE (oauth_provider_id IS NOT NULL);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: establishments update_establishments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_establishments_updated_at BEFORE UPDATE ON public.establishments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reviews update_metrics_after_review; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_metrics_after_review AFTER INSERT OR DELETE OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_establishment_metrics();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: booking_settings booking_settings_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: establishment_analytics establishment_analytics_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishment_analytics
    ADD CONSTRAINT establishment_analytics_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: establishment_media establishment_media_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishment_media
    ADD CONSTRAINT establishment_media_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: establishments establishments_claimed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishments
    ADD CONSTRAINT establishments_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES public.users(id);


--
-- Name: establishments establishments_moderated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishments
    ADD CONSTRAINT establishments_moderated_by_fkey FOREIGN KEY (moderated_by) REFERENCES public.users(id);


--
-- Name: establishments establishments_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishments
    ADD CONSTRAINT establishments_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.establishment_media(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ocr_jobs ocr_jobs_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_jobs
    ADD CONSTRAINT ocr_jobs_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: ocr_jobs ocr_jobs_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_jobs
    ADD CONSTRAINT ocr_jobs_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.establishment_media(id) ON DELETE CASCADE;


--
-- Name: partner_documents partner_documents_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT partner_documents_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: partner_documents partner_documents_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT partner_documents_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_documents partner_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT partner_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: promotions promotions_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: promotions promotions_menu_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_replaced_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES public.refresh_tokens(id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_partner_responder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_partner_responder_id_fkey FOREIGN KEY (partner_responder_id) REFERENCES public.users(id);


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

