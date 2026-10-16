import { incrementWithExpiry, getTTL } from '../config/redis.js';
import { decodeAccessToken, extractTokenFromHeader } from '../utils/jwt.js';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * The longest window the global limiter takes: a day. A longer one is far more
 * likely a slip — milliseconds written for seconds — than a wish, and the
 * window decides the length of a counting bucket (bucketAt).
 */
const MAX_WINDOW_SECONDS = 86400;

/**
 * A limit or a window from the environment, read as it always was — the whole
 * number the value starts with (parseInt) — so a value that worked before keeps
 * its meaning; anything after the number is ignored and named in a warning.
 * Unset or empty: the default. Not a whole number above zero, or above `max`:
 * the default and a warning — read as is, such a value would switch the
 * limiter off (a window that is not a number has no buckets) or refuse every
 * request (a limit below one).
 *
 * @param {Object} env - process.env or a stand-in
 * @param {string} name - Variable name
 * @param {number} fallback - Default when the variable is unset, empty or unusable
 * @param {number} [max] - Largest value taken
 * @returns {{ value: number, warning: string|null }}
 */
const positiveWholeNumber = (env, name, fallback, max = Number.MAX_SAFE_INTEGER) => {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return { value: fallback, warning: null };
  }
  const value = parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return {
      value: fallback,
      warning: `${name}=${JSON.stringify(raw)} is not a whole number above zero; ${fallback} is used`,
    };
  }
  if (value > max) {
    return {
      value: fallback,
      warning: `${name}=${JSON.stringify(raw)} is above ${max}; ${fallback} is used`,
    };
  }
  if (String(value) !== String(raw).trim()) {
    return { value, warning: `${name}=${JSON.stringify(raw)} is read as ${value}` };
  }
  return { value, warning: null };
};

/**
 * The two tiers of the global limiter, from the environment.
 *
 * - Signed-in requests: 100 per minute, counted per account (lenient for
 *   legitimate users).
 * - Anonymous requests: 300 per hour, counted per IP (strict to prevent abuse).
 *
 * The asymmetric limits reflect different trust levels. Authenticated users have
 * proven identity and can be individually throttled or banned if abusive.
 * Unauthenticated users are harder to track and block, so get tighter limits.
 * Windows are in seconds, a day at most, and decide the length of a counting
 * bucket (bucketAt).
 *
 * @param {Object} env - process.env or a stand-in
 * @returns {{ tiers: { user: { limit: number, windowSeconds: number },
 *   ip: { limit: number, windowSeconds: number } }, warnings: string[] }}
 */
export const resolveRateLimitTiers = (env) => {
  const warnings = [];
  const read = (name, fallback, max) => {
    const { value, warning } = positiveWholeNumber(env, name, fallback, max);
    if (warning) {
      warnings.push(warning);
    }
    return value;
  };
  return {
    tiers: {
      user: {
        limit: read('RATE_LIMIT_AUTHENTICATED', 100),
        windowSeconds: read('RATE_LIMIT_WINDOW_AUTHENTICATED', 60, MAX_WINDOW_SECONDS),
      },
      ip: {
        limit: read('RATE_LIMIT_UNAUTHENTICATED', 300),
        windowSeconds: read('RATE_LIMIT_WINDOW_UNAUTHENTICATED', 3600, MAX_WINDOW_SECONDS),
      },
    },
    warnings,
  };
};

/**
 * What a client reads when a limiter refuses (429), the global one and every
 * createRateLimiter alike: decision of the Coordinator, 15.10.2026. The app
 * shows the response's message as is on the partner's screens and the guest's
 * booking form; the code RATE_LIMIT_EXCEEDED stays what clients key on.
 */
export const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Попробуйте позже.';

/**
 * The bucket a moment falls in: windows of `windowSeconds` laid end to end from
 * the Unix epoch, so a 60 s window starts on every UTC minute and a 3600 s one
 * on every UTC hour. The bucket's number is part of the counter's key and the
 * counter expires when its bucket ends, so the window variable alone decides
 * how long a counter counts. Until 16.10.2026 the key named the calendar minute
 * or hour whatever the variable said, and the counter outlived its bucket by up
 * to a window — X-RateLimit-Reset could name a moment up to an hour too late.
 *
 * @param {number} windowSeconds - Window length, whole seconds above zero
 * @param {number} nowMs - The moment, milliseconds since the epoch
 * @returns {{ index: number, secondsLeft: number }} secondsLeft: 1..windowSeconds
 */
const bucketAt = (windowSeconds, nowMs) => {
  const windowMs = windowSeconds * 1000;
  const index = Math.floor(nowMs / windowMs);
  return { index, secondsLeft: Math.ceil(((index + 1) * windowMs - nowMs) / 1000) };
};

/**
 * Whose budget a request spends: the account of a genuine access token in its
 * Authorization header, otherwise the address it came from.
 *
 * The global limiter runs before every route (server.js), so before any route's
 * authenticate: req.user is never set here. Until 16.10.2026 the limiter read
 * req.user all the same — every request was counted by address, people behind
 * one address shared one budget, and the signed-in tier never ran. The token is
 * verified here with authenticate's own check (utils/jwt.js: signature, expiry,
 * issuer, audience, type), without the database. No token, or one that does not
 * verify — forged, unsigned, expired, of another type — counts against the
 * address: a made-up token cannot open a fresh budget. A genuine token of an
 * account switched off or revoked since still counts against that account until
 * it expires; authenticate refuses the request itself.
 *
 * @param {Object} req - Express request
 * @returns {{ tier: 'user'|'ip', identifier: string }}
 */
const countedAs = (req) => {
  const token = extractTokenFromHeader(req.headers?.authorization);
  if (token) {
    try {
      const { userId } = decodeAccessToken(token);
      if (typeof userId === 'string' && userId !== '') {
        return { tier: 'user', identifier: userId };
      }
    } catch {
      // Not a genuine access token: counted by address, like no token at all.
    }
  }
  return { tier: 'ip', identifier: req.ip };
};

/**
 * The window as a 429 body names it: '1 minute' and '1 hour' as always for the
 * default windows, otherwise in seconds, as createRateLimiter says it.
 *
 * @param {number} seconds
 * @returns {string}
 */
const describeWindow = (seconds) => {
  if (seconds === 60) {
    return '1 minute';
  }
  if (seconds === 3600) {
    return '1 hour';
  }
  return `${seconds} seconds`;
};

/**
 * Global rate limiting middleware with two tiers: a signed-in request spends
 * its account's budget, any other request its address's (countedAs).
 *
 * Mounted once, in server.js, ahead of every route — not placed in routes.
 *
 * Implementation details:
 * - Uses Redis SET NX + INCR in one MULTI for an atomic counter with auto-cleanup
 * - Returns detailed rate limit headers for client transparency
 * - Logs rate limit violations for security monitoring
 * - Fails open (allows request) if Redis is unavailable to prevent DOS of our own API
 *
 * Response headers (following industry standards):
 * - X-RateLimit-Limit: Maximum requests allowed in window
 * - X-RateLimit-Remaining: Requests remaining in current window
 * - X-RateLimit-Reset: Unix timestamp when window resets
 *
 * @param {{ user: { limit: number, windowSeconds: number },
 *   ip: { limit: number, windowSeconds: number } }} tiers - resolveRateLimitTiers().tiers
 * @returns {Function} Express middleware function
 */
export const createGlobalRateLimiter = (tiers) => async (req, res, next) => {
  let identifier;
  try {
    const counted = countedAs(req);
    identifier = counted.identifier;
    const isAuthenticated = counted.tier === 'user';
    const { limit, windowSeconds } = tiers[counted.tier];

    // The counter of this tier's current bucket; it expires when the bucket ends
    const bucket = bucketAt(windowSeconds, Date.now());
    const rateLimitKey = `ratelimit:${counted.tier}:${identifier}:${bucket.index}`;
    const currentCount = await incrementWithExpiry(rateLimitKey, bucket.secondsLeft);

    // Calculate remaining requests and reset time
    const remaining = Math.max(0, limit - currentCount);
    const ttl = await getTTL(rateLimitKey);
    const resetTime = Math.floor(Date.now() / 1000) + ttl;

    // Set rate limit headers for client awareness
    res.set({
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': resetTime.toString(),
    });

    // Check if limit exceeded
    if (currentCount > limit) {
      logger.warn('Rate limit exceeded', {
        identifier,
        isAuthenticated,
        currentCount,
        limit,
        path: req.path,
        method: req.method,
      });

      return res.status(429).json({
        success: false,
        message: RATE_LIMIT_MESSAGE,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          details: {
            limit,
            window: describeWindow(windowSeconds),
            retry_after: ttl,
            reset_at: new Date(resetTime * 1000).toISOString(),
          },
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Request is within limits - proceed
    next();
  } catch (error) {
    // CRITICAL: If rate limiting fails (Redis down), we fail open and allow the request.
    // This prevents Redis outages from DOSing our own API. However, we log this as
    // an error because it means we're temporarily vulnerable to abuse.
    logger.error('Rate limiting check failed - allowing request', {
      error: error.message,
      path: req.path,
      identifier: identifier ?? req.ip,
    });

    // Allow request to proceed despite rate limiting failure
    next();
  }
};

/**
 * The global limiter's tiers from the environment, resolved once. server.js
 * logs them with their warnings at startup: the tier of signed-in requests
 * first counted on 16.10.2026, so values that had no effect until then do now.
 */
export const globalRateLimitTiers = resolveRateLimitTiers(process.env);

/**
 * The global limiter, with the tiers from the environment (server.js).
 */
export const rateLimiter = createGlobalRateLimiter(globalRateLimitTiers.tiers);

/**
 * Custom rate limiter factory for specific endpoints that need different limits.
 * 
 * Some endpoints may require tighter or looser limits than the global defaults.
 * For example, authentication endpoints might have stricter limits to prevent
 * brute force attacks.
 * 
 * Example usage:
 * router.post(
 *   '/auth/login',
 *   createRateLimiter({ limit: 5, windowSeconds: 300 }),
 *   loginController
 * );
 * 
 * This would limit login attempts to 5 per 5 minutes per IP, which is much
 * stricter than the global unauthenticated limit of 300 per hour.
 *
 * It counts per account only where it stands after authenticate (req.user is
 * set there); before authenticate, or on a public route, it counts per IP.
 * 
 * @param {Object} options - Rate limit configuration
 * @param {number} options.limit - Maximum requests in window
 * @param {number} options.windowSeconds - Time window in seconds
 * @param {string} options.keyPrefix - Redis key prefix for this limiter
 * @returns {Function} Express middleware function
 */
export const createRateLimiter = ({ limit, windowSeconds, keyPrefix = 'custom' }) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user?.userId || req.ip;
      const now = new Date();
      const timeUnit = Math.floor(now.getTime() / (windowSeconds * 1000));
      const rateLimitKey = `ratelimit:${keyPrefix}:${identifier}:${timeUnit}`;

      const currentCount = await incrementWithExpiry(rateLimitKey, windowSeconds);
      const remaining = Math.max(0, limit - currentCount);
      const ttl = await getTTL(rateLimitKey);
      const resetTime = Math.floor(Date.now() / 1000) + ttl;

      res.set({
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': resetTime.toString(),
      });

      if (currentCount > limit) {
        logger.warn(`Custom rate limit exceeded (${keyPrefix})`, {
          identifier,
          currentCount,
          limit,
          path: req.path,
        });

        return res.status(429).json({
          success: false,
          message: RATE_LIMIT_MESSAGE,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            details: {
              limit,
              window: `${windowSeconds} seconds`,
              retry_after: ttl,
              reset_at: new Date(resetTime * 1000).toISOString(),
            },
          },
          timestamp: new Date().toISOString(),
        });
      }

      next();
    } catch (error) {
      logger.error(`Custom rate limiting check failed (${keyPrefix}) - allowing request`, {
        error: error.message,
        path: req.path,
      });
      next();
    }
  };
};
