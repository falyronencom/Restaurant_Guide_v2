/**
 * Search Service
 *
 * Handles geospatial search and discovery using PostGIS.
 * Implements radius-based and bounds-based search with filtering.
 */

import pool from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import * as MediaModel from '../models/mediaModel.js';

/**
 * Search establishments by radius
 *
 * @param {Object} params - Search parameters
 * @param {number} params.latitude - Center latitude
 * @param {number} params.longitude - Center longitude
 * @param {number} params.radius - Search radius in kilometers (default: 10)
 * @param {string} params.city - Filter by city name (e.g., 'Минск', 'Гродно')
 * @param {string[]} params.categories - Filter by categories
 * @param {string[]} params.cuisines - Filter by cuisines
 * @param {string} params.priceRange - Filter by price range ($, $$, $$$, $$$$)
 * @param {number} params.minRating - Minimum average rating (1-5)
 * @param {number} params.limit - Results per page (default: 20, max: 100)
 * @param {number} params.offset - Pagination offset (default: 0)
 * @returns {Promise<Object>} Search results with establishments and pagination
 */
export async function searchByRadius({
  latitude,
  longitude,
  radius = 10,
  city = null,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 20,
  offset = 0,
  page = 1,
}) {
  // Validate coordinates (use strict null check to allow 0 values)
  if (latitude == null || longitude == null) {
    throw new AppError('Latitude and longitude are required', 422, 'VALIDATION_ERROR');
  }

  if (latitude < -90 || latitude > 90) {
    throw new AppError('Latitude must be between -90 and 90', 422, 'VALIDATION_ERROR');
  }

  if (longitude < -180 || longitude > 180) {
    throw new AppError('Longitude must be between -180 and 180', 422, 'VALIDATION_ERROR');
  }

  // Validate radius
  if (radius <= 0 || radius > 1000) {
    throw new AppError('Radius must be between 0 and 1000 km', 422, 'VALIDATION_ERROR');
  }

  // Validate pagination
  if (limit < 1 || limit > 100) {
    throw new AppError('Limit must be between 1 and 100', 422, 'VALIDATION_ERROR');
  }

  if (offset < 0) {
    throw new AppError('Offset must be non-negative', 422, 'VALIDATION_ERROR');
  }

  // Build dynamic query
  const conditions = ['e.status = $1'];
  const params = ['active']; // Only search active establishments
  let paramIndex = 2;

  // Add city filter
  if (city) {
    conditions.push(`e.city = $${paramIndex}`);
    params.push(city);
    paramIndex++;
  }

  // Add category filter
  if (categories && categories.length > 0) {
    conditions.push(`e.categories && $${paramIndex}::varchar[]`);
    params.push(categories);
    paramIndex++;
  }

  // Add cuisine filter
  if (cuisines && cuisines.length > 0) {
    conditions.push(`e.cuisines && $${paramIndex}::varchar[]`);
    params.push(cuisines);
    paramIndex++;
  }

  // Add price range filter
  if (priceRange) {
    conditions.push(`e.price_range = $${paramIndex}`);
    params.push(priceRange);
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // If city is specified, don't filter by radius - just calculate distance for sorting
  // If no city, filter by radius from coordinates
  const useRadiusFilter = !city;

  // Main query with PostGIS distance calculation
  let query;
  let countQuery;

  if (useRadiusFilter) {
    // Original behavior: filter by radius
    query = `
      WITH nearby_establishments AS (
        SELECT
          e.*,
          ST_Distance(
            ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
            ST_MakePoint(e.longitude, e.latitude)::geography
          ) / 1000.0 AS distance_km
        FROM establishments e
        WHERE ${whereClause}
      )
      SELECT
        ne.*,
        u.name AS partner_name,
        u.email AS partner_email
      FROM nearby_establishments ne
      LEFT JOIN users u ON ne.partner_id = u.id
      WHERE ne.distance_km <= $${paramIndex + 2}
      ORDER BY ne.distance_km ASC, ne.average_rating DESC, ne.review_count DESC
      LIMIT $${paramIndex + 3}
      OFFSET $${paramIndex + 4}
    `;
    params.push(longitude, latitude, radius, limit, offset);

    countQuery = `
      SELECT COUNT(*) as total
      FROM establishments e
      WHERE ${whereClause}
        AND ST_Distance(
          ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
          ST_MakePoint(e.longitude, e.latitude)::geography
        ) / 1000.0 <= $${paramIndex + 2}
    `;
  } else {
    // City specified: don't filter by radius, just sort by distance
    query = `
      SELECT
        e.*,
        ST_Distance(
          ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
          ST_MakePoint(e.longitude, e.latitude)::geography
        ) / 1000.0 AS distance_km,
        u.name AS partner_name,
        u.email AS partner_email
      FROM establishments e
      LEFT JOIN users u ON e.partner_id = u.id
      WHERE ${whereClause}
      ORDER BY e.average_rating DESC NULLS LAST, e.review_count DESC, e.name ASC
      LIMIT $${paramIndex + 2}
      OFFSET $${paramIndex + 3}
    `;
    params.push(longitude, latitude, limit, offset);

    countQuery = `
      SELECT COUNT(*) as total
      FROM establishments e
      WHERE ${whereClause}
    `;
  }

  const result = await pool.query(query, params);

  // Count total results for pagination
  const countParams = useRadiusFilter ? params.slice(0, -2) : params.slice(0, -4);
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  // Calculate page-based pagination metadata
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  // Transform results with type conversions and distance field
  const establishments = result.rows.map(row => ({
    ...row,
    distance: row.distance_km, // Add 'distance' field that tests expect
    distance_km: parseFloat(row.distance_km),
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    average_rating: row.average_rating ? parseFloat(row.average_rating) : null,
    review_count: parseInt(row.review_count) || 0,
  }));

  return {
    establishments,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext,
      hasPrevious,
    },
  };
}

/**
 * Search establishments without location (no distance calculation)
 * Used when user doesn't provide coordinates
 *
 * @param {Object} params - Search parameters
 * @param {string} params.city - Filter by city name (e.g., 'Минск', 'Гродно')
 * @param {string[]} params.categories - Filter by categories
 * @param {string[]} params.cuisines - Filter by cuisines
 * @param {string} params.priceRange - Filter by price range
 * @param {number} params.minRating - Minimum average rating
 * @param {number} params.limit - Results per page (default: 20, max: 100)
 * @param {number} params.offset - Pagination offset (default: 0)
 * @param {number} params.page - Page number for pagination metadata
 * @returns {Promise<Object>} Search results sorted by rating
 */
export async function searchWithoutLocation({
  city = null,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 20,
  offset = 0,
  page = 1,
}) {
  // Validate pagination
  if (limit < 1 || limit > 100) {
    throw new AppError('Limit must be between 1 and 100', 422, 'VALIDATION_ERROR');
  }

  if (offset < 0) {
    throw new AppError('Offset must be non-negative', 422, 'VALIDATION_ERROR');
  }

  // Build dynamic query
  const conditions = ['e.status = $1'];
  const params = ['active'];
  let paramIndex = 2;

  // Add city filter
  if (city) {
    conditions.push(`e.city = $${paramIndex}`);
    params.push(city);
    paramIndex++;
  }

  // Add category filter
  if (categories && categories.length > 0) {
    conditions.push(`e.categories && $${paramIndex}::varchar[]`);
    params.push(categories);
    paramIndex++;
  }

  // Add cuisine filter
  if (cuisines && cuisines.length > 0) {
    conditions.push(`e.cuisines && $${paramIndex}::varchar[]`);
    params.push(cuisines);
    paramIndex++;
  }

  // Add price range filter
  if (priceRange) {
    conditions.push(`e.price_range = $${paramIndex}`);
    params.push(priceRange);
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Main query - sorted by rating (no distance)
  const query = `
    SELECT
      e.*,
      u.name AS partner_name,
      u.email AS partner_email
    FROM establishments e
    LEFT JOIN users u ON e.partner_id = u.id
    WHERE ${whereClause}
    ORDER BY e.average_rating DESC NULLS LAST, e.review_count DESC, e.name ASC
    LIMIT $${paramIndex}
    OFFSET $${paramIndex + 1}
  `;

  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Count total results for pagination
  const countQuery = `
    SELECT COUNT(*) as total
    FROM establishments e
    WHERE ${whereClause}
  `;

  const countParams = params.slice(0, -2); // Remove limit and offset
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  // Calculate page-based pagination metadata
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  // Transform results (no distance field)
  const establishments = result.rows.map(row => ({
    ...row,
    distance: null, // No distance without coordinates
    distance_km: null,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    average_rating: row.average_rating ? parseFloat(row.average_rating) : null,
    review_count: parseInt(row.review_count) || 0,
  }));

  return {
    establishments,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext,
      hasPrevious,
    },
  };
}

/**
 * Search establishments within geographic bounds (for map view)
 *
 * @param {Object} params - Search parameters
 * @param {number} params.minLat - Minimum latitude (southwest corner)
 * @param {number} params.maxLat - Maximum latitude (northeast corner)
 * @param {number} params.minLon - Minimum longitude (southwest corner)
 * @param {number} params.maxLon - Maximum longitude (northeast corner)
 * @param {string[]} params.categories - Filter by categories
 * @param {string[]} params.cuisines - Filter by cuisines
 * @param {string} params.priceRange - Filter by price range
 * @param {number} params.minRating - Minimum average rating
 * @param {number} params.limit - Results limit (default: 100, max: 500 for map)
 * @returns {Promise<Object>} Establishments within bounds
 */
export async function searchByBounds({
  minLat,
  maxLat,
  minLon,
  maxLon,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 100,
}) {
  // Validate bounds (use strict null check to allow 0 values)
  if (minLat == null || maxLat == null || minLon == null || maxLon == null) {
    throw new AppError('All bounds parameters are required (minLat, maxLat, minLon, maxLon)', 422, 'VALIDATION_ERROR');
  }

  if (minLat >= maxLat) {
    throw new AppError('minLat must be less than maxLat', 422, 'VALIDATION_ERROR');
  }

  if (minLon >= maxLon) {
    throw new AppError('minLon must be less than maxLon', 422, 'VALIDATION_ERROR');
  }

  // Validate limit
  if (limit < 1 || limit > 500) {
    throw new AppError('Limit must be between 1 and 500 for bounds search', 422, 'VALIDATION_ERROR');
  }

  // Build dynamic query
  const conditions = ['e.status = $1'];
  const params = ['active'];
  let paramIndex = 2;

  // Add geographic bounds filter
  conditions.push(`e.latitude BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
  conditions.push(`e.longitude BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}`);
  params.push(minLat, maxLat, minLon, maxLon);
  paramIndex += 4;

  // Add category filter
  if (categories && categories.length > 0) {
    conditions.push(`e.categories && $${paramIndex}::varchar[]`);
    params.push(categories);
    paramIndex++;
  }

  // Add cuisine filter
  if (cuisines && cuisines.length > 0) {
    conditions.push(`e.cuisines && $${paramIndex}::varchar[]`);
    params.push(cuisines);
    paramIndex++;
  }

  // Add price range filter
  if (priceRange) {
    conditions.push(`e.price_range = $${paramIndex}`);
    params.push(priceRange);
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const query = `
    SELECT
      e.*,
      u.name AS partner_name,
      u.email AS partner_email
    FROM establishments e
    LEFT JOIN users u ON e.partner_id = u.id
    WHERE ${whereClause}
    ORDER BY e.average_rating DESC, e.review_count DESC
    LIMIT $${paramIndex}
  `;

  params.push(limit);

  const result = await pool.query(query, params);

  // Convert latitude/longitude from strings to numbers for JSON serialization
  const establishments = result.rows.map(row => ({
    ...row,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
  }));

  return {
    establishments,
    total: establishments.length,
  };
}

/**
 * Get establishment by ID (public endpoint)
 *
 * @param {string} id - Establishment UUID
 * @returns {Promise<Object>} Establishment details
 */
export async function getEstablishmentById(id) {
  if (!id) {
    throw new AppError('Establishment ID is required', 422, 'VALIDATION_ERROR');
  }

  const query = `
    SELECT
      e.*,
      u.name AS partner_name,
      u.email AS partner_email
    FROM establishments e
    LEFT JOIN users u ON e.partner_id = u.id
    WHERE e.id = $1 AND e.status = 'active'
  `;

  const result = await pool.query(query, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Establishment not found', 404, 'NOT_FOUND');
  }

  const row = result.rows[0];

  // Load media from establishment_media table
  const media = await MediaModel.getEstablishmentMedia(id);

  return {
    ...row,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    average_rating: row.average_rating ? parseFloat(row.average_rating) : null,
    review_count: parseInt(row.review_count) || 0,
    media, // Include all photos (interior, menu, etc.)
  };
}

/**
 * Health check for search system
 *
 * @returns {Promise<Object>} Health status
 */
export async function checkSearchHealth() {
  try {
    // Test PostGIS is available
    const result = await pool.query(`
      SELECT PostGIS_version() as version
    `);

    return {
      healthy: true,
      postgis: result.rows[0].version,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

export default {
  searchByRadius,
  searchByBounds,
  searchWithoutLocation,
  getEstablishmentById,
  checkSearchHealth,
};
