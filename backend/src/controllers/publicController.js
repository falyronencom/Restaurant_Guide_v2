/**
 * Public Controller
 *
 * HTTP handlers for the public read-only API surface (/api/v1/public/*).
 * Responsibilities: parse query parameters, translate URL slugs to internal
 * Cyrillic values, validate slug correctness (400 on unknown), delegate to
 * publicService, format response.
 *
 * All endpoints are fully public (no auth middleware) — inherit the global
 * unauthenticated rate limit (300/hr per IP) from server.js.
 */

import * as publicService from '../services/publicService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import {
  citySlugToCyrillic,
  categorySlugToCyrillic,
  cuisineSlugToCyrillic,
} from '../constants/urlSlugs.js';
import logger from '../utils/logger.js';

/**
 * Parse a comma-separated or array query parameter into a trimmed string array,
 * or null if absent. Mirrors searchController's pattern.
 */
const parseListParam = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const items = Array.isArray(raw) ? raw : String(raw).split(',');
  const trimmed = items.map(s => String(s).trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Translate a list of slugs through a slug→Cyrillic function. If any slug
 * fails translation, throws AppError 400 listing the invalid value.
 */
const translateSlugList = (slugs, translator, label) => {
  if (!slugs) return null;
  const result = [];
  for (const slug of slugs) {
    const cyrillic = translator(slug);
    if (!cyrillic) {
      throw new AppError(
        `Invalid ${label} slug: "${slug}"`,
        400,
        'INVALID_SLUG',
      );
    }
    result.push(cyrillic);
  }
  return result;
};

/**
 * GET /api/v1/public/establishments
 *
 * Public catalog listing. No coordinates accepted — uses searchWithoutLocation
 * internally. Query params (all optional):
 *   city, category, cuisines[], priceRange[], minRating,
 *   hours_filter (until_22 | until_morning | 24_hours — unknown soft-ignored),
 *   search, sort_by, limit (default 20, max 100), page (default 1)
 */
export const listPublicEstablishments = asyncHandler(async (req, res) => {
  const {
    city: citySlug,
    category: categorySlug,
    cuisines: cuisinesRaw,
    priceRange: priceRangeRaw,
    minRating: minRatingRaw,
    hours_filter: hoursFilterRaw,
    search,
    sort_by: sortBy,
    limit: limitRaw,
    page: pageRaw,
  } = req.query;

  // Slug validation + Cyrillic translation
  let cityCyrillic = null;
  if (citySlug) {
    cityCyrillic = citySlugToCyrillic(citySlug);
    if (!cityCyrillic) {
      throw new AppError(`Invalid city slug: "${citySlug}"`, 400, 'INVALID_SLUG');
    }
  }

  const categories = categorySlug
    ? translateSlugList([categorySlug], categorySlugToCyrillic, 'category')
    : null;

  const cuisines = translateSlugList(
    parseListParam(cuisinesRaw),
    cuisineSlugToCyrillic,
    'cuisine',
  );

  // Numeric params
  const priceRange = parseListParam(priceRangeRaw);

  // hours_filter: accept known buckets, soft-ignore unknown. Unlike /map
  // (which 422s on a bad value), the indexable catalog LIST surface treats an
  // unknown bucket as "no filter" — a malformed facet URL must still render the
  // unfiltered catalog rather than error. Single-valued (one bucket).
  const VALID_HOURS_FILTERS = ['until_22', 'until_morning', '24_hours'];
  const hoursFilter = VALID_HOURS_FILTERS.includes(hoursFilterRaw)
    ? hoursFilterRaw
    : undefined;

  const minRating = minRatingRaw ? parseFloat(minRatingRaw) : null;
  if (minRating !== null && (isNaN(minRating) || minRating < 1 || minRating > 5)) {
    throw new AppError('minRating must be between 1 and 5', 422, 'VALIDATION_ERROR');
  }

  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 100);
  const page = Math.max(parseInt(pageRaw, 10) || 1, 1);

  const result = await publicService.getPublicEstablishmentsCatalog({
    city: cityCyrillic,
    categories,
    cuisines,
    priceRange,
    minRating,
    hoursFilter,
    sortBy,
    search: search ? String(search).trim() : null,
    limit,
    page,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/v1/public/establishments/map
 *
 * Map view of public establishments — minimum marker projection. Brief 1
 * does not accept geographic bounds; entire filter-scope set is returned
 * up to limit (default 200, max 500). Bounds support deferred to Brief 3+.
 */
export const mapPublicEstablishments = asyncHandler(async (req, res) => {
  const {
    city: citySlug,
    category: categorySlug,
    cuisines: cuisinesRaw,
    priceRange: priceRangeRaw,
    minRating: minRatingRaw,
    hours_filter: hoursFilter,
    search,
    limit: limitRaw,
  } = req.query;

  let cityCyrillic = null;
  if (citySlug) {
    cityCyrillic = citySlugToCyrillic(citySlug);
    if (!cityCyrillic) {
      throw new AppError(`Invalid city slug: "${citySlug}"`, 400, 'INVALID_SLUG');
    }
  }

  const categories = categorySlug
    ? translateSlugList([categorySlug], categorySlugToCyrillic, 'category')
    : null;

  const cuisines = translateSlugList(
    parseListParam(cuisinesRaw),
    cuisineSlugToCyrillic,
    'cuisine',
  );

  const priceRange = parseListParam(priceRangeRaw);

  const minRating = minRatingRaw ? parseFloat(minRatingRaw) : null;
  if (minRating !== null && (isNaN(minRating) || minRating < 1 || minRating > 5)) {
    throw new AppError('minRating must be between 1 and 5', 422, 'VALIDATION_ERROR');
  }

  // Validate hours_filter
  if (hoursFilter !== undefined) {
    const valid = ['until_22', 'until_morning', '24_hours'];
    if (!valid.includes(hoursFilter)) {
      throw new AppError(
        `Invalid hours_filter. Must be one of: ${valid.join(', ')}`,
        422,
        'VALIDATION_ERROR',
      );
    }
  }

  const limit = parseInt(limitRaw, 10) || 200;

  const result = await publicService.getPublicEstablishmentsMap({
    city: cityCyrillic,
    categories,
    cuisines,
    priceRange,
    minRating,
    hoursFilter,
    search: search ? String(search).trim() : null,
    limit,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/v1/public/establishments/by-slug/:slug
 *
 * Single establishment by slug. Strict status='active'; 404 otherwise.
 */
export const getPublicEstablishmentBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    throw new AppError('Slug is required', 400, 'VALIDATION_ERROR');
  }

  const establishment = await publicService.getPublicEstablishmentBySlug(slug);

  res.status(200).json({
    success: true,
    data: { establishment },
  });
});

/**
 * GET /api/v1/public/establishments/by-id/:id
 *
 * @deprecated — prefer by-slug for new web scenarios; retained for completeness.
 * Same response shape and strict status='active' filter as by-slug.
 */
export const getPublicEstablishmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new AppError('ID is required', 400, 'VALIDATION_ERROR');
  }

  const establishment = await publicService.getPublicEstablishmentById(id);

  res.status(200).json({
    success: true,
    data: { establishment },
  });
});

/**
 * GET /api/v1/public/establishments/by-slug/:slug/menu-items
 *
 * Menu items for an establishment by slug. Returns empty array if no
 * menu parsed yet; 404 if establishment not found OR not active.
 */
export const getPublicMenuItems = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    throw new AppError('Slug is required', 400, 'VALIDATION_ERROR');
  }

  const result = await publicService.getPublicMenuItems(slug);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/v1/public/establishments/by-slug/:slug/reviews
 *
 * Paginated public reviews for an establishment by slug.
 * Query params: page (default 1), limit (default 10, max 50).
 */
export const getPublicReviews = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page: pageRaw, limit: limitRaw } = req.query;

  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    throw new AppError('Slug is required', 400, 'VALIDATION_ERROR');
  }

  const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 10, 1), 50);

  const result = await publicService.getPublicReviews(slug, { page, limit });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/v1/public/metadata
 *
 * Cities, categories, cuisines as { slug, name } pairs. Pure data from
 * constants — strong cache candidate (CDN/Vercel may cache indefinitely).
 */
export const getPublicMetadata = asyncHandler(async (req, res) => {
  const metadata = publicService.getPublicMetadata();

  res.status(200).json({
    success: true,
    data: metadata,
  });
});
