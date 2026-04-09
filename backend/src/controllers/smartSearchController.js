/**
 * Smart Search Controller
 *
 * Handles POST /api/v1/search/smart requests.
 * Validates input, delegates to smartSearchService, returns results.
 */

import * as smartSearchService from '../services/smartSearchService.js';
import logger from '../utils/logger.js';

/** Maximum query length */
const MAX_QUERY_LENGTH = 150;

/**
 * Sanitize user query: trim, collapse whitespace, remove control characters.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeQuery(raw) {
  return raw
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // remove control chars
    .replace(/\s+/g, ' ')             // collapse whitespace
    .slice(0, MAX_QUERY_LENGTH);
}

/**
 * POST /api/v1/search/smart
 *
 * Body: { query: string, latitude?: number, longitude?: number, city?: string, limit?: number, page?: number }
 */
export async function smartSearch(req, res, next) {
  try {
    const { query, latitude, longitude, city, limit, page } = req.body;

    // --- Validation ---
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'query is required and must be a non-empty string',
        },
      });
    }

    const sanitized = sanitizeQuery(query);

    if (sanitized.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'query is empty after sanitization',
        },
      });
    }

    // Validate optional coordinates
    const lat = latitude != null ? parseFloat(latitude) : undefined;
    const lon = longitude != null ? parseFloat(longitude) : undefined;

    if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'latitude must be between -90 and 90',
        },
      });
    }

    if (lon !== undefined && (isNaN(lon) || lon < -180 || lon > 180)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'longitude must be between -180 and 180',
        },
      });
    }

    // Validate pagination
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);

    // --- Execute ---
    const context = {};
    if (lat !== undefined && lon !== undefined) {
      context.latitude = lat;
      context.longitude = lon;
    }
    if (city && typeof city === 'string') {
      context.city = city.trim();
    }

    const result = await smartSearchService.executeSmartSearch(
      sanitized,
      context,
      { limit: parsedLimit, page: parsedPage },
    );

    return res.status(200).json({
      success: true,
      data: {
        intent: result.intent,
        establishments: result.results,
        pagination: result.pagination,
        fallback: result.fallback,
      },
    });
  } catch (error) {
    logger.error('Smart search controller error', {
      error: error.message,
      body: req.body,
    });
    next(error);
  }
}
