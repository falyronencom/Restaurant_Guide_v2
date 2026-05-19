/**
 * Public Routes
 *
 * Defines the public read-only API surface (Brief 1) under /api/v1/public/*.
 *
 * All endpoints are fully public:
 *   - No `authenticate` middleware
 *   - No `optionalAuth` middleware
 *   - Inherit the global unauthenticated rate limit (300/hr per IP)
 *     applied at app level in server.js
 *
 * Route ordering matters: /map and /metadata MUST be defined BEFORE the
 * parameterised /:slug routes to prevent 'map' or 'metadata' from being
 * matched as a slug. Express matches routes top-to-bottom; the first
 * match wins. The same principle applies to /by-slug/:slug/* sub-routes —
 * Express handles those naturally because they include explicit segments.
 */

import express from 'express';
import * as publicController from '../../controllers/publicController.js';

const router = express.Router();

/**
 * GET /api/v1/public/metadata
 *
 * Cities, categories, cuisines as { slug, name } pairs from constants.
 * Pure data, no DB query. Strong CDN cache candidate.
 *
 * Mounted BEFORE /establishments/* routes so a future change that mounts
 * metadata under /establishments cannot accidentally collide with a slug.
 */
router.get('/metadata', publicController.getPublicMetadata);

/**
 * GET /api/v1/public/establishments/map
 *
 * Map view — minimum marker projection. No bounds support in Brief 1
 * (deferred to Brief 3+).
 *
 * Query params: city, category, cuisines[], priceRange[], minRating,
 * hours_filter, search, limit (default 200, max 500).
 *
 * MUST be defined before /:slug-style routes to avoid 'map' matching as a slug.
 */
router.get('/establishments/map', publicController.mapPublicEstablishments);

/**
 * GET /api/v1/public/establishments
 *
 * Public catalog listing — full listing projection. No coordinates.
 *
 * Query params: city, category, cuisines[], priceRange[], minRating,
 * search, sort_by, limit (default 20, max 100), page (default 1).
 */
router.get('/establishments', publicController.listPublicEstablishments);

/**
 * GET /api/v1/public/establishments/by-slug/:slug/menu-items
 *
 * Menu items for the establishment identified by slug. Filters out
 * is_hidden_by_admin=TRUE items at the model layer.
 */
router.get(
  '/establishments/by-slug/:slug/menu-items',
  publicController.getPublicMenuItems,
);

/**
 * GET /api/v1/public/establishments/by-slug/:slug/reviews
 *
 * Paginated reviews for the establishment identified by slug. Reuses
 * reviewService (which already filters is_visible + is_deleted) and
 * normalises pagination to `totalPages`.
 *
 * Query params: page (default 1), limit (default 10, max 50).
 */
router.get(
  '/establishments/by-slug/:slug/reviews',
  publicController.getPublicReviews,
);

/**
 * GET /api/v1/public/establishments/by-slug/:slug
 *
 * Single establishment by slug. Strict status='active'; 404 otherwise.
 * Side effect: increments view_count (preserves legacy /search/:id behaviour).
 *
 * NOTE: must come AFTER the more-specific by-slug/:slug/{menu-items,reviews}
 * routes above. Express matches top-down — generic by-slug last.
 */
router.get(
  '/establishments/by-slug/:slug',
  publicController.getPublicEstablishmentBySlug,
);

/**
 * GET /api/v1/public/establishments/by-id/:id
 *
 * @deprecated — prefer by-slug for new web scenarios. Retained for
 * completeness so older integrations / scripts that have the UUID
 * can still resolve via public surface.
 */
router.get(
  '/establishments/by-id/:id',
  publicController.getPublicEstablishmentById,
);

export default router;
