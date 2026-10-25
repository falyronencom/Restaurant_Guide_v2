import redisClient, { withRedisDeadline } from '../config/redis.js';
import { minskDate, secondsUntilMinskMidnight } from '../utils/minskDay.js';
import logger from '../utils/logger.js';

/**
 * The smart search's budget of model calls (SDL CAT-C-2.2, amendments 07.09
 * and 24.09.2026; directive D5, 25.10.2026).
 *
 * Money is spent only when a phrase misses the parse cache and the model is
 * called (smartSearchService.resolveIntent). Before that call the leader of
 * the shared parse asks this module, and the answer is yes or a reason:
 *
 *   - `junk` — the phrase is not worth a call: under 2 characters, without a
 *     single letter, or longer than 12 words (isJunkPhrase);
 *   - `no_redis` — the counters cannot be kept: the model is not called at
 *     all. The only fail-closed counter of the code base on purpose: every
 *     other limit lets requests through without Redis, but a model called
 *     without its counters can spend without bound;
 *   - `new_phrases` — this person's new phrases this hour are spent (20);
 *   - `hourly_cap`, `daily_cap` — all calls this hour (600) or this Minsk day
 *     (5000) are spent.
 *
 * A refusal is never an error: the search goes the classic way with the same
 * filters and answers `fallback: true`, exactly as when the model has no key.
 * At the average call (≈ $0.000385, 25.10.2026) the day's cap is ≈ $1.93.
 *
 * Calls, not phrases: a phrase whose answer is unusable is asked again
 * (MAX_ATTEMPTS = 2), and both are paid. A phrase therefore reserves
 * MAX_CALLS_PER_PHRASE calls up front — so even its retry cannot cross a cap —
 * and gives back what it did not use once the parse is over (settle).
 *
 * Reserve, compare, give back — the code base's way (ocrAllowance.js):
 * one MULTI raises the hour's and the day's calls and the person's phrases,
 * each result is compared, and a refused phrase takes all three back. Every
 * concurrent phrase sees its own count; none can pass a cap another already
 * filled. A MULTI that times out may still run later: then the count is too
 * high, never too low — the safe side.
 *
 * Keys live under `llmbudget:` — not `smartsearch:`, the parse cache's prefix,
 * which tests clean by pattern. The hour is the epoch's hour (Minsk is UTC+3
 * in whole hours, so it is Minsk's hour too), the day is Minsk's
 * (utils/minskDay.js), as for every daily limit of the product.
 *
 * Thresholds come from the environment on every decision — a change of a
 * variable needs no restart to be read, and a test sets them after the app
 * is loaded. Unset or empty: the default; `0`: that threshold is off;
 * anything else that is not a whole number: the default, with a warning.
 */

/**
 * A phrase's calls at most: the first and one retry — smartSearchService's
 * MAX_ATTEMPTS. Pinned equal by smartSearchParseIntent.test.js: a third
 * attempt would be a call nobody reserved.
 */
export const MAX_CALLS_PER_PHRASE = 2;

export const BUDGET_DEFAULTS = Object.freeze({
  hourly: 600,
  daily: 5000,
  newPhrasesPerHour: 20,
});

const CAP_VARIABLES = Object.freeze({
  hourly: 'SMART_SEARCH_LLM_HOURLY_CAP',
  daily: 'SMART_SEARCH_LLM_DAILY_CAP',
  newPhrasesPerHour: 'SMART_SEARCH_NEW_PHRASES_PER_HOUR',
});

const KEY_PREFIX = 'llmbudget';
const HOUR_MS = 3600 * 1000;

/** The longest phrase worth a call, in words (brief 07.09 §2 p. 4). */
const MAX_WORDS = 12;

/**
 * A threshold from the environment: a whole number, 0 included.
 *
 * @param {Object} env
 * @param {string} name
 * @param {number} fallback
 * @returns {{ value: number, warning: string|null }}
 */
const wholeNumberOrOff = (env, name, fallback) => {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { value: fallback, warning: null };
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    return {
      value: fallback,
      warning: `${name}=${JSON.stringify(raw)} is not a whole number; ${fallback} is used (0 turns the threshold off)`,
    };
  }
  return { value: Number(text), warning: null };
};

const capWarningsLogged = new Set();

/**
 * The three thresholds, read now. 0 means off.
 *
 * @param {Object} [env]
 * @returns {{ hourly: number, daily: number, newPhrasesPerHour: number }}
 */
export const resolveBudgetCaps = (env = process.env) => {
  const caps = {};
  for (const [field, name] of Object.entries(CAP_VARIABLES)) {
    const { value, warning } = wholeNumberOrOff(env, name, BUDGET_DEFAULTS[field]);
    caps[field] = value;
    if (warning && !capWarningsLogged.has(warning)) {
      capWarningsLogged.add(warning);
      logger.warn(`Smart search budget: ${warning}`);
    }
  }
  return caps;
};

/**
 * Whether a phrase is not worth a model call. The letter test is \p{L}: JS's
 * own word classes know only Latin (feedback_js_regex_word_boundary_cyrillic).
 * The name match runs beside the parse and does not need the model, so a
 * place named with digits stays findable.
 *
 * @param {string} normalizedQuery - lower-cased, trimmed, single spaces
 * @returns {boolean}
 */
export const isJunkPhrase = (normalizedQuery) => {
  const text = typeof normalizedQuery === 'string' ? normalizedQuery.trim() : '';
  if ([...text].length < 2) return true;
  if (!/\p{L}/u.test(text)) return true;
  return text.split(' ').filter(Boolean).length > MAX_WORDS;
};

const hourIndexOf = (now) => Math.floor(now.getTime() / HOUR_MS);

const secondsLeftInHour = (now) => Math.max(1, Math.ceil(((hourIndexOf(now) + 1) * HOUR_MS - now.getTime()) / 1000));

const keysAt = (now, requester) => {
  const hour = hourIndexOf(now);
  const day = minskDate(now);
  return {
    hour,
    day,
    hourCalls: `${KEY_PREFIX}:calls:h:${hour}`,
    dayCalls: `${KEY_PREFIX}:calls:d:${day}`,
    phrases: requester
      ? `${KEY_PREFIX}:phrases:${requester.tier}:${requester.identifier}:${hour}`
      : null,
    hourStats: `${KEY_PREFIX}:stat:h:${hour}`,
    dayStats: `${KEY_PREFIX}:stat:d:${day}`,
    // The hour's stats outlive it by a day: the hourly log line reads the
    // last hour a decision was made in, which after a quiet night is hours
    // ago (review 26.10.2026).
    hourTtl: secondsLeftInHour(now) + 86400,
    dayTtl: secondsUntilMinskMidnight(now) + 3600,
    phrasesTtl: secondsLeftInHour(now),
  };
};

/** Counters of the health block, in the order it shows them. */
const STAT_FIELDS = Object.freeze([
  'llm_calls',
  'cache_hits',
  'denied_junk',
  'denied_new_phrases',
  'denied_hourly_cap',
  'denied_daily_cap',
  'model_failed',
  'model_key_limit',
]);

const DENIAL_STAT = Object.freeze({
  junk: 'denied_junk',
  new_phrases: 'denied_new_phrases',
  hourly_cap: 'denied_hourly_cap',
  daily_cap: 'denied_daily_cap',
});

/**
 * Refusals without Redis are counted here: Redis is what is missing. Since the
 * process started.
 */
const processTallies = { since: new Date().toISOString(), deniedNoRedis: 0 };

const LOG_EVERY_MS = 5 * 60 * 1000;
const lastDenialLogAt = new Map();

/** A refusal to the log — its reason, never the phrase; once in 5 min a reason. */
const logDenial = (reason, details = {}) => {
  const now = Date.now();
  if (now - (lastDenialLogAt.get(reason) ?? 0) < LOG_EVERY_MS) return;
  lastDenialLogAt.set(reason, now);
  logger.warn('Smart search model call refused; classic search instead', { reason, ...details });
};

/**
 * Raise stat counters of the hour and the day. Best effort: a failure costs a
 * number in the health block, nothing else.
 *
 * @param {Object<string, number>} increments - field → amount
 * @param {Date} now
 */
const bumpStats = async (increments, now) => {
  const entries = Object.entries(increments).filter(([, amount]) => amount > 0);
  if (entries.length === 0 || !redisClient.isReady) return;
  const keys = keysAt(now, null);
  try {
    const multi = redisClient.multi();
    for (const [field, amount] of entries) {
      multi.hIncrBy(keys.hourStats, field, amount);
      multi.hIncrBy(keys.dayStats, field, amount);
    }
    multi.expire(keys.hourStats, keys.hourTtl);
    multi.expire(keys.dayStats, keys.dayTtl);
    await withRedisDeadline(multi.exec());
  } catch (error) {
    logger.warn('Smart search budget: stats not written', { error: error.message });
  }
};

let lastLoggedHour = null;

/**
 * The hour's line: written lazily, by the first decision of a new hour, for
 * the hour that has ended — no timer to stop at shutdown.
 *
 * @param {Date} now
 */
const logHourIfTurned = (now) => {
  const hour = hourIndexOf(now);
  if (lastLoggedHour === hour) return;
  const ended = lastLoggedHour;
  lastLoggedHour = hour;
  if (ended === null || !redisClient.isReady) return;
  withRedisDeadline(redisClient.hGetAll(`${KEY_PREFIX}:stat:h:${ended}`))
    .then((stats) => {
      logger.info('smart_search_budget_hourly', {
        hourStartedAt: new Date(ended * HOUR_MS).toISOString(),
        ...Object.fromEntries(STAT_FIELDS.map((field) => [field, Number(stats?.[field] ?? 0)])),
        deniedNoRedisSinceStart: processTallies.deniedNoRedis,
      });
    })
    .catch(() => {});
};

/**
 * Record a refusal decided before any reservation (junk).
 *
 * @param {'junk'} reason
 * @param {Date} [now]
 */
export const recordDenial = async (reason, now = new Date()) => {
  logHourIfTurned(now);
  logDenial(reason);
  await bumpStats({ [DENIAL_STAT[reason]]: 1 }, now);
};

/**
 * Record a parse served by the cache or by a parse already in flight.
 *
 * @param {Date} [now]
 */
export const recordCacheHit = async (now = new Date()) => {
  logHourIfTurned(now);
  await bumpStats({ cache_hits: 1 }, now);
};

/**
 * Reserve a phrase's calls.
 *
 * Granted: call the model, then `settle(outcomes)` with what each attempt
 * returned (`'ok'`, `'http_402'`, `'timeout'`, …) — it gives back the calls
 * not made and counts the ones made. Refused: nothing is left reserved.
 *
 * @param {{ requester?: { tier: string, identifier: string }, now?: Date }} [options]
 * @returns {Promise<{ allowed: true, settle: (outcomes: string[]) => Promise<void> }
 *   | { allowed: false, reason: 'no_redis'|'new_phrases'|'hourly_cap'|'daily_cap' }>}
 */
export const reserveModelCalls = async ({ requester = null, now = new Date() } = {}) => {
  logHourIfTurned(now);
  const caps = resolveBudgetCaps();
  const keys = keysAt(now, requester);

  const noRedis = (details) => {
    processTallies.deniedNoRedis += 1;
    logDenial('no_redis', details);
    return { allowed: false, reason: 'no_redis' };
  };

  // isReady and its own MULTI: incrementWithExpiry answers «1» when Redis is
  // away, which here would read as «within budget».
  if (!redisClient.isReady) {
    return noRedis({ redisReady: false });
  }

  let hourCalls;
  let dayCalls;
  let phrases;
  try {
    const multi = redisClient.multi();
    multi.set(keys.hourCalls, '0', { EX: keys.hourTtl, NX: true });
    multi.incrBy(keys.hourCalls, MAX_CALLS_PER_PHRASE);
    multi.set(keys.dayCalls, '0', { EX: keys.dayTtl, NX: true });
    multi.incrBy(keys.dayCalls, MAX_CALLS_PER_PHRASE);
    if (keys.phrases) {
      multi.set(keys.phrases, '0', { EX: keys.phrasesTtl, NX: true });
      multi.incr(keys.phrases);
    }
    const results = await withRedisDeadline(multi.exec());
    hourCalls = Number(results[1]);
    dayCalls = Number(results[3]);
    phrases = keys.phrases ? Number(results[5]) : 0;
    if (![hourCalls, dayCalls, phrases].every(Number.isFinite)) {
      throw new Error('unexpected MULTI result');
    }
  } catch (error) {
    // The reservation may or may not have landed; it is not given back — a
    // count too high is the safe side.
    return noRedis({ error: error.message });
  }

  let reason = null;
  if (caps.newPhrasesPerHour > 0 && phrases > caps.newPhrasesPerHour) {
    reason = 'new_phrases';
  } else if (caps.hourly > 0 && hourCalls > caps.hourly) {
    reason = 'hourly_cap';
  } else if (caps.daily > 0 && dayCalls > caps.daily) {
    reason = 'daily_cap';
  }

  const giveBack = async (calls, phrase) => {
    // Not ready: the MULTI would wait in the client's queue (offline queue
    // does not cover MULTI) and land on whatever Redis comes back. A count
    // left too high is the safe side.
    if ((calls <= 0 && phrase <= 0) || !redisClient.isReady) return;
    try {
      const multi = redisClient.multi();
      if (calls > 0) {
        multi.decrBy(keys.hourCalls, calls);
        multi.decrBy(keys.dayCalls, calls);
      }
      if (phrase > 0 && keys.phrases) {
        multi.decrBy(keys.phrases, phrase);
      }
      await withRedisDeadline(multi.exec());
    } catch (error) {
      logger.warn('Smart search budget: reservation not given back', { error: error.message });
    }
  };

  if (reason) {
    await giveBack(MAX_CALLS_PER_PHRASE, 1);
    logDenial(reason, { caps });
    await bumpStats({ [DENIAL_STAT[reason]]: 1 }, now);
    return { allowed: false, reason };
  }

  let settled = false;
  const settle = async (outcomes = []) => {
    if (settled) return;
    settled = true;
    const made = Math.min(outcomes.length, MAX_CALLS_PER_PHRASE);
    await giveBack(MAX_CALLS_PER_PHRASE - made, 0);
    await bumpStats({
      llm_calls: made,
      model_failed: outcomes.filter((outcome) => outcome !== 'ok').length,
      model_key_limit: outcomes.filter((outcome) => outcome === 'http_402').length,
    }, now);
  };
  return { allowed: true, settle };
};

/**
 * The `smart` block of GET /api/v1/search/health — aggregates only, no
 * phrase, no address. Counters Redis cannot be asked for are null
 * («unknown»), never 0.
 *
 * @param {{ modelAvailable: boolean, now?: Date }} options
 * @returns {Promise<Object>}
 */
export const getBudgetHealth = async ({ modelAvailable, now = new Date() }) => {
  const caps = resolveBudgetCaps();
  const keys = keysAt(now, null);
  const redisReady = redisClient.isReady === true;

  let hour = null;
  let day = null;
  let callsReserved = null;
  if (redisReady) {
    try {
      const [hourStats, dayStats, hourCalls, dayCalls] = await withRedisDeadline(Promise.all([
        redisClient.hGetAll(keys.hourStats),
        redisClient.hGetAll(keys.dayStats),
        redisClient.get(keys.hourCalls),
        redisClient.get(keys.dayCalls),
      ]));
      const shape = (stats) => Object.fromEntries(
        STAT_FIELDS.map((field) => [field, Number(stats?.[field] ?? 0)]),
      );
      hour = shape(hourStats);
      day = shape(dayStats);
      callsReserved = { hour: Number(hourCalls ?? 0), day: Number(dayCalls ?? 0) };
    } catch {
      hour = null;
      day = null;
      callsReserved = null;
    }
  }

  const capReached = callsReserved !== null && (
    // A phrase needs MAX_CALLS_PER_PHRASE free calls to be let through.
    (caps.hourly > 0 && callsReserved.hour > caps.hourly - MAX_CALLS_PER_PHRASE)
    || (caps.daily > 0 && callsReserved.day > caps.daily - MAX_CALLS_PER_PHRASE)
  );

  return {
    model_available: modelAvailable,
    redis_ready: redisReady,
    caps: {
      llm_calls_per_hour: caps.hourly,
      llm_calls_per_day: caps.daily,
      new_phrases_per_hour: caps.newPhrasesPerHour,
    },
    hour,
    day,
    // Calls held right now — made and in flight. Above llm_calls by what is in
    // flight; far above it, a reservation that timed out and landed late.
    calls_reserved: callsReserved,
    denied_no_redis_since_start: processTallies.deniedNoRedis,
    since: processTallies.since,
    degraded: modelAvailable && (!redisReady || hour === null || capReached),
  };
};

/** Tests only: forget the log throttles and the process tallies. */
export const resetBudgetProcessState = () => {
  processTallies.deniedNoRedis = 0;
  lastDenialLogAt.clear();
  capWarningsLogged.clear();
  lastLoggedHour = null;
};
