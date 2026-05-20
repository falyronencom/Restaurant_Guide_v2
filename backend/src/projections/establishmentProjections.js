/**
 * Establishment Public Projections
 *
 * Pure functions that transform raw establishment DB rows into public-safe
 * shapes for API responses. Each projection excludes partner/admin-sensitive
 * fields (partner_email, subscription_tier, base_score, moderation_notes,
 * etc.) and includes derived fields (city_slug, category_slug) computed
 * from existing data.
 *
 * Three projections by use case:
 *   - toPublicEstablishment: full single-establishment detail (with media)
 *   - toPublicEstablishmentListing: list/catalog rows (no media array)
 *   - toPublicEstablishmentMapMarker: minimal map pin payload
 *
 * Excluded fields (NEVER appear in public projection output):
 *   partner_id, partner_name, partner_email (joined),
 *   subscription_tier, subscription_started_at, subscription_expires_at,
 *   base_score, boost_score,
 *   is_seed, claimed_at, claimed_by,
 *   moderation_notes, moderated_by, moderated_at.
 *
 * Idempotency: same input row → same output object. No side effects, no
 * I/O, no DB calls. Safe to call repeatedly.
 */

import { cityCyrillicToSlug, categoryCyrillicToSlug } from '../constants/urlSlugs.js';

/**
 * Convert raw establishment row to full public detail projection.
 *
 * Used by:
 *   - GET /api/v1/public/establishments/by-slug/:slug
 *   - GET /api/v1/public/establishments/by-id/:id
 *   - GET /api/v1/search/establishments/:id (fix-in-place for mobile)
 *
 * @param {Object} row - Raw establishment row from searchService/establishmentModel
 * @returns {Object} Public projection with media[] and promotions[] if present
 */
export const toPublicEstablishment = (row) => {
  if (!row) return null;

  const primaryCategory = Array.isArray(row.categories) && row.categories.length > 0
    ? row.categories[0]
    : null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    city: row.city,
    city_slug: cityCyrillicToSlug(row.city),
    address: row.address,
    latitude: row.latitude !== null && row.latitude !== undefined
      ? parseFloat(row.latitude)
      : null,
    longitude: row.longitude !== null && row.longitude !== undefined
      ? parseFloat(row.longitude)
      : null,
    phone: row.phone,
    email: row.email,
    website: row.website,
    categories: row.categories || [],
    category_slug: categoryCyrillicToSlug(primaryCategory),
    cuisines: row.cuisines || [],
    price_range: row.price_range,
    working_hours: row.working_hours,
    special_hours: row.special_hours,
    attributes: row.attributes,
    // status preserved — mobile establishment.dart casts json['status'] as
    // non-nullable String and uses it in isOpenNow() fallback logic. NOT
    // in directive exclusion list (only partner/admin/internal-scoring
    // fields are excluded). Public endpoints filter status='active'
    // upstream, so this value is essentially constant for clients, but
    // removing the key crashes Dart parsing.
    status: row.status,
    primary_image_url: row.primary_image_url,
    review_count: parseInt(row.review_count) || 0,
    average_rating: row.average_rating !== null && row.average_rating !== undefined
      ? parseFloat(row.average_rating)
      : null,
    favorite_count: parseInt(row.favorite_count) || 0,
    view_count: parseInt(row.view_count) || 0,
    booking_enabled: !!row.booking_enabled,
    has_promotion: !!row.has_promotion,
    promotion_count: parseInt(row.promotion_count) || 0,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    media: Array.isArray(row.media) ? row.media : [],
    promotions: Array.isArray(row.promotions) ? row.promotions : [],
  };
};

/**
 * Convert raw establishment row to lightweight listing projection.
 *
 * Used by:
 *   - GET /api/v1/public/establishments (catalog list)
 *   - GET /api/v1/search/establishments (fix-in-place for mobile)
 *   - GET /api/v1/search/map (fix-in-place for mobile — preserves listing
 *     shape rather than minimum mapMarker, to avoid removing fields the
 *     mobile map currently consumes)
 *
 * Difference from toPublicEstablishment: no media[] / promotions[] arrays
 * (caller fetches separately if needed); preserves distance_km if present
 * for radius searches.
 *
 * @param {Object} row - Raw establishment row
 * @returns {Object} Lightweight public listing projection
 */
export const toPublicEstablishmentListing = (row) => {
  if (!row) return null;

  const primaryCategory = Array.isArray(row.categories) && row.categories.length > 0
    ? row.categories[0]
    : null;

  const projection = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    city: row.city,
    city_slug: cityCyrillicToSlug(row.city),
    address: row.address,
    latitude: row.latitude !== null && row.latitude !== undefined
      ? parseFloat(row.latitude)
      : null,
    longitude: row.longitude !== null && row.longitude !== undefined
      ? parseFloat(row.longitude)
      : null,
    phone: row.phone,
    website: row.website,
    categories: row.categories || [],
    category_slug: categoryCyrillicToSlug(primaryCategory),
    cuisines: row.cuisines || [],
    price_range: row.price_range,
    working_hours: row.working_hours,
    attributes: row.attributes,
    // status preserved — see note in toPublicEstablishment. Mobile Dart
    // model casts non-nullably and uses for isOpenNow() fallback.
    status: row.status,
    primary_image_url: row.primary_image_url,
    review_count: parseInt(row.review_count) || 0,
    average_rating: row.average_rating !== null && row.average_rating !== undefined
      ? parseFloat(row.average_rating)
      : null,
    favorite_count: parseInt(row.favorite_count) || 0,
    booking_enabled: !!row.booking_enabled,
    has_promotion: !!row.has_promotion,
    promotion_count: parseInt(row.promotion_count) || 0,
    published_at: row.published_at,
    created_at: row.created_at,
    // updated_at required — mobile establishment.dart parses non-nullably
    // (DateTime.parse(json['updated_at'] as String)). Omitting it crashes
    // the entire list with a generic "Не удалось загрузить" overlay; the
    // map endpoint, which uses the same projection, silently shows zero
    // markers because per-item try/catch skips parse failures.
    updated_at: row.updated_at,
  };

  // distance_km / distance — only when radius search produced them.
  // Preserve both fields (mobile and tests reference both shapes).
  if (row.distance_km !== undefined && row.distance_km !== null) {
    const distance = parseFloat(row.distance_km);
    projection.distance_km = distance;
    projection.distance = distance;
  }

  return projection;
};

/**
 * Convert raw establishment row to minimum map marker projection.
 *
 * Used by:
 *   - GET /api/v1/public/establishments/map (new public endpoint only)
 *
 * Minimum payload designed for high-volume map view rendering: only
 * fields the marker UI needs (position, label, image, rating, promo flag).
 * Mobile /search/map preserves richer listing projection — see
 * toPublicEstablishmentListing.
 *
 * @param {Object} row - Raw establishment row
 * @returns {Object} Minimum public map marker projection
 */
export const toPublicEstablishmentMapMarker = (row) => {
  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    city_slug: cityCyrillicToSlug(row.city),
    latitude: row.latitude !== null && row.latitude !== undefined
      ? parseFloat(row.latitude)
      : null,
    longitude: row.longitude !== null && row.longitude !== undefined
      ? parseFloat(row.longitude)
      : null,
    primary_image_url: row.primary_image_url,
    average_rating: row.average_rating !== null && row.average_rating !== undefined
      ? parseFloat(row.average_rating)
      : null,
    has_promotion: !!row.has_promotion,
  };
};
