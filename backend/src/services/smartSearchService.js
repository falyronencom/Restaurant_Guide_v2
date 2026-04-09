/**
 * Smart Search Service
 *
 * AI-powered intent parsing for natural language restaurant search queries.
 * Uses OpenRouter API (Gemini 2.5 Flash-Lite, fallback DeepSeek V3) to parse
 * user intent, then delegates to existing searchService for SQL execution.
 *
 * Pipeline: parseIntent → validate (Zod) → buildFilters → searchByRadius/searchWithoutLocation
 * Fallback: raw query → existing ILIKE + SEARCH_SYNONYMS (transparent to user)
 */

import { z } from 'zod';
import crypto from 'crypto';
import { getConfig, isAvailable } from '../config/openrouter.js';
import { setWithExpiry } from '../config/redis.js';
import redisClient from '../config/redis.js';
import * as searchService from './searchService.js';
import logger from '../utils/logger.js';

/**
 * Valid values from establishmentValidation.js — used in AI prompt and Zod validation.
 * DB stores cyrillic directly.
 */
const VALID_CATEGORIES = [
  'Ресторан', 'Кофейня', 'Кафе', 'Фаст-фуд', 'Бар', 'Кондитерская',
  'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная', 'Боулинг',
  'Караоке', 'Бильярд', 'Клуб',
];

const VALID_CUISINES = [
  'Народная', 'Авторская', 'Азиатская', 'Американская', 'Вегетарианская',
  'Японская', 'Грузинская', 'Итальянская', 'Смешанная', 'Европейская',
  'Китайская', 'Восточная',
];

/**
 * Zod schema for AI response validation.
 * Invalid responses trigger fallback to ILIKE search.
 */
const intentSchema = z.object({
  cuisine: z.array(z.enum(VALID_CUISINES)).nullable(),
  category: z.enum(VALID_CATEGORIES).nullable(),
  meal_type: z.string().nullable(),
  price_max: z.number().positive().nullable(),
  location: z.string().nullable(),
  sort: z.enum(['distance', 'rating', 'price_asc']).nullable(),
  tags: z.array(z.string()),
  error: z.string().nullable(),
});

/** Cache TTL: 1 hour */
const CACHE_TTL_SECONDS = 3600;

/** OpenRouter API timeout */
const API_TIMEOUT_MS = 5000;

/**
 * Build the AI prompt with full category/cuisine enums.
 */
function buildSystemPrompt() {
  return `You are a restaurant search intent parser for Belarus. Parse the user's natural language query into structured JSON.

Available categories (exact values): ${JSON.stringify(VALID_CATEGORIES)}
Available cuisines (exact values): ${JSON.stringify(VALID_CUISINES)}

Rules:
- category: pick ONE from the list above, or null if not clear
- cuisine: pick one or more from the list above as an array, or null
- meal_type: "breakfast", "lunch", "dinner", "snack", or null (for future use)
- price_max: approximate max price in BYN per person, or null
- location: city or area mentioned, or null
- sort: "distance" if user wants nearby, "rating" if best/top, "price_asc" if cheap/budget, or null
- tags: additional keywords for text search (e.g. "терраса", "live music", food names)
- error: null if parsed successfully, or error description

Always respond with valid JSON only, no markdown, no explanation.`;
}

/**
 * Normalize query for cache key generation.
 * @param {string} query
 * @returns {string}
 */
function normalizeQuery(query) {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Generate a hash for cache key.
 * @param {string} normalizedQuery
 * @returns {string}
 */
function generateQueryHash(normalizedQuery) {
  return crypto.createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 32);
}

/**
 * Get cached intent from Redis.
 * @param {string} queryHash
 * @returns {Promise<object|null>}
 */
export async function getCachedIntent(queryHash) {
  try {
    if (!redisClient.isOpen) return null;
    const cached = await redisClient.get(`smartsearch:${queryHash}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.warn('Smart search cache read failed', { error: error.message });
    return null;
  }
}

/**
 * Cache parsed intent in Redis.
 * @param {string} queryHash
 * @param {object} intent
 * @param {number} ttl - TTL in seconds
 */
export async function cacheIntent(queryHash, intent, ttl = CACHE_TTL_SECONDS) {
  try {
    if (!redisClient.isOpen) return;
    await setWithExpiry(`smartsearch:${queryHash}`, JSON.stringify(intent), ttl);
  } catch (error) {
    logger.warn('Smart search cache write failed', { error: error.message });
  }
}

/**
 * Call OpenRouter API to parse user intent.
 *
 * @param {string} query - User's natural language search query
 * @returns {Promise<object|null>} Parsed intent or null on failure
 */
export async function parseIntent(query) {
  if (!isAvailable()) {
    logger.debug('OpenRouter not available, skipping AI parsing');
    return null;
  }

  const config = getConfig();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://restaurantguidev2-production.up.railway.app',
        'X-Title': 'Restaurant Guide Belarus',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: query },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.error('OpenRouter API error', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      logger.warn('OpenRouter returned empty content');
      return null;
    }

    const parsed = JSON.parse(content);
    const validated = intentSchema.parse(parsed);

    logger.info('AI intent parsed successfully', {
      query,
      intent: validated,
      model: data.model || config.model,
    });

    return validated;
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn('OpenRouter API timeout', { query, timeoutMs: API_TIMEOUT_MS });
    } else if (error instanceof z.ZodError) {
      logger.warn('AI response failed Zod validation', {
        query,
        errors: error.errors,
      });
    } else {
      logger.error('AI intent parsing failed', {
        query,
        error: error.message,
      });
    }
    return null;
  }
}

/**
 * Convert parsed AI intent into parameters for existing search functions.
 *
 * @param {object} intent - Validated intent from parseIntent()
 * @param {{ latitude?: number, longitude?: number, city?: string }} context - User context
 * @returns {object} Parameters compatible with searchByRadius/searchWithoutLocation
 */
export function buildSmartSearchFilters(intent, context = {}) {
  const filters = {};

  // Category
  if (intent.category) {
    filters.categories = [intent.category];
  }

  // Cuisines
  if (intent.cuisine && intent.cuisine.length > 0) {
    filters.cuisines = intent.cuisine;
  }

  // Price mapping: price_max BYN → price_range symbols
  if (intent.price_max != null) {
    if (intent.price_max <= 15) {
      filters.priceRange = ['$'];
    } else if (intent.price_max <= 30) {
      filters.priceRange = ['$', '$$'];
    } else {
      filters.priceRange = ['$', '$$', '$$$'];
    }
  }

  // Sort — if null, determined by presence of coordinates
  if (intent.sort) {
    filters.sortBy = intent.sort;
  } else {
    filters.sortBy = (context.latitude && context.longitude) ? 'distance' : 'rating';
  }

  // Location from AI (city override)
  if (intent.location) {
    filters.city = intent.location;
  } else if (context.city) {
    filters.city = context.city;
  }

  // Tags → search text for existing ILIKE + SEARCH_SYNONYMS
  if (intent.tags && intent.tags.length > 0) {
    filters.search = intent.tags.join(' ');
  }

  // meal_type — logged for future use, not applied as filter
  if (intent.meal_type) {
    logger.debug('meal_type detected but not applied (Phase 1)', {
      mealType: intent.meal_type,
    });
  }

  // Coordinates passthrough
  if (context.latitude && context.longitude) {
    filters.latitude = context.latitude;
    filters.longitude = context.longitude;
  }

  return filters;
}

/**
 * Execute smart search: AI parse → build filters → existing search pipeline.
 *
 * @param {string} query - Natural language query
 * @param {{ latitude?: number, longitude?: number, city?: string }} context
 * @param {{ limit?: number, page?: number }} pagination
 * @returns {Promise<{ intent: object|null, results: object[], total: number, fallback: boolean }>}
 */
export async function executeSmartSearch(query, context = {}, pagination = {}) {
  const { limit = 20, page = 1 } = pagination;
  const offset = (page - 1) * limit;

  const normalized = normalizeQuery(query);
  const queryHash = generateQueryHash(normalized);

  // 1. Check Redis cache
  let intent = await getCachedIntent(queryHash);
  let fromCache = false;

  if (intent) {
    fromCache = true;
    logger.debug('Smart search cache hit', { queryHash });
  } else {
    // 2. Call AI
    intent = await parseIntent(query);

    // 3. Cache on success
    if (intent) {
      await cacheIntent(queryHash, intent);
    }
  }

  // 4. Build filters or fallback
  const isFallback = !intent;

  let searchResult;

  if (intent) {
    // AI-parsed path
    const filters = buildSmartSearchFilters(intent, context);

    const searchParams = {
      ...filters,
      limit,
      offset,
      page,
    };

    if (filters.latitude && filters.longitude) {
      searchResult = await searchService.searchByRadius(searchParams);
    } else {
      searchResult = await searchService.searchWithoutLocation(searchParams);
    }
  } else {
    // Fallback: raw query through existing ILIKE + SEARCH_SYNONYMS
    const fallbackParams = {
      search: query,
      city: context.city || null,
      sortBy: (context.latitude && context.longitude) ? 'distance' : 'rating',
      limit,
      offset,
      page,
    };

    if (context.latitude && context.longitude) {
      fallbackParams.latitude = context.latitude;
      fallbackParams.longitude = context.longitude;
      searchResult = await searchService.searchByRadius(fallbackParams);
    } else {
      searchResult = await searchService.searchWithoutLocation(fallbackParams);
    }
  }

  // Log for analytics
  logSearchQuery(query, intent, searchResult.pagination?.total || 0, isFallback, fromCache);

  return {
    intent: intent || null,
    results: searchResult.establishments || [],
    pagination: searchResult.pagination || { total: 0, page, limit, totalPages: 0 },
    fallback: isFallback,
  };
}

/**
 * Log search query for analytics (structured logger, no migration needed).
 */
function logSearchQuery(rawQuery, parsedIntent, resultCount, isFallback, fromCache) {
  logger.info('smart_search_query', {
    query: rawQuery,
    intent: parsedIntent,
    resultCount,
    fallback: isFallback,
    fromCache,
    timestamp: new Date().toISOString(),
  });
}
