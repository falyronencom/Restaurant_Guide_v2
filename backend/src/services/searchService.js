/**
 * Search Service
 *
 * Handles geospatial search and discovery using PostGIS.
 * Implements radius-based and bounds-based search with filtering.
 */

import pool from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import * as MediaModel from '../models/mediaModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';

/**
 * Synonym map: common search terms → related categories and cuisines.
 * Enables "пицца" → find "Пиццерия" category + "Итальянская" cuisine, etc.
 * Keys are lowercase for case-insensitive matching.
 */
const SEARCH_SYNONYMS = {
  // Food → category + cuisine
  'пицца':    { categories: ['Пиццерия'], cuisines: ['Итальянская'] },
  'пиццу':    { categories: ['Пиццерия'], cuisines: ['Итальянская'] },
  'паста':    { categories: ['Ресторан'], cuisines: ['Итальянская'] },
  'суши':     { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'ролл':     { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'роллы':    { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'бургер':   { categories: ['Фаст-фуд'], cuisines: ['Американская'] },
  'бургеры':  { categories: ['Фаст-фуд'], cuisines: ['Американская'] },
  'хинкали':  { categories: [], cuisines: ['Грузинская'] },
  'хачапури': { categories: [], cuisines: ['Грузинская'] },
  'шашлык':   { categories: [], cuisines: ['Грузинская'] },
  'лапша':    { categories: [], cuisines: ['Азиатская'] },
  'рамен':    { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'вок':      { categories: [], cuisines: ['Азиатская'] },
  'стейк':    { categories: ['Ресторан'], cuisines: ['Американская', 'Европейская'] },
  'кофе':     { categories: ['Кофейня'], cuisines: [] },
  'торт':     { categories: ['Кондитерская'], cuisines: [] },
  'выпечка':  { categories: ['Пекарня', 'Кондитерская'], cuisines: [] },
  'пиво':     { categories: ['Бар', 'Паб'], cuisines: [] },
  'коктейль': { categories: ['Бар'], cuisines: [] },
  'кальян':   { categories: ['Кальянная', 'Кальян'], cuisines: [] },
  'драники':  { categories: [], cuisines: ['Народная'] },
  'веган':    { categories: [], cuisines: ['Вегетарианская'] },
  'вегетарианское': { categories: [], cuisines: ['Вегетарианская'] },
};

/**
 * Helper: Build search conditions for text query.
 * Combines ILIKE on name/description/categories/cuisines with synonym expansion.
 *
 * @param {string} search - User search text
 * @param {Array} conditions - Existing WHERE conditions array (mutated)
 * @param {Array} params - Existing params array (mutated)
 * @param {number} paramIndex - Current parameter index
 * @returns {number} Updated paramIndex
 */
function addSearchConditions(search, conditions, params, paramIndex) {
  const searchLower = search.toLowerCase();
  const likePattern = `%${search}%`;

  // Base ILIKE conditions: name, description, categories text, cuisines text
  const orParts = [
    `e.name ILIKE $${paramIndex}`,
    `e.description ILIKE $${paramIndex}`,
    `e.categories::text ILIKE $${paramIndex}`,
    `e.cuisines::text ILIKE $${paramIndex}`,
  ];
  params.push(likePattern);
  paramIndex++;

  // Check synonyms — expand search to related categories/cuisines
  const synonym = SEARCH_SYNONYMS[searchLower];
  if (synonym) {
    if (synonym.categories && synonym.categories.length > 0) {
      orParts.push(`e.categories && $${paramIndex}::varchar[]`);
      params.push(synonym.categories);
      paramIndex++;
    }
    if (synonym.cuisines && synonym.cuisines.length > 0) {
      orParts.push(`e.cuisines && $${paramIndex}::varchar[]`);
      params.push(synonym.cuisines);
      paramIndex++;
    }
  }

  conditions.push(`(${orParts.join(' OR ')})`);
  return paramIndex;
}

/**
 * Helper: SQL fragment that extracts close_time from working_hours JSONB.
 * Handles two data formats:
 *   - String: "10:00-22:00" → extracts "22:00"
 *   - Object: {"open":"10:00","close":"22:00"} → extracts "22:00"
 *   - Object without close (e.g. {"is_open":false}) → NULL
 *
 * Used inside jsonb_each() via LATERAL join.
 * Variable `val` refers to the JSONB value for each day.
 */
const CLOSE_TIME_SQL = `
  LATERAL (SELECT
    CASE jsonb_typeof(val)
      WHEN 'string' THEN
        CASE WHEN val #>> '{}' ~ '^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$'
          THEN SPLIT_PART(val #>> '{}', '-', 2)
          ELSE NULL END
      WHEN 'object' THEN
        CASE WHEN val->>'close' IS NOT NULL AND val->>'close' ~ '^[0-9]{1,2}:[0-9]{2}$'
          THEN val->>'close'
          ELSE NULL END
      ELSE NULL
    END AS close_time
  ) ct
`;

/**
 * Helper: Build ORDER BY clause based on sort parameter
 *
 * @param {string} sortBy - Sort option (rating, price_asc, price_desc, distance)
 * @param {boolean} hasDistance - Whether distance_km column is available
 * @returns {string} SQL ORDER BY clause
 */
function buildOrderByClause(sortBy, hasDistance = false) {
  // Convert price range to numeric for sorting
  const priceToNum = `(CASE e.price_range
    WHEN '$' THEN 1
    WHEN '$$' THEN 2
    WHEN '$$$' THEN 3
    WHEN '$$$$' THEN 4
    ELSE 0
  END)`;

  switch (sortBy) {
    case 'rating':
      return 'e.average_rating DESC NULLS LAST, e.review_count DESC, e.name ASC';

    case 'price_asc':
      return `${priceToNum} ASC, e.average_rating DESC NULLS LAST, e.name ASC`;

    case 'price_desc':
      return `${priceToNum} DESC, e.average_rating DESC NULLS LAST, e.name ASC`;

    case 'distance':
      if (hasDistance) {
        return 'distance_km ASC, e.average_rating DESC, e.name ASC';
      }
      // Fallback to rating if distance not available
      return 'e.average_rating DESC NULLS LAST, e.review_count DESC, e.name ASC';

    default:
      // Default: rating-based
      return 'e.average_rating DESC NULLS LAST, e.review_count DESC, e.name ASC';
  }
}

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
 * @param {string} params.sortBy - Sort order (distance, rating, price_asc, price_desc)
 * @returns {Promise<Object>} Search results with establishments and pagination
 */
export async function searchByRadius({
  latitude,
  longitude,
  radius = 10,
  maxDistance = null,
  city = null,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 20,
  offset = 0,
  page = 1,
  sortBy = 'rating',
  hoursFilter = null,
  features = null,
  search = null,
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

  // Add hours filter
  // working_hours is JSONB with two possible value formats per day:
  //   String: "10:00-22:00"
  //   Object: {"open": "10:00", "close": "22:00"} or {"is_open": false}
  // CLOSE_TIME_SQL handles extraction from both formats via LATERAL join.
  if (hoursFilter) {
    switch (hoursFilter) {
      case 'until_22':
        // Establishments that close by 22:00 on ALL days
        // Exclude if ANY day closes after 22:00 (including 22:01+) or after midnight (00:xx-06:xx)
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND (
              CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) > 22
              OR (
                CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) = 22
                AND CAST(SPLIT_PART(ct.close_time, ':', 2) AS INTEGER) > 0
              )
              OR CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
            )
          )
        `);
        break;
      case 'until_morning':
        // Late night establishments - at least one day closes after midnight (00:00-06:59)
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
          )
        `);
        break;
      case '24_hours':
        // 24-hour establishments
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE (
              ct.close_time IS NOT NULL
              AND ct.close_time IN ('23:59', '00:00')
              AND SPLIT_PART(
                CASE jsonb_typeof(val)
                  WHEN 'string' THEN val #>> '{}'
                  WHEN 'object' THEN val->>'open'
                  ELSE NULL
                END, ':', 1) = '0'
            )
            OR (jsonb_typeof(val) = 'string' AND val #>> '{}' ILIKE '%24%')
          )
        `);
        break;
    }
  }

  // Add features filter (check attributes JSONB)
  if (features && features.length > 0) {
    features.forEach((feature) => {
      conditions.push(`(e.attributes->>$${paramIndex})::boolean = true`);
      params.push(feature);
      paramIndex++;
    });
  }

  // Add text search filter (ILIKE + synonyms)
  if (search) {
    paramIndex = addSearchConditions(search, conditions, params, paramIndex);
  }

  const whereClause = conditions.join(' AND ');

  // Determine if we should filter by distance:
  // - If maxDistance is explicitly provided (from max_distance param), always filter
  // - If no city specified, use default radius filtering
  // - If city specified without maxDistance, skip filtering (just sort by distance)
  const useRadiusFilter = maxDistance != null || !city;

  // Use maxDistance if provided, otherwise fall back to radius
  const effectiveRadius = maxDistance ?? radius;

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
      ORDER BY ${buildOrderByClause(sortBy, true).replaceAll('e.', 'ne.')}
      LIMIT $${paramIndex + 3}
      OFFSET $${paramIndex + 4}
    `;
    params.push(longitude, latitude, effectiveRadius, limit, offset);

    countQuery = `
      SELECT COUNT(*) as total
      FROM establishments e
      WHERE ${whereClause}
        AND ST_Distance(
          ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
          ST_MakePoint(e.longitude, e.latitude)::geography
        ) / 1000.0 <= $${paramIndex + 2}
    `;
    // Note: countParams will use effectiveRadius from params array
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
      ORDER BY ${buildOrderByClause(sortBy, true)}
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
  sortBy = 'rating',
  hoursFilter = null,
  features = null,
  search = null,
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

  // Add hours filter (same dual-format logic as searchByRadius)
  if (hoursFilter) {
    switch (hoursFilter) {
      case 'until_22':
        // Establishments that close by 22:00 on ALL days
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND (
              CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) > 22
              OR (
                CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) = 22
                AND CAST(SPLIT_PART(ct.close_time, ':', 2) AS INTEGER) > 0
              )
              OR CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
            )
          )
        `);
        break;
      case 'until_morning':
        // Late night establishments - at least one day closes after midnight (00:00-06:59)
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
          )
        `);
        break;
      case '24_hours':
        // 24-hour establishments
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE (
              ct.close_time IS NOT NULL
              AND ct.close_time IN ('23:59', '00:00')
              AND SPLIT_PART(
                CASE jsonb_typeof(val)
                  WHEN 'string' THEN val #>> '{}'
                  WHEN 'object' THEN val->>'open'
                  ELSE NULL
                END, ':', 1) = '0'
            )
            OR (jsonb_typeof(val) = 'string' AND val #>> '{}' ILIKE '%24%')
          )
        `);
        break;
    }
  }

  // Add features filter
  if (features && features.length > 0) {
    features.forEach((feature) => {
      conditions.push(`(e.attributes->>$${paramIndex})::boolean = true`);
      params.push(feature);
      paramIndex++;
    });
  }

  // Add text search filter (ILIKE + synonyms)
  if (search) {
    paramIndex = addSearchConditions(search, conditions, params, paramIndex);
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
    ORDER BY ${buildOrderByClause(sortBy, false)}
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
  hoursFilter = null,
  limit = 100,
  search = null,
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

  // Add text search filter (ILIKE + synonyms)
  if (search) {
    paramIndex = addSearchConditions(search, conditions, params, paramIndex);
  }

  // Add hours filter (same logic as searchByRadius)
  // working_hours is JSONB with two possible value formats per day:
  //   String: "10:00-22:00"
  //   Object: {"open": "10:00", "close": "22:00"} or {"is_open": false}
  if (hoursFilter) {
    switch (hoursFilter) {
      case 'until_22':
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND (
              CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) > 22
              OR (
                CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) = 22
                AND CAST(SPLIT_PART(ct.close_time, ':', 2) AS INTEGER) > 0
              )
              OR CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
            )
          )
        `);
        break;
      case 'until_morning':
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
          )
        `);
        break;
      case '24_hours':
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE (
              ct.close_time IS NOT NULL
              AND ct.close_time IN ('23:59', '00:00')
              AND SPLIT_PART(
                CASE jsonb_typeof(val)
                  WHEN 'string' THEN val #>> '{}'
                  WHEN 'object' THEN val->>'open'
                  ELSE NULL
                END, ':', 1) = '0'
            )
            OR (jsonb_typeof(val) = 'string' AND val #>> '{}' ILIKE '%24%')
          )
        `);
        break;
    }
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

  // Track view (non-blocking, fire-and-forget)
  EstablishmentModel.incrementViewCount(id);

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
