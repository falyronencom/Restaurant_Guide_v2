import { createClient } from 'redis';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

/**
 * Redis client configuration for rate limiting and the smart-search cache.
 *
 * Redis is used for two purposes in this application:
 * 1. Rate limiting: Track request counts per user/IP with automatic expiration
 * 2. Smart search: Cache the parsed intent of a phrase for an hour (smartSearchService)
 * Refresh tokens live in PostgreSQL (refresh_tokens), not here.
 *
 * Every caller treats Redis as optional: while it is unavailable a request goes
 * on without a limit or a cached intent (a separate decision, #22 of the
 * 23.09.2026 review). This module makes sure that "unavailable" never means
 * "waits" (#3 of the same review):
 * - the client never gives up reconnecting — a strategy that returns an Error
 *   closes the client for the rest of the process's life;
 * - while it reconnects the client stays open but not ready, so request-path
 *   helpers check isReady, and single commands fail at once instead of waiting
 *   in the offline queue (disableOfflineQueue);
 * - a connection that looks ready but does not answer (half-open) is bounded by
 *   a deadline on every request-path call (withRedisDeadline);
 * - startup waits a bounded time, so the server exits instead of hanging.
 */

/** Upper bound of the pause between two reconnect attempts. */
export const RECONNECT_DELAY_CAP_MS = 3000;

/** How long startup waits for Redis before connectRedis() reports failure. */
export const CONNECT_TIMEOUT_MS = 10000;

/** Deadline of one Redis call on a request path. */
export const REDIS_CALL_TIMEOUT_MS = 500;

/**
 * Reconnect attempts are logged one by one while an outage is young, then once
 * every REPEAT_LOG_EVERY attempts (about a minute at the delay cap): the client
 * now retries for as long as Redis is down, and three lines every three seconds
 * would bury the rest of the log.
 */
const LOG_EVERY_ATTEMPT_UNTIL = 10;
const REPEAT_LOG_EVERY = 20;
let reconnectAttempt = 0;
const isAttemptLogged = (attempt) =>
  attempt <= LOG_EVERY_ATTEMPT_UNTIL || attempt % REPEAT_LOG_EVERY === 0;

/**
 * Reconnect strategy: linear backoff up to RECONNECT_DELAY_CAP_MS, for ever.
 * It must always return a number — returning an Error makes @redis/client
 * close the client, and connectRedis() runs only at startup.
 *
 * @param {number} retries - Attempt number, from 0
 * @returns {number} Delay before the next attempt, ms
 */
const reconnectStrategy = (retries) => {
  reconnectAttempt = retries;
  const delay = Math.min(retries * 100, RECONNECT_DELAY_CAP_MS);
  if (isAttemptLogged(retries)) {
    logger.warn(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
  }
  return delay;
};

const redisConfig = {
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    reconnectStrategy,
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0', 10),
  // A single command issued while the client reconnects fails at once instead
  // of waiting in the offline queue for a connection that may never come back.
  // MULTI ignores this flag (@redis/client 1.6) — incrementWithExpiry checks
  // isReady itself.
  disableOfflineQueue: true,
};

/**
 * Create Redis client instance.
 * Connection is established lazily on first use via connect() call.
 */
const redisClient = createClient(redisConfig);

/**
 * Redis error handler for connection and runtime errors.
 * These errors need to be logged but shouldn't crash the application.
 * The reconnect strategy will handle transient connection failures.
 */
redisClient.on('error', (err) => {
  if (!isAttemptLogged(reconnectAttempt)) return;
  logger.error('Redis client error', {
    error: err.message,
    code: err.code,
    attempt: reconnectAttempt,
  });
});

/**
 * Redis connection event handler.
 * Logs successful connection establishment for monitoring.
 */
redisClient.on('connect', () => {
  logger.info('Redis client connecting...');
});

/**
 * Redis ready event handler.
 * Triggered when client is connected and ready to accept commands.
 */
redisClient.on('ready', () => {
  reconnectAttempt = 0;
  logger.info('Redis client ready', {
    host: redisConfig.socket.host,
    port: redisConfig.socket.port,
    database: redisConfig.database,
  });
});

/**
 * Redis reconnecting event handler.
 * Useful for monitoring connection stability in production.
 */
redisClient.on('reconnecting', () => {
  if (!isAttemptLogged(reconnectAttempt)) return;
  logger.warn('Redis client reconnecting...');
});

/**
 * Bound a Redis call on a request path by a deadline.
 *
 * isReady cannot see a half-open connection: the client looks ready while the
 * server never answers, and @redis/client 1.6 has no per-command timeout — the
 * call would wait until TCP gives up, which can take minutes.
 *
 * @param {Promise} command - Pending Redis call
 * @param {number} ms - Deadline in milliseconds
 * @returns {Promise} The call's result, or a rejection once the deadline passes
 */
export const withRedisDeadline = (command, ms = REDIS_CALL_TIMEOUT_MS) => {
  // The call outlives a lost race and may still reject later — when the socket
  // finally errors or disconnect() flushes the queue. That rejection must stay
  // handled: an unhandled rejection shuts the server down (server.js).
  command.catch(() => {});
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms}ms`)), ms);
  });
  return Promise.race([command, deadline]).finally(() => clearTimeout(timer));
};

const CONNECT_EXPIRED = Symbol('connect expired');

/**
 * Establish connection to Redis server.
 * Called during application startup; the server exits when it returns false.
 *
 * connect() settles only once the client is ready — while Redis is down it
 * keeps reconnecting for ever — so the wait is bounded here, and on expiry the
 * client is closed to stop the attempts.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] - How long to wait for a ready client and PONG
 * @returns {Promise<boolean>} True if connection successful
 */
export const connectRedis = async ({ timeoutMs = CONNECT_TIMEOUT_MS } = {}) => {
  const attempt = (async () => {
    await redisClient.connect();
    return redisClient.ping();
  })();
  // Settles after the race is lost (disconnect() below): keep its rejection handled.
  attempt.catch(() => {});
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(CONNECT_EXPIRED), timeoutMs);
  });
  try {
    const pong = await Promise.race([attempt, expired]);
    if (pong === CONNECT_EXPIRED) {
      logger.error('Redis connection timed out', {
        timeoutMs,
        host: redisConfig.socket.host,
      });
      await redisClient.disconnect();
      return false;
    }
    if (pong === 'PONG') {
      logger.info('Redis connection test successful');
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Redis connection failed', {
      error: error.message,
      host: redisConfig.socket.host,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Close the client during application shutdown.
 *
 * disconnect(), not quit(): QUIT is a command like any other — while the client
 * reconnects it would wait in the queue, and on a half-open connection it would
 * wait for an answer that never comes. By the time this runs HTTP is drained and
 * the background loops are stopped, so nothing in flight still needs Redis;
 * disconnect() drops the socket and rejects whatever is queued.
 *
 * @returns {Promise<void>}
 */
export const disconnectRedis = async () => {
  if (!redisClient.isOpen) return;
  try {
    await redisClient.disconnect();
    logger.info('Redis client disconnected');
  } catch (error) {
    logger.error('Error disconnecting Redis client', { error: error.message });
  }
};

/**
 * Increment a counter in Redis with automatic expiration.
 * Primary use case: rate limiting counters that auto-expire after time window.
 *
 * INCR and EXPIRE run in one MULTI, so the counter is never left without an
 * expiry. EXPIRE runs on every increment: each hit pushes the expiry back by
 * expirySeconds. Rate-limiter keys carry their time window in the key and roll
 * over regardless; a key without one (the review quota) lives until
 * expirySeconds after its last increment.
 *
 * @param {string} key - Redis key for the counter
 * @param {number} expirySeconds - Seconds until key expires, counted from this increment
 * @returns {Promise<number>} New counter value after increment
 */
export const incrementWithExpiry = async (key, expirySeconds) => {
  try {
    // isReady, not isOpen: while the client reconnects it stays open, and a
    // MULTI would wait in its queue — disableOfflineQueue does not cover MULTI.
    // The global limiter runs before every route: every request would wait.
    if (!redisClient.isReady) {
      logger.warn('Redis client not ready, skipping increment', { key });
      return 1; // Return 1 as if it's the first increment
    }
    const multi = redisClient.multi();
    multi.incr(key);
    multi.expire(key, expirySeconds);
    const results = await withRedisDeadline(multi.exec());
    return results[0]; // Return the incremented value
  } catch (error) {
    logger.error('Redis increment with expiry failed', {
      error: error.message,
      key,
    });
    // Return 1 instead of throwing to allow tests to continue
    return 1;
  }
};

/**
 * Get current value of a counter.
 * Returns null if key doesn't exist.
 * Returns 0 if Redis is not available (e.g., in test environment).
 *
 * @param {string} key - Redis key to retrieve
 * @returns {Promise<number|null>} Counter value or null
 */
export const getCounter = async (key) => {
  try {
    if (!redisClient.isReady) {
      logger.warn('Redis client not ready, returning 0 for counter', { key });
      return 0;
    }
    const value = await withRedisDeadline(redisClient.get(key));
    return value ? parseInt(value, 10) : 0;
  } catch (error) {
    logger.error('Redis get counter failed', {
      error: error.message,
      key,
    });
    // Return 0 instead of throwing to allow tests to continue
    return 0;
  }
};

/**
 * Get time-to-live for a key in seconds.
 * Returns -1 if key exists but has no expiration, -2 if key doesn't exist.
 * Throws when Redis is not ready or does not answer in time — the rate limiter
 * then lets the request through without limit headers.
 *
 * @param {string} key - Redis key to check
 * @returns {Promise<number>} Seconds until expiration
 */
export const getTTL = async (key) => {
  if (!redisClient.isReady) {
    // Not logged here: the rate limiter logs the failure once per request.
    throw new Error('Redis client is not ready');
  }
  try {
    return await withRedisDeadline(redisClient.ttl(key));
  } catch (error) {
    logger.error('Redis get TTL failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

/**
 * Store a value in Redis with expiration.
 * Primary use case: caching a parsed smart-search intent for an hour.
 *
 * @param {string} key - Redis key
 * @param {string} value - Value to store
 * @param {number} expirySeconds - Seconds until key expires
 * @returns {Promise<void>}
 */
export const setWithExpiry = async (key, value, expirySeconds) => {
  try {
    await withRedisDeadline(redisClient.setEx(key, expirySeconds, value));
  } catch (error) {
    logger.error('Redis set with expiry failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

/**
 * Delete a key from Redis.
 * Returns the number of keys deleted (0 if key didn't exist, 1 if deleted).
 *
 * @param {string} key - Redis key to delete
 * @returns {Promise<number>} Number of keys deleted
 */
export const deleteKey = async (key) => {
  try {
    return await redisClient.del(key);
  } catch (error) {
    logger.error('Redis delete key failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

export default redisClient;
