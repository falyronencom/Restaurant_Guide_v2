import { getConfig } from '../config/openrouter.js';
import logger from '../utils/logger.js';

/**
 * How much of the server's OpenRouter key is left — the `model_key` block of
 * GET /api/v1/search/health (directive D8 of 28.10.2026, item 12 of the list
 * of that day; the way chosen by Trunk the same day).
 *
 * Why. The smart search and the recognition of menus call the models with one
 * key (config/openrouter.js), and the key has a spending limit. When it is
 * spent, the smart search quietly turns classic and every menu fails. The
 * weekly watchdog (backend/scripts/openrouter-usage/, its workflow
 * openrouter-usage.yml) reads this block and turns red while there is still
 * time — without a secret of its own: the server asks about its own key, and
 * the key never leaves Railway. The account's balance is not read: that takes
 * a management key, whose leak would cost the whole balance and the server's
 * key (Trunk, 28.10.2026).
 *
 * The source — GET <base>/key with the server's key
 * (https://openrouter.ai/docs/api-reference/limits): `limit` (null — no
 * limit), `limit_remaining`, `limit_reset` (null — never resets), `usage`.
 * A free call, not a model's.
 *
 * The endpoint answers without sign-in, so the block says only shares, never
 * money: the percent left, rounded down to a whole one, whether and how the
 * limit resets, when it was read. A failure is `unknown` with a code — never
 * 0, never the provider's text.
 *
 * Asked at most once per CACHE_MS (a failure — once per FAILURE_CACHE_MS),
 * one request at a time for the whole process. The health endpoint waits for
 * a fresh answer at most WAIT_MS and otherwise answers what it had: the
 * endpoint must stay quick, whatever OpenRouter does.
 */

/** A read answer stands this long. */
export const CACHE_MS = 10 * 60 * 1000;

/** A failure stands this long — a passing fault should not hide the key for 10 minutes. */
export const FAILURE_CACHE_MS = 60 * 1000;

/** The request's own deadline. */
export const REQUEST_TIMEOUT_MS = 10 * 1000;

/** The health endpoint waits for a refresh no longer than this. */
export const WAIT_MS = 3 * 1000;

const state = {
  /** @type {null | { block: Object, at: number }} */
  cached: null,
  /** @type {null | Promise<void>} */
  inFlight: null,
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const unknown = (reason) => ({
  status: 'unknown',
  remaining_percent: null,
  limit_reset: null,
  checked_at: null,
  unknown_reason: reason,
});

/**
 * The block for an answer of GET /key.
 *
 * @param {*} body - The answer's JSON
 * @param {Date} now
 * @returns {Object}
 */
export const blockFromAnswer = (body, now) => {
  const data = body?.data;
  if (!data || typeof data !== 'object') return unknown('bad_answer');
  const reset = data.limit_reset;
  if (reset !== null && reset !== undefined && typeof reset !== 'string') return unknown('bad_answer');
  // Only a word goes out: the provider's text is not echoed by a public endpoint.
  const limitReset = typeof reset === 'string' ? (/^[a-z_]{1,20}$/.test(reset) ? reset : 'other') : null;
  const checkedAt = now.toISOString();

  if (data.limit === null) {
    return { status: 'unlimited', remaining_percent: null, limit_reset: limitReset, checked_at: checkedAt, unknown_reason: null };
  }
  if (!isNumber(data.limit) || data.limit <= 0 || !isNumber(data.limit_remaining)) return unknown('bad_answer');
  const share = Math.max(0, Math.min(data.limit_remaining, data.limit)) / data.limit;
  return {
    status: 'ok',
    // Down to a whole percent: a whole threshold compares the same as on the
    // exact share (29.9 → 29 < 30, 30.4 → 30), and fewer digits go public.
    remaining_percent: Math.floor(share * 100 + 1e-9),
    limit_reset: limitReset,
    checked_at: checkedAt,
    unknown_reason: null,
  };
};

/**
 * Ask OpenRouter about the server's key; the block, never an exception.
 *
 * @param {{ fetchImpl?: Function, now?: () => Date }} [options]
 * @returns {Promise<Object>}
 */
export const readKeyBlock = async ({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) => {
  const { apiKey, baseUrl } = getConfig();
  if (!apiKey) return unknown('no_key');
  try {
    const response = await fetchImpl(`${baseUrl}/key`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('OpenRouter key status: the answer is an error', { status: response.status });
      return unknown(`http_${response.status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return unknown('bad_answer');
    }
    const block = blockFromAnswer(body, now());
    if (block.status === 'unknown') logger.warn('OpenRouter key status: the answer has no limit to read');
    return block;
  } catch (error) {
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network';
    logger.warn('OpenRouter key status: no answer', { reason, error: error?.message });
    return unknown(reason);
  }
};

const isFresh = (cached, nowMs) => cached !== null
  && nowMs - cached.at < (cached.block.status === 'unknown' ? FAILURE_CACHE_MS : CACHE_MS);

/**
 * The `model_key` block. A fresh one is answered at once; otherwise one
 * refresh is started (or joined) and waited for up to waitMs. A refresh that
 * outlives the wait finishes on its own and serves the next request; until
 * then the previous block is answered, or `unknown` / `checking` before the
 * first.
 *
 * @param {{ fetchImpl?: Function, now?: () => Date, waitMs?: number }} [options]
 * @returns {Promise<Object>}
 */
export const getKeyHealth = async ({ fetchImpl, now = () => new Date(), waitMs = WAIT_MS } = {}) => {
  if (isFresh(state.cached, now().getTime())) return state.cached.block;

  if (!state.inFlight) {
    state.inFlight = readKeyBlock({ fetchImpl, now })
      .then((block) => {
        state.cached = { block, at: now().getTime() };
      })
      .finally(() => {
        state.inFlight = null;
      });
  }
  let timer;
  const waited = new Promise((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  try {
    await Promise.race([state.inFlight, waited]);
  } finally {
    clearTimeout(timer);
  }
  return state.cached?.block ?? unknown('checking');
};

/** Tests only: forget the cached block and the request in flight. */
export const resetKeyHealthState = () => {
  state.cached = null;
  state.inFlight = null;
};
