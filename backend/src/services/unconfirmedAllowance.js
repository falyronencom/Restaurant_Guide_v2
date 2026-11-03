/**
 * The day's shared allowance of all unconfirmed accounts together: how many
 * files, bytes and recognition jobs the accounts that have not confirmed
 * their e-mail may spend between them in a Minsk calendar day.
 *
 * Why (thread «Расходы посторонних», point 3; the Coordinator's word of
 * 03.11.2026, «Пока потолок, потом А»): an account can be made in a minute,
 * and each new one had a fresh daily allowance of its own
 * (services/uploadAllowance.js, services/ocrAllowance.js) — uploads to the
 * cloud and menu recognition, both paid. Now the accounts that have not
 * confirmed their e-mail also share one ceiling for the day. An honest new
 * partner fills a card well under it; a flood of throwaway accounts stops at
 * it, and the confirmed accounts never meet it. Confirming the e-mail —
 * and signing in through Google or Yandex, which confirms it — takes an
 * account out of the ceiling at once. The rule «paid actions after the
 * confirmation» (variant A) is a later change, not this one.
 *
 * Who is unconfirmed: an account with neither the e-mail nor the phone
 * confirmed, and not the seed house (users.is_service_account). An account
 * registered by phone has no way to confirm it yet and stays under the
 * ceiling. A failed lookup counts the account as unconfirmed — the stricter
 * answer, as the service flag's lookup does.
 *
 * How: counters in Redis per Minsk day, shared by all unconfirmed accounts,
 * reserved first and checked after (INCR is atomic), given back at once over
 * the ceiling — as the per-account allowances do, and next to them: an
 * upload or a job of an unconfirmed account spends both. Redis unavailable:
 * no ceiling, like every allowance here (config/redis.js).
 */

import pool from '../config/database.js';
import { decrement, incrementWithExpiry } from '../config/redis.js';
import { serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { minskDate, secondsUntilMinskMidnight } from '../utils/minskDay.js';
import logger from '../utils/logger.js';

const MEGABYTE = 1024 * 1024;

/**
 * Per Minsk day, for all unconfirmed accounts together — technical choice of
 * the thread's executor (delegated by the Coordinator), 03.11.2026:
 * - files and bytes — one regular account's daily upload allowance (100 files,
 *   300 MB): a full card and more, at most about 0.7 cloud credits a day;
 * - recognition jobs — 10: a new card's menu is a few photos or one PDF; at
 *   about a cent a photo or a page, ten jobs cost cents to about two dollars
 *   a day at most (PDFs of twenty pages), against a model key of five
 *   dollars a month.
 */
export const UNCONFIRMED_DAILY_LIMITS = Object.freeze({
  files: 100,
  bytes: 300 * MEGABYTE,
  ocrJobs: 10,
});

/**
 * The shared counters for the Minsk day of `now`.
 *
 * @param {Date} now
 * @returns {{ files: string, bytes: string, ocrJobs: string }}
 */
export const unconfirmedKeys = (now) => {
  const day = minskDate(now);
  return {
    files: `unconfirmed:daily:${day}:files`,
    bytes: `unconfirmed:daily:${day}:bytes`,
    ocrJobs: `unconfirmed:daily:${day}:ocr_jobs`,
  };
};

/**
 * Whether the account has not confirmed its e-mail (nor its phone) and is not
 * the seed house. A failed lookup reads as «unconfirmed».
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const isUnconfirmedAccount = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT (email_verified OR phone_verified OR ${serviceAccountFlagSql('users')}) AS confirmed
       FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.confirmed !== true;
  } catch (error) {
    logger.error('Unconfirmed accounts allowance: account lookup failed, the shared ceiling applies', {
      error: error.message,
      userId,
    });
    return true;
  }
};

/**
 * When the day renews: whole seconds left and the moment, Minsk midnight.
 *
 * @param {number} nowMs
 * @param {number} secondsLeft
 * @returns {{ retryAfter: number, resetAt: string }}
 */
const renewal = (nowMs, secondsLeft) => ({
  retryAfter: secondsLeft,
  resetAt: new Date((Math.floor(nowMs / 1000) + secondsLeft) * 1000).toISOString(),
});

/**
 * Reserve one file of `bytes` from the shared ceiling of today.
 *
 * @param {string} userId - Named in the refusal's log line
 * @param {number} bytes
 * @returns {Promise<{ granted: true, giveBack: () => Promise<void> }
 *   | { granted: false, limits: { files: number, bytes: number }, retryAfter: number, resetAt: string }>}
 */
export const reserveUnconfirmedUpload = async (userId, bytes) => {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const keys = unconfirmedKeys(now);
  const secondsLeft = secondsUntilMinskMidnight(now);

  const files = await incrementWithExpiry(keys.files, secondsLeft);
  const total = await incrementWithExpiry(keys.bytes, secondsLeft, bytes);

  let given = false;
  const giveBack = async () => {
    if (given) return;
    given = true;
    await decrement(keys.files);
    if (bytes > 0) {
      await decrement(keys.bytes, bytes);
    }
  };

  const { files: filesLimit, bytes: bytesLimit } = UNCONFIRMED_DAILY_LIMITS;
  if (files > filesLimit || total > bytesLimit) {
    await giveBack();
    logger.warn('Unconfirmed accounts\' daily upload ceiling spent', {
      userId, files, bytes: total, filesLimit, bytesLimit,
    });
    return {
      granted: false,
      limits: { files: filesLimit, bytes: bytesLimit },
      ...renewal(nowMs, secondsLeft),
    };
  }

  return { granted: true, giveBack };
};

/**
 * Reserve one recognition job from the shared ceiling of today.
 *
 * @param {string} userId - Named in the refusal's log line
 * @returns {Promise<{ granted: true, giveBack: () => Promise<void> }
 *   | { granted: false, jobs: number, limit: number, retryAfter: number, resetAt: string }>}
 */
export const reserveUnconfirmedOcrJob = async (userId) => {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const key = unconfirmedKeys(now).ocrJobs;
  const secondsLeft = secondsUntilMinskMidnight(now);

  const jobs = await incrementWithExpiry(key, secondsLeft);

  let given = false;
  const giveBack = async () => {
    if (given) return;
    given = true;
    await decrement(key);
  };

  const limit = UNCONFIRMED_DAILY_LIMITS.ocrJobs;
  if (jobs > limit) {
    await giveBack();
    logger.warn('Unconfirmed accounts\' daily recognition ceiling spent', { userId, jobs, limit });
    return { granted: false, jobs, limit, ...renewal(nowMs, secondsLeft) };
  }

  return { granted: true, giveBack };
};

const NOTHING_TO_GIVE_BACK = async () => {};

/**
 * The shared part of an upload: from the ceiling when the account is
 * unconfirmed, nothing otherwise (granted, nothing to give back).
 *
 * @param {string} userId
 * @param {number} bytes
 * @returns {ReturnType<typeof reserveUnconfirmedUpload>}
 */
export const reserveSharedUpload = async (userId, bytes) => (
  await isUnconfirmedAccount(userId)
    ? reserveUnconfirmedUpload(userId, bytes)
    : { granted: true, giveBack: NOTHING_TO_GIVE_BACK }
);

/**
 * The shared part of a recognition job: from the ceiling when the account is
 * unconfirmed, nothing otherwise.
 *
 * @param {string} userId
 * @returns {ReturnType<typeof reserveUnconfirmedOcrJob>}
 */
export const reserveSharedOcrJob = async (userId) => (
  await isUnconfirmedAccount(userId)
    ? reserveUnconfirmedOcrJob(userId)
    : { granted: true, giveBack: NOTHING_TO_GIVE_BACK }
);
