-- =====================================================
-- RESTAURANT GUIDE BELARUS — PRODUCTION SCHEMA
-- =====================================================
-- Covers migrations 001-029 + 031 + 032. Regenerated 2026-09-02 (artefact
-- audit, slice B) against PostgreSQL 16.4 / PostGIS.
--
-- *** 030 IS DELIBERATELY ABSENT. DO NOT "COMPLETE" THIS FILE BY ADDING IT. ***
-- The canon CHECK on establishments.categories / .cuisines (030, CAT-C-2.9) is
-- dormant in production: it is applied only AFTER the placeholder-seed wipe at
-- real-500 import-prep, because placeholder rows carry English tokens that the
-- constraint rejects (23514). This snapshot's job is to mirror what production
-- actually runs — not the migration catalogue. Production = 001-029 + 031 + 032.
--
-- Baking 030 in also breaks the CI gate, and that is not hypothetical: it was
-- tried on 2026-09-02 and run 33666684491 went red. `.github/workflows/ci.yml`
-- builds the test database FROM THIS FILE, then applies 031 and 032 on top;
-- `src/tests/integration/admin-quality-health.test.js` must INSERT off-canon
-- rows to prove the quality checker detects them, and the constraint makes that
-- impossible — the whole suite dies at fixture setup with
-- "violates check constraint establishments_categories_canon_check".
-- The canon-check test that DOES need 030 stands up its own scratch database.
--
-- Prior state, for the record: this snapshot had drifted to 001-029 while the
-- migration head was 032, so a database bootstrapped from it silently lacked
-- seed_import_registry (031) and password_reset_tokens (032). That gap is now
-- closed; 030's absence is a decision, not a gap.
--
-- HOW THIS REGENERATION WAS VERIFIED (not just produced):
--   * The exact CI sequence was replayed locally: restore this file, then apply
--     031 and 032 on top — both are idempotent, no 42P07.
--   * Off-canon probe: INSERT with categories ARRAY['restaurant'] SUCCEEDS here
--     and fails with 23514 against a variant carrying 030. That is the precise
--     behaviour admin-quality-health depends on.
--   * Round-trip: a second clean database restored from this file matched the
--     source object-for-object. Producing a dump proves nothing; restoring does.
--   * establishments_city_check carries BOTH Могилёв spellings (ё and е) — an
--     invariant that is easy to lose in a regeneration and expensive to notice.
--
-- Note on the "all migrations applied sequentially" phrasing in older headers:
-- that describes the file's ORIGINAL provenance, not a reproducible procedure.
-- Migrations 001+ are ALTER statements against tables that no migration in this
-- directory creates — the base schema exists only inside this snapshot.
--
-- Migrations covered (chronological):
--   001 token rotation columns           017 activate partner analytics
--   002 PostGIS extension                018 backfill base_score
--   003 location GEOGRAPHY column        019 claiming infrastructure
--   004 rename category -> cuisines      020 promotions overhaul
--   005 denormalised cards columns       021 booking system
--   006 indexing pass                    022 push notifications
--   007 reviews schema                   023 file_type on media
--   008 price_range length fix           024 OCR menu pipeline (pg_trgm)
--   009 partner responses                025 hidden_reason on menu_items
--   010 audit_log table                  026 email_verification_codes
--   011 sync test DB columns             027 establishment slug (BGN/PCGN
--   012 rejected status                      transliteration, auto-suffix on
--   013 analytics indexes                    collision — see Brief 0)
--   014 audit action index               028 drop redundant explicit slug index
--   015 oauth_provider_id on users       029 restore Могилёв (ё) variant
--   016 notifications table              030 — NOT INCLUDED, see above
--                                        031 seed_import_registry (bulk-import
--                                            idempotency / resume sidecar)
--                                        032 password_reset_tokens (SHA-256
--                                            hash-at-rest, Email-Channel Slice 1)
--
-- Note on migration 027: applied as three artifacts on the source DB
-- (027a_add_slug_column.sql → scripts/backfill-slugs.js → 027b_add_slug_constraints.sql)
-- because slug generation needs the JavaScript transliteration shared with the
-- service layer. Fresh clones get the resulting column with its constraints
-- from this snapshot, so a single-file restore is sufficient.
--
-- Note on migration 007: it declared check_content_length CHECK (length(content)
-- >= 20) on reviews, which the live database does NOT carry and this snapshot
-- therefore does not either. Deliberate and tracked (deferred_items «reviews
-- content schema-drift»): the operational floor is the validator (min 1/max 1000).
-- Do not "restore" it from the migration file — same principle as 030 above:
-- the snapshot mirrors production, not the migration catalogue.
--
-- Regeneration recipe (executable; this is what produced the current body):
--   1. docker exec pg-test psql -U postgres -c "DROP DATABASE IF EXISTS schema_rebuild;"
--   2. docker exec pg-test psql -U postgres -c "CREATE DATABASE schema_rebuild;"
--   3. Load the existing snapshot (it carries the base schema — no migration does):
--        docker exec -i pg-test psql -U postgres -d schema_rebuild -v ON_ERROR_STOP=1 \
--          < production_schema.sql
--      Then apply every migration that PRODUCTION has and the snapshot lacks —
--      check what production actually runs before assuming the catalogue head.
--   4. docker exec pg-test pg_dump -U postgres --schema-only --no-owner \
--        --no-privileges --no-comments -d schema_rebuild > <new_body>.sql
--   5. Replace this header block, keep the body.
--   6. VERIFY BY REPLAYING CI: restore the new file into a clean database, then
--      apply the migrations ci.yml applies on top, then confirm an off-canon
--      INSERT still succeeds. Skipping this is how run 33666684491 went red.
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
    CONSTRAINT bookings_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('confirmed'::character varying)::text, ('declined'::character varying)::text, ('cancelled'::character varying)::text, ('expired'::character varying)::text, ('no_show'::character varying)::text, ('completed'::character varying)::text])))
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
    CONSTRAINT device_tokens_platform_check CHECK (((platform)::text = ANY (ARRAY[('ios'::character varying)::text, ('android'::character varying)::text])))
);


--
-- Name: email_verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verification_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code character varying(6) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp without time zone,
    attempts smallint DEFAULT 0 NOT NULL
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
    CONSTRAINT establishment_media_file_type_check CHECK (((file_type)::text = ANY (ARRAY[('image'::character varying)::text, ('pdf'::character varying)::text]))),
    CONSTRAINT establishment_media_type_check CHECK (((type)::text = ANY (ARRAY[('interior'::character varying)::text, ('exterior'::character varying)::text, ('menu'::character varying)::text, ('dishes'::character varying)::text])))
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
    slug character varying(150) NOT NULL,
    CONSTRAINT establishments_city_check CHECK (((city)::text = ANY (ARRAY[('Минск'::character varying)::text, ('Гродно'::character varying)::text, ('Брест'::character varying)::text, ('Гомель'::character varying)::text, ('Витебск'::character varying)::text, ('Могилев'::character varying)::text, ('Могилёв'::character varying)::text, ('Бобруйск'::character varying)::text]))),
    CONSTRAINT establishments_price_range_check CHECK (((price_range)::text = ANY (ARRAY[('$'::character varying)::text, ('$$'::character varying)::text, ('$$$'::character varying)::text, ('$$$$'::character varying)::text]))),
    CONSTRAINT establishments_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('pending'::character varying)::text, ('active'::character varying)::text, ('rejected'::character varying)::text, ('suspended'::character varying)::text, ('archived'::character varying)::text]))),
    CONSTRAINT establishments_subscription_tier_check CHECK (((subscription_tier)::text = ANY (ARRAY[('free'::character varying)::text, ('basic'::character varying)::text, ('standard'::character varying)::text, ('premium'::character varying)::text])))
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
    CONSTRAINT chk_ocr_jobs_status CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('done'::character varying)::text, ('failed'::character varying)::text])))
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
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp without time zone
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
    CONSTRAINT promotions_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('expired'::character varying)::text, ('hidden_by_admin'::character varying)::text])))
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
-- Name: seed_import_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_import_registry (
    stable_id character varying(64) NOT NULL,
    establishment_id uuid,
    batch_id character varying(64) NOT NULL,
    content_hash character varying(64) NOT NULL,
    phase character varying(20) DEFAULT 'creating'::character varying NOT NULL,
    media_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    coords_source character varying(20),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_seed_registry_coords_source CHECK (((coords_source IS NULL) OR ((coords_source)::text = ANY ((ARRAY['sheet'::character varying, 'geocoded'::character varying, 'city_fallback'::character varying])::text[])))),
    CONSTRAINT chk_seed_registry_phase CHECK (((phase)::text = ANY ((ARRAY['creating'::character varying, 'created'::character varying, 'media_done'::character varying, 'ocr_enqueued'::character varying, 'activated'::character varying])::text[])))
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
    CONSTRAINT subscriptions_duration_type_check CHECK (((duration_type)::text = ANY (ARRAY[('day'::character varying)::text, ('three_days'::character varying)::text, ('week'::character varying)::text, ('month'::character varying)::text]))),
    CONSTRAINT subscriptions_tier_check CHECK (((tier)::text = ANY (ARRAY[('basic'::character varying)::text, ('standard'::character varying)::text, ('premium'::character varying)::text])))
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
    CONSTRAINT users_auth_method_check CHECK (((auth_method)::text = ANY (ARRAY[('email'::character varying)::text, ('phone'::character varying)::text, ('google'::character varying)::text, ('yandex'::character varying)::text]))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('user'::character varying)::text, ('partner'::character varying)::text, ('admin'::character varying)::text])))
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
-- Name: email_verification_codes email_verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_codes
    ADD CONSTRAINT email_verification_codes_pkey PRIMARY KEY (id);


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
-- Name: establishments establishments_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishments
    ADD CONSTRAINT establishments_slug_unique UNIQUE (slug);


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
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


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
-- Name: seed_import_registry seed_import_registry_establishment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_import_registry
    ADD CONSTRAINT seed_import_registry_establishment_id_key UNIQUE (establishment_id);


--
-- Name: seed_import_registry seed_import_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_import_registry
    ADD CONSTRAINT seed_import_registry_pkey PRIMARY KEY (stable_id);


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
-- Name: idx_email_verification_codes_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verification_codes_expires_at ON public.email_verification_codes USING btree (expires_at);


--
-- Name: idx_email_verification_codes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verification_codes_user_id ON public.email_verification_codes USING btree (user_id);


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
-- Name: idx_password_reset_tokens_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_token_hash ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: idx_password_reset_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_user_id ON public.password_reset_tokens USING btree (user_id);


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
-- Name: idx_seed_registry_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seed_registry_batch ON public.seed_import_registry USING btree (batch_id);


--
-- Name: idx_seed_registry_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seed_registry_phase ON public.seed_import_registry USING btree (phase);


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
-- Name: email_verification_codes email_verification_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_codes
    ADD CONSTRAINT email_verification_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


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
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


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
-- Name: seed_import_registry seed_import_registry_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_import_registry
    ADD CONSTRAINT seed_import_registry_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

