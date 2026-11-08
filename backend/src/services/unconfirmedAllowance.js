/**
 * The day's shared allowance of all unconfirmed accounts together: how many
 * files, bytes, recognition jobs and pages of recognition the accounts that
 * have not confirmed their e-mail may spend between them in a Minsk calendar
 * day.
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
 * - recognition jobs — 20: a job is a menu photo or a whole PDF. They hold the
 *   one queue of every partner. A full card's menu is up to 32 jobs, so a new
 *   partner may see part of the menu recognised only after confirming the
 *   e-mail or after the card's approval (the moderator's approval queues what
 *   was not recognised — services/adminService.js);
 * - pages of recognition — 40 (technical choice of the thread «Общий потолок
 *   распознавания», delegated by the Coordinator, November 2026): a photo is a
 *   page, a PDF as many as are read of it. They hold the money: twenty jobs
 *   could be four hundred pages. Forty pages cost about 40 cents a day, up to
 *   about $2 if dense, and throwaway accounts that need no mailbox leave the
 *   rest of the ceiling of all accounts (services/ocrAllowance.js) to the
 *   others.
 */
export const UNCONFIRMED_DAILY_LIMITS = Object.freeze({
  files: 100,
  bytes: 300 * MEGABYTE,
  ocrJobs: 20,
  ocrPages: 40,
});

/**
 * The share of one unconfirmed account inside the shared ceiling, per Minsk
 * day, so that one account cannot spend the day of all the others (review of
 * the thread, 03.11.2026): 40 files and 120 MB fill an ordinary card twice
 * (the seed house averaged 16 files a card); 10 recognition jobs are a
 * menu of ten photos or ten PDFs; 20 pages are one PDF as long as the
 * recognition reads, as it read for a new partner until pages were counted.
 * Past it the refusal asks to confirm the e-mail, which lifts both.
 */
export const UNCONFIRMED_ACCOUNT_DAILY_LIMITS = Object.freeze({
  files: 40,
  bytes: 120 * MEGABYTE,
  ocrJobs: 10,
  ocrPages: 20,
});

/**
 * The shared counters for the Minsk day of `now`.
 *
 * @param {Date} now
 * @returns {{ files: string, bytes: string, ocrJobs: string, ocrPages: string }}
 */
export const unconfirmedKeys = (now) => {
  const day = minskDate(now);
  return {
    files: `unconfirmed:daily:${day}:files`,
    bytes: `unconfirmed:daily:${day}:bytes`,
    ocrJobs: `unconfirmed:daily:${day}:ocr_jobs`,
    ocrPages: `unconfirmed:daily:${day}:ocr_pages`,
  };
};

/**
 * One unconfirmed account's counters of its share, for the Minsk day of `now`.
 *
 * @param {string} userId
 * @param {Date} now
 * @returns {{ files: string, bytes: string, ocrJobs: string, ocrPages: string }}
 */
export const unconfirmedAccountKeys = (userId, now) => {
  const day = minskDate(now);
  return {
    files: `unconfirmed:daily:${day}:account:${userId}:files`,
    bytes: `unconfirmed:daily:${day}:account:${userId}:bytes`,
    ocrJobs: `unconfirmed:daily:${day}:account:${userId}:ocr_jobs`,
    ocrPages: `unconfirmed:daily:${day}:account:${userId}:ocr_pages`,
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

  const own = unconfirmedAccountKeys(userId, now);

  const files = await incrementWithExpiry(keys.files, secondsLeft);
  const total = await incrementWithExpiry(keys.bytes, secondsLeft, bytes);
  const ownFiles = await incrementWithExpiry(own.files, secondsLeft);
  const ownTotal = await incrementWithExpiry(own.bytes, secondsLeft, bytes);

  let given = false;
  const giveBack = async () => {
    if (given) return;
    given = true;
    await decrement(keys.files);
    await decrement(own.files);
    if (bytes > 0) {
      await decrement(keys.bytes, bytes);
      await decrement(own.bytes, bytes);
    }
  };

  const shared = UNCONFIRMED_DAILY_LIMITS;
  const share = UNCONFIRMED_ACCOUNT_DAILY_LIMITS;
  const overShared = files > shared.files || total > shared.bytes;
  if (overShared || ownFiles > share.files || ownTotal > share.bytes) {
    await giveBack();
    const limits = overShared ? shared : share;
    logger.warn('Unconfirmed accounts\' daily upload ceiling spent', {
      userId, files, bytes: total, ownFiles, ownBytes: ownTotal, shared: overShared,
    });
    return {
      granted: false,
      limits: { files: limits.files, bytes: limits.bytes },
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
  const ownKey = unconfirmedAccountKeys(userId, now).ocrJobs;
  const secondsLeft = secondsUntilMinskMidnight(now);

  const jobs = await incrementWithExpiry(key, secondsLeft);
  const ownJobs = await incrementWithExpiry(ownKey, secondsLeft);

  let given = false;
  const giveBack = async () => {
    if (given) return;
    given = true;
    await decrement(key);
    await decrement(ownKey);
  };

  const overShared = jobs > UNCONFIRMED_DAILY_LIMITS.ocrJobs;
  if (overShared || ownJobs > UNCONFIRMED_ACCOUNT_DAILY_LIMITS.ocrJobs) {
    await giveBack();
    const limit = overShared ? UNCONFIRMED_DAILY_LIMITS.ocrJobs : UNCONFIRMED_ACCOUNT_DAILY_LIMITS.ocrJobs;
    logger.warn('Unconfirmed accounts\' daily recognition ceiling spent', {
      userId, jobs, ownJobs, limit, shared: overShared,
    });
    return {
      granted: false,
      jobs: overShared ? jobs : ownJobs,
      limit,
      ...renewal(nowMs, secondsLeft),
    };
  }

  return { granted: true, giveBack };
};

/**
 * Where a page read for an unconfirmed account is counted, next to what every
 * account's page is counted against (services/ocrAllowance.js).
 *
 * @param {string} userId
 * @param {Date} now
 * @returns {Array<{ pot: 'unconfirmed', key: string, limit: number }>}
 */
export const unconfirmedPagePots = (userId, now) => [
  { pot: 'unconfirmed', key: unconfirmedKeys(now).ocrPages, limit: UNCONFIRMED_DAILY_LIMITS.ocrPages },
  {
    pot: 'unconfirmed',
    key: unconfirmedAccountKeys(userId, now).ocrPages,
    limit: UNCONFIRMED_ACCOUNT_DAILY_LIMITS.ocrPages,
  },
];

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
