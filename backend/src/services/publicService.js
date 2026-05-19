/**
 * Public Service
 *
 * Business-logic layer for the public read-only API surface (Brief 1).
 * Encapsulates: status='active' strict filter, Mogilev ё/е DB expansion,
 * projection orchestration for the new map-marker view, slug-based
 * establishment lookup with media+promotions assembly.
 *
 * Inputs: pre-validated Cyrillic strings (controller validates slug→Cyrillic
 * translation; null slugs become 400 before reaching this service).
 * Outputs: projection-applied data ready for HTTP response.
 *
 * Design choice — fixed status filter: this service is the ONLY consumer
 * intended for public web. Mobile uses /search/* routes which apply the same
 * projection but allow searchService default behaviour. Public service
 * additionally enforces strict status='active' via service-layer re-check
 * for slug-based lookups (findEstablishmentBySlug default excludes only
 * 'archived' — Brief 1 requires excluding draft/pending/rejected/suspended too).
 */

import * as searchService from './searchService.js';
import * as reviewService from './reviewService.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as MediaModel from '../models/mediaModel.js';
import * as PromotionModel from '../models/promotionModel.js';
import * as MenuItemModel from '../models/menuItemModel.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  toPublicEstablishment,
  toPublicEstablishmentMapMarker,
} from '../projections/establishmentProjections.js';
import { toPublicReview } from '../projections/reviewProjections.js';
import { toPublicMenuItem } from '../projections/menuItemProjections.js';
import {
  CITY_SLUG_MAP,
  CATEGORY_SLUG_MAP,
  CUISINE_SLUG_MAP,
  cityCyrillicToSlug,
  categoryCyrillicToSlug,
  cuisineCyrillicToSlug,
  expandCityForQuery,
} from '../constants/urlSlugs.js';
import logger from '../utils/logger.js';

/**
 * Catalog list of public establishments. Used by GET /api/v1/public/establishments.
 *
 * Always uses searchWithoutLocation (Brief 1 does not include coordinate-based
 * public search — see Discovery Report D6). City parameter (already Cyrillic)
 * is expanded via expandCityForQuery to cover the Mogilev ё/е data variants.
 *
 * @param {Object} filters - Cyrillic values, already validated
 * @param {string} [filters.city] - Cyrillic city name (canonical)
 * @param {string[]} [filters.categories] - Cyrillic categories
 * @param {string[]} [filters.cuisines] - Cyrillic cuisines
 * @param {string[]} [filters.priceRange]
 * @param {number} [filters.minRating]
 * @param {string} [filters.search]
 * @param {string} [filters.sortBy]
 * @param {number} [filters.limit=20]
 * @param {number} [filters.page=1]
 * @returns {Promise<Object>} { establishments, pagination }
 */
export const getPublicEstablishmentsCatalog = async (filters = {}) => {
  const {
    city,
    categories,
    cuisines,
    priceRange,
    minRating,
    search,
    sortBy,
    limit = 20,
    page = 1,
  } = filters;

  const cityForQuery = city ? expandCityForQuery(city) : null;
  const offset = (page - 1) * limit;

  // searchWithoutLocation already applies toPublicEstablishmentListing
  // projection in its return statement (fix-in-place). Pass city as array
  // to engage the array branch in the city filter (covers Mogilev variants).
  const result = await searchService.searchWithoutLocation({
    city: cityForQuery,
    categories,
    cuisines,
    priceRange,
    minRating,
    sortBy,
    search,
    limit,
    offset,
    page,
  });

  return result;
};

/**
 * Map view of public establishments. Used by GET /api/v1/public/establishments/map.
 *
 * Brief 1 does not accept bounds parameters — returns up to `limit` (default 200,
 * max 500) establishments matching the filter scope, projected to minimum
 * map-marker shape. Bounds support is deferred to Brief 3+ once web map UX
 * is settled.
 *
 * @param {Object} filters - Cyrillic values, already validated
 * @returns {Promise<Object>} { establishments: [mapMarker projection] }
 */
export const getPublicEstablishmentsMap = async (filters = {}) => {
  const {
    city,
    categories,
    cuisines,
    priceRange,
    minRating,
    hoursFilter,
    search,
    limit = 200,
  } = filters;

  const cityForQuery = city ? expandCityForQuery(city) : null;
  const safeLimit = Math.min(Math.max(limit, 1), 500);

  // searchWithoutLocation applies listing projection in its return. Map endpoint
  // wants the minimum marker projection — re-project listing → mapMarker by
  // selecting subset fields (toPublicEstablishmentMapMarker accepts listing-
  // shaped input because all the marker fields are a subset of listing fields).
  const result = await searchService.searchWithoutLocation({
    city: cityForQuery,
    categories,
    cuisines,
    priceRange,
    minRating,
    hoursFilter,
    search,
    limit: safeLimit,
    offset: 0,
    page: 1,
  });

  const markers = result.establishments.map(toPublicEstablishmentMapMarker);

  return { establishments: markers };
};

/**
 * Look up an establishment by slug, enforce strict status='active', attach
 * media + active promotions, apply full public projection.
 *
 * Used by GET /api/v1/public/establishments/by-slug/:slug.
 *
 * @param {string} slug - URL slug (e.g., 'kafe-vesna')
 * @returns {Promise<Object>} Full public establishment projection
 * @throws {AppError} 404 if not found OR not active
 */
export const getPublicEstablishmentBySlug = async (slug) => {
  // findEstablishmentBySlug default excludes only 'archived'. Strict status
  // check enforced here at service layer.
  const row = await EstablishmentModel.findEstablishmentBySlug(slug, true);

  if (!row || row.status !== 'active') {
    throw new AppError('Establishment not found', 404, 'NOT_FOUND');
  }

  return await assembleEstablishmentDetail(row);
};

/**
 * Look up an establishment by UUID. Same response shape and strict filter
 * as by-slug, retained for completeness (deprecated in favour of by-slug
 * for new web scenarios per directive).
 *
 * @param {string} id - Establishment UUID
 * @returns {Promise<Object>} Full public establishment projection
 * @throws {AppError} 404 if not found OR not active
 */
export const getPublicEstablishmentById = async (id) => {
  const row = await EstablishmentModel.findEstablishmentById(id, true);

  if (!row || row.status !== 'active') {
    throw new AppError('Establishment not found', 404, 'NOT_FOUND');
  }

  return await assembleEstablishmentDetail(row);
};

/**
 * Internal helper. Loads media + active promotions for an establishment
 * row, increments view count (fire-and-forget), applies full public
 * projection. Shared by by-slug and by-id endpoints.
 *
 * @param {Object} row - Raw establishment row (already verified active)
 * @returns {Promise<Object>} Full public projection with media[] and promotions[]
 */
const assembleEstablishmentDetail = async (row) => {
  // Fire-and-forget view tracking — preserves behaviour of legacy
  // /search/establishments/:id endpoint. Public web bot crawls will inflate
  // view_count; bot filtering is deferred to a future Brief per directive.
  EstablishmentModel.incrementViewCount(row.id);

  const [media, promotions] = await Promise.all([
    MediaModel.getEstablishmentMedia(row.id),
    PromotionModel.getPromotionsByEstablishment(row.id, false).catch(err => {
      logger.warn('Failed to fetch promotions for public detail endpoint', {
        id: row.id,
        error: err.message,
      });
      return [];
    }),
  ]);

  return toPublicEstablishment({
    ...row,
    media,
    promotions,
  });
};

/**
 * Get public menu items for an establishment identified by slug.
 *
 * Used by GET /api/v1/public/establishments/by-slug/:slug/menu-items.
 *
 * Behaviour:
 *   - Looks up establishment by slug, enforces strict status='active'
 *   - Calls MenuItemModel.getByEstablishmentId with includeHidden=false
 *     (admin-hidden items never reach public response)
 *   - Returns empty array if establishment has no parsed menu yet
 *
 * @param {string} slug
 * @returns {Promise<{ menu_items: Object[] }>}
 * @throws {AppError} 404 if establishment not found OR not active
 */
export const getPublicMenuItems = async (slug) => {
  const establishment = await EstablishmentModel.findEstablishmentBySlug(slug, true);

  if (!establishment || establishment.status !== 'active') {
    throw new AppError('Establishment not found', 404, 'NOT_FOUND');
  }

  const items = await MenuItemModel.getByEstablishmentId(establishment.id, {
    includeHidden: false,
  });

  return {
    menu_items: items.map(toPublicMenuItem),
  };
};

/**
 * Get public reviews for an establishment identified by slug.
 *
 * Used by GET /api/v1/public/establishments/by-slug/:slug/reviews.
 *
 * Reuses reviewService.getEstablishmentReviews which already filters
 * is_visible=TRUE and is_deleted=FALSE. Pagination shape is normalised
 * to the public surface convention (`totalPages` instead of `pages`).
 *
 * @param {string} slug
 * @param {Object} options - { page=1, limit=10 }
 * @returns {Promise<{ reviews, pagination }>}
 * @throws {AppError} 404 if establishment not found OR not active
 */
export const getPublicReviews = async (slug, options = {}) => {
  const { page = 1, limit = 10 } = options;

  const establishment = await EstablishmentModel.findEstablishmentBySlug(slug, true);

  if (!establishment || establishment.status !== 'active') {
    throw new AppError('Establishment not found', 404, 'NOT_FOUND');
  }

  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safePage = Math.max(page, 1);

  const result = await reviewService.getEstablishmentReviews(establishment.id, {
    page: safePage,
    limit: safeLimit,
    sort: 'newest',
  });

  // Normalise pagination shape: reviewService returns `pages` (existing
  // convention); public surface uses `totalPages` consistently.
  const reviews = result.reviews.map(toPublicReview);
  const pagination = {
    page: result.pagination.page,
    limit: result.pagination.limit,
    total: result.pagination.total,
    totalPages: result.pagination.pages,
    hasNext: result.pagination.hasNext,
    hasPrevious: result.pagination.hasPrevious,
  };

  return { reviews, pagination };
};

/**
 * Get public metadata: cities, categories, cuisines as { slug, name } pairs.
 *
 * Used by GET /api/v1/public/metadata.
 *
 * Pure data from constants — no DB query. Mogilev edge case: only the
 * canonical 'Могилев' entry is exposed (the 'Могилёв' variant is a data
 * accommodation, not a separate metadata entity).
 *
 * @returns {{ cities, categories, cuisines }}
 */
export const getPublicMetadata = () => {
  // Cities: deduplicate slugs (both Mogilev variants share 'mogilev' slug),
  // expose canonical Cyrillic name per slug.
  const cities = [];
  const seenCitySlug = new Set();
  for (const cyrillic of Object.keys(CITY_SLUG_MAP)) {
    const slug = cityCyrillicToSlug(cyrillic);
    if (slug && !seenCitySlug.has(slug)) {
      seenCitySlug.add(slug);
      // Canonical 'Могилев' (without ё) when slug is 'mogilev'
      const canonical = slug === 'mogilev' ? 'Могилев' : cyrillic;
      cities.push({ slug, name: canonical });
    }
  }

  const categories = Object.keys(CATEGORY_SLUG_MAP).map(name => ({
    slug: categoryCyrillicToSlug(name),
    name,
  }));

  const cuisines = Object.keys(CUISINE_SLUG_MAP).map(name => ({
    slug: cuisineCyrillicToSlug(name),
    name,
  }));

  return { cities, categories, cuisines };
};
