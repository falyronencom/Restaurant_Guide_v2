/**
 * Search Routes
 *
 * Defines routes for establishment search and discovery.
 */

import express from 'express';
import * as searchController from '../../controllers/searchController.js';
import * as smartSearchController from '../../controllers/smartSearchController.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';

const router = express.Router();

/**
 * Smart search rate limiter: 120 requests a minute per person — a signed-in
 * user by account (a genuine token is enough, the route has no authenticate),
 * a visitor of the site by the address the site vouched for, anyone else by
 * address (rateLimiter.js requesterOf).
 *
 * The money is not held here any more: a request is a cache read and SQL, and
 * the model's calls are capped by services/smartSearchBudget.js — an hour's
 * and a day's calls for all, and new phrases an hour per person (SDL
 * CAT-C-2.2, amendment 07.09.2026). Until 25.10.2026 this was 30 a minute per
 * address, the only brake on the model. 429 stays as a guard against a flood:
 * every request still reads all the active names for the name match.
 */
export const SMART_SEARCH_REQUESTS_PER_MINUTE = 120;

const smartSearchLimiter = createRateLimiter({
  limit: SMART_SEARCH_REQUESTS_PER_MINUTE,
  windowSeconds: 60,
  keyPrefix: 'smart_search',
  byToken: true,
});

/**
 * GET /api/v1/search/health
 *
 * Health check for search system (PostGIS availability)
 * Public endpoint - no authentication required
 */
router.get('/health', searchController.searchHealth);

/**
 * GET /api/v1/search/establishments
 *
 * Search establishments by radius (list view)
 * Public endpoint - no authentication required
 *
 * Query Parameters:
 * - latitude (required): Center point latitude
 * - longitude (required): Center point longitude
 * - radius (optional): Search radius in km (default: 10, max: 1000)
 * - categories (optional): Comma-separated categories filter
 * - cuisines (optional): Comma-separated cuisines filter
 * - priceRange (optional): Price range filter ($, $$, $$$, $$$$)
 * - minRating (optional): Minimum average rating (1-5)
 * - limit (optional): Results per page (default: 20, max: 100)
 * - offset (optional): Pagination offset (default: 0)
 *
 * Response includes:
 * - establishments: Array of establishment objects with distance
 * - pagination: Total count and pagination metadata
 *
 * Results are ordered by distance (closest first), then by rating
 */
router.get('/establishments', searchController.searchEstablishments);

/**
 * GET /api/v1/search/establishments/:id
 *
 * Get establishment details by ID
 * Public endpoint - no authentication required
 *
 * Path Parameters:
 * - id (required): Establishment UUID
 *
 * Response includes:
 * - Complete establishment object with all details
 *
 * Note: Only active establishments are returned
 */
router.get('/establishments/:id', searchController.getEstablishmentById);

/**
 * GET /api/v1/search/map
 *
 * Search establishments within geographic bounds (map view)
 * Public endpoint - no authentication required
 *
 * Query Parameters:
 * - minLat (required): Southwest corner latitude
 * - maxLat (required): Northeast corner latitude
 * - minLon (required): Southwest corner longitude
 * - maxLon (required): Northeast corner longitude
 * - categories (optional): Comma-separated categories filter
 * - cuisines (optional): Comma-separated cuisines filter
 * - priceRange (optional): Price range filter ($, $$, $$$, $$$$)
 * - minRating (optional): Minimum average rating (1-5)
 * - limit (optional): Max results (default: 100, max: 500)
 *
 * Response includes:
 * - establishments: Array of establishment objects within bounds
 * - total: Total count of results
 *
 * Results are ordered by rating (highest first), then by review count
 */
router.get('/map', searchController.searchMap);

/**
 * POST /api/v1/search/smart
 *
 * AI-powered smart search with natural language intent parsing.
 * Public endpoint - no authentication required.
 *
 * Body Parameters:
 * - query (required): Natural language search string (max 150 chars)
 * - latitude (optional): User latitude for distance-based search
 * - longitude (optional): User longitude for distance-based search
 * - city (optional): City filter
 * - limit (optional): Results per page (default: 20, max: 100)
 * - page (optional): Page number (default: 1)
 *
 * Screen filters - same names the classic GET reads from the query string,
 * parsed by the same utils/searchFilterParams.js (array or csv where a list):
 * - categories, cuisines, priceRange, features
 * - minRating / min_rating (1-5)
 * - max_distance (metres), radius (km)
 * - sort_by (rating | price_asc | price_desc | distance)
 * - hours_filter (until_22 | until_morning | 24_hours)
 * Filter errors answer 422 (as on the classic endpoint); body errors
 * (query, coordinates) answer 400.
 *
 * Response includes:
 * - intent: Parsed AI intent (categories, cuisines, tags, etc.) or null
 * - establishments: Array of matching establishments
 * - pagination: Pagination metadata
 * - fallback: Boolean indicating if ILIKE fallback was used
 */
router.post('/smart', smartSearchLimiter, smartSearchController.smartSearch);

export default router;
