/**
 * Favorite Routes
 * 
 * This module defines all favorites-related API endpoints, composing controllers,
 * validation middleware, and authentication middleware into complete request
 * handling pipelines.
 * 
 * Architecture note: Routes are declarative specifications of how requests flow
 * through middleware chains. They should be readable as documentation of the API
 * surface without containing any logic themselves. Each route explicitly shows
 * all middleware applied in order, making the request flow transparent.
 * 
 * Middleware execution order is critical:
 * 1. Rate limiting (if applicable) - Prevent abuse before authentication
 * 2. Authentication - Verify JWT token and populate req.user
 * 3. Validation - Check request format and constraints
 * 4. Error formatting - Convert validation errors to API responses
 * 5. Controller - Handle business logic and return response
 * 
 * This order ensures efficient request processing: we reject unauthenticated
 * or invalid requests early without wasting resources on business logic.
 */

import express from 'express';
import * as FavoriteController from '../../controllers/favoriteController.js';
import * as FavoriteValidation from '../../validators/favoriteValidation.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/errorHandler.js';

const router = express.Router();

/**
 * POST /api/v1/favorites
 * 
 * Add an establishment to user's favorites collection.
 * 
 * This is a protected endpoint requiring authentication because favorites are
 * user-specific personal data. The user ID comes from the JWT token, not from
 * the request body, ensuring users can only add to their own favorites.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishmentId is present and valid UUID format
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Execute business logic to create favorite
 * 
 * The operation is idempotent - adding the same establishment multiple times
 * produces the same result without errors. This provides better UX for scenarios
 * like double-clicks or network retries.
 * 
 * Request body (the field is camelCase — validators/favoriteValidation.js):
 * {
 *   "establishmentId": "uuid-of-establishment"
 * }
 * 
 * Success response (201 Created):
 * {
 *   "success": true,
 *   "data": {
 *     "favorite": {
 *       "id": "favorite-uuid",
 *       "user_id": "user-uuid",
 *       "establishment_id": "establishment-uuid",
 *       "created_at": "2025-10-20T10:30:00Z"
 *     },
 *     "message": "Establishment added to favorites"
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 404 Not Found: Establishment doesn't exist or is inactive
 * - 422 Unprocessable Entity: Invalid establishmentId format
 */
router.post(
  '/',
  authenticate,
  FavoriteValidation.validateAddFavorite,
  validate,
  FavoriteController.addFavorite,
);

/**
 * DELETE /api/v1/favorites/:establishmentId
 * 
 * Remove an establishment from user's favorites collection.
 * 
 * This is a protected endpoint requiring authentication. Users can only remove
 * from their own favorites collection, enforced through JWT token context.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishmentId path parameter is valid UUID format
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Execute business logic to delete favorite
 * 
 * The operation is idempotent - removing a non-existent favorite succeeds
 * without error because the desired end state is achieved. If the favorite
 * doesn't exist, it still doesn't exist after the operation.
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "message": "Establishment removed from favorites"
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 422 Unprocessable Entity: Invalid establishmentId format
 */
router.delete(
  '/:establishmentId',
  authenticate,
  FavoriteValidation.validateRemoveFavorite,
  validate,
  FavoriteController.removeFavorite,
);

/**
 * GET /api/v1/favorites
 * 
 * Get all favorites for the authenticated user with pagination.
 * 
 * This is a protected endpoint requiring authentication. Users can only view
 * their own favorites - the user ID comes from JWT token, not URL parameters,
 * preventing access to others' favorites.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check pagination parameters (page, limit) are valid
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Fetch favorites with establishment details and pagination
 * 
 * Query parameters (all optional):
 * - page: Page number (default: 1, must be positive integer)
 * - limit: Results per page (default: 10, max: 50)
 * 
 * Success response (200 OK) — the establishment's fields are flat, with the
 * establishment_ prefix, not a nested object (services/favoriteService.js,
 * getUserFavorites):
 * {
 *   "success": true,
 *   "data": {
 *     "favorites": [
 *       {
 *         "id": "favorite-uuid",
 *         "user_id": "user-uuid",
 *         "establishment_id": "establishment-uuid",
 *         "created_at": "2025-10-20T10:30:00Z",
 *         "establishment_slug": "restaurant-name",
 *         "establishment_city_slug": "minsk",
 *         "establishment_category_slug": "restoran",
 *         "establishment_name": "Restaurant Name",
 *         "establishment_description": "Description...",
 *         "establishment_city": "Минск",
 *         "establishment_address": "Address...",
 *         "establishment_latitude": 53.9,
 *         "establishment_longitude": 27.5,
 *         "establishment_categories": ["Ресторан"],
 *         "establishment_cuisines": ["Европейская"],
 *         "establishment_price_range": "$$",
 *         "establishment_average_rating": 4.5,
 *         "establishment_review_count": 120,
 *         "establishment_status": "active",
 *         "establishment_working_hours": { },
 *         "establishment_primary_image": "https://..."
 *       }
 *     ],
 *     "pagination": {
 *       "page": 1,
 *       "limit": 10,
 *       "total": 25,
 *       "pages": 3,
 *       "hasNext": true,
 *       "hasPrevious": false
 *     }
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 422 Unprocessable Entity: Invalid pagination parameters (page from 1,
 *   limit 1–50)
 */
router.get(
  '/',
  authenticate,
  FavoriteValidation.validateGetFavorites,
  validate,
  FavoriteController.getUserFavorites,
);

/**
 * GET /api/v1/favorites/check/:establishmentId
 * 
 * Check if a specific establishment is in user's favorites.
 * 
 * This is a protected endpoint requiring authentication because favorite status
 * is user-specific. Different users will have different favorite collections.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishmentId path parameter is valid UUID format
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Check favorite status for the establishment
 * 
 * This is a lightweight read operation that's very fast due to database indexing.
 * It's safe to call frequently for UI state updates.
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "establishment_id": "establishment-uuid",
 *     "is_favorite": true
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 422 Unprocessable Entity: Invalid establishmentId format
 */
router.get(
  '/check/:establishmentId',
  authenticate,
  FavoriteValidation.validateCheckFavorite,
  validate,
  FavoriteController.checkFavoriteStatus,
);

/**
 * POST /api/v1/favorites/check-batch
 * 
 * Batch check favorite status for multiple establishments.
 * 
 * This is a protected endpoint for efficiently checking favorite status across
 * multiple establishments in a single request. It's designed for use cases like
 * search results where the frontend needs to show favorite status for 10-20
 * establishments at once.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishment_ids is array with 1-50 valid UUIDs
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Check favorite status for all establishments
 * 
 * Request body:
 * {
 *   "establishment_ids": [
 *     "uuid-1",
 *     "uuid-2",
 *     "uuid-3"
 *   ]
 * }
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "favorites": {
 *       "uuid-1": true,
 *       "uuid-2": false,
 *       "uuid-3": true
 *     }
 *   }
 * }
 * 
 * The response format is an object mapping establishment IDs to boolean values,
 * allowing easy lookup by the frontend without array searching.
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 422 Unprocessable Entity: Not an array of 1–50 items, or an invalid UUID
 *   in it
 */
router.post(
  '/check-batch',
  authenticate,
  FavoriteValidation.validateCheckBatchFavorites,
  validate,
  FavoriteController.checkBatchFavoriteStatus,
);

/**
 * GET /api/v1/favorites/stats
 * 
 * Get statistics about user's favorites collection.
 * 
 * This is a protected endpoint that returns aggregate statistics about the
 * authenticated user's favorites. Currently returns basic count information,
 * but could be expanded to include breakdowns by city, category, average
 * ratings, etc.
 * 
 * OPTIONAL FEATURE: This endpoint is included for completeness but may not be
 * necessary for MVP. The basic functionality of add/remove/list favorites is
 * sufficient. This endpoint can be deferred if implementation timeline is tight.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Controller: Calculate and return statistics
 * 
 * No validation needed because this endpoint takes no parameters - everything
 * comes from the authenticated user context.
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "total_favorites": 25
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 */
router.get(
  '/stats',
  authenticate,
  FavoriteController.getFavoritesStats,
);

/**
 * Route ordering
 * 
 * The order of the definitions above does not matter today: no two routes of
 * one HTTP method can match the same path. The only route with a bare
 * parameter is DELETE /:establishmentId, and it is the only DELETE; GET has
 * `/`, `/check/:establishmentId` and `/stats`, POST has `/` and `/check-batch`.
 * 
 * It will matter once a route like GET /:id is added: Express matches from top
 * to bottom, so the routes with a fixed first segment (`check`, `stats`) must
 * be defined before it, or `check` would be read as an id.
 */

/**
 * Future route additions
 * 
 * As the Favorites system evolves, these additional routes might be added:
 * 
 * GET /api/v1/favorites/by-city/:city
 * - Get favorites filtered by city for travel planning
 * 
 * GET /api/v1/favorites/by-category/:category
 * - Get favorites filtered by establishment category
 * 
 * POST /api/v1/favorites/reorder
 * - Allow users to manually order their favorites
 * 
 * POST /api/v1/favorites/:id/note
 * - Add personal notes to favorites (why saved, what to try)
 * 
 * These enhancements are explicitly deferred to post-MVP per the directive.
 * The current route set provides complete core functionality for bookmarking
 * establishments.
 */

export default router;

