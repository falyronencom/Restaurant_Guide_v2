/**
 * The daily upload allowance of an account: how many files, and how many bytes,
 * one account may send to the cloud in a Minsk calendar day.
 *
 * Why (decision of the Coordinator, 17.10.2026 — «по твоей рекомендации»):
 * every upload is stored in Cloudinary for good, as sent (no incoming
 * transformation), and the plan is the free one — 25 credits over a sliding
 * 30 days, one credit about a gigabyte stored, with no alert on spending
 * (panel check 16.10.2026: 5.48 of 25 used). Until then nothing but the
 * global limiter (100 requests a minute per account) stood between one
 * account and the whole month's quota: a hundred 60 MB menus a minute.
 *
 * Who counts: every upload of a file to the cloud, through one allowance per
 * account — the wizard's upload (routes/v1/tempMediaRoutes.js, PR #54), the
 * card's media (mediaService), a promotion's picture (promotionService) and
 * the avatar (authController.uploadAvatar); the Coordinator's word of
 * 17.10.2026 on the second three: one counter, so that switching uploaders
 * does not open a fresh allowance. Each sends through sendWithinDailyAllowance.
 *
 * What is counted: a file the server is about to send to the cloud — after
 * every check of the file itself has passed, right before the cloud call. A
 * file refused for its type or size costs nothing; so does one the cloud
 * refused for certain — its reservation goes back. After a timeout or a 5xx
 * the reservation stays spent: the file may be stored all the same
 * (config/cloudinary.js cloudRefusedUpload; the review quota's rule).
 *
 * How: two counters in Redis per account and Minsk day — files and bytes. The
 * reservation is taken first and checked after, as the review quota does
 * (reviewService, critics' pack 1, point 5): INCR is atomic, so parallel
 * uploads at the edge cannot all read «one left» and all pass. A reservation
 * over the limit is given back at once. The day is Minsk's (utils/minskDay.js,
 * the review quota's day): the counters carry the date in their name and
 * expire at Minsk midnight, so a reservation given back after midnight
 * returns to its own day, never to the new one.
 *
 * Whose limits: every account gets the regular ones — a panel account too,
 * which reaches only the avatar; the seed house (users.is_service_account —
 * config/serviceAccounts.js), the account the catalogue is filled through,
 * gets its own, higher ones. The service flag is read from the database only
 * once an account has passed the regular limits — every other upload costs no
 * query.
 *
 * Redis unavailable: the upload goes on without a limit, like every limiter
 * here (config/redis.js answers «first increment» and skips the give-back).
 *
 * Accepted (review 17.10.2026): a Redis failure between the reservation and
 * its give-back can take back what was never added — the day's count of that
 * account comes out short by at most one file; and while the service flag is
 * looked up, an over-limit reservation still stands, so a second upload of
 * the same account at that moment can be refused although one place remains.
 */

import { cloudRefusedUpload } from '../config/cloudinary.js';
import pool from '../config/database.js';
import { decrement, incrementWithExpiry } from '../config/redis.js';
import { serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { AppError } from '../middleware/errorHandler.js';
import { minskDate, secondsUntilMinskMidnight } from '../utils/minskDay.js';
import logger from '../utils/logger.js';

const MEGABYTE = 1024 * 1024;

/**
 * Per Minsk day. The numbers: recommended and approved by the Coordinator on
 * 17.10.2026 («Согласен со всеми рекомендациями по PR #54»). Cloudinary's
 * billing documentation: a credit is a
 * gigabyte stored, or 1000 transformations; every upload is one
 * transformation, every size of it shown for the first time one more (the
 * route hands out three sizes of a photo).
 * - regular: a full card is 30 photos of the place, 30 of the menu
 *   (MEDIA_LIMITS) and two menu PDFs in the app — 100 files is a full card
 *   with room to replace photos, or six ordinary ones (the seed house averaged
 *   16 files a card, 1.8 MB a file); 300 MB holds a full card of large photos
 *   sent from the site. At the limit an account spends at most about 0.7
 *   credits a day — 300 MB stored, 100 uploads and their three sizes — so it
 *   needs about four weeks of hitting the limit every day to use up the
 *   headroom (about 19.5 credits on 16.10.2026); before the limit, an hour;
 * - service: the seed house uploaded 409 files, 734 MB, by 11.10.2026
 *   (snapshot of production); a busy day of entering cards — 30–40 cards,
 *   about 16 files each — is 500–650 files, about 1.2 GB.
 */
export const DAILY_UPLOAD_LIMITS = Object.freeze({
  regular: Object.freeze({ files: 100, bytes: 300 * MEGABYTE }),
  service: Object.freeze({ files: 1000, bytes: 3 * 1024 * MEGABYTE }),
});

/**
 * The account's two counters for the Minsk day of `now`.
 *
 * @param {string} userId
 * @param {Date} now
 * @returns {{ files: string, bytes: string }}
 */
export const dailyUploadKeys = (userId, now) => {
  const day = minskDate(now);
  return {
    files: `uploads:daily:${userId}:${day}:files`,
    bytes: `uploads:daily:${userId}:${day}:bytes`,
  };
};

const exceeds = (limits, files, bytes) => files > limits.files || bytes > limits.bytes;

/**
 * Whether the account is the seed house. A failed lookup reads as «no»: the
 * account is held to the regular limits, which only the seed house passes.
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
const isServiceAccount = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT ${serviceAccountFlagSql('users')} AS is_service_account FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.is_service_account === true;
  } catch (error) {
    logger.error('Upload allowance: service flag lookup failed, regular limits apply', {
      error: error.message,
      userId,
    });
    return false;
  }
};

/**
 * Reserve one file of `bytes` from the account's allowance for today.
 *
 * Granted: the file may go to the cloud; `giveBack` returns the reservation —
 * call it when the cloud refused the file for certain (once is enough, more is
 * a no-op). Refused: the reservation is already given back; the result names
 * the limits held and when they renew (Minsk midnight).
 *
 * @param {string} userId
 * @param {number} bytes - Size of the file, bytes
 * @returns {Promise<{ granted: true, giveBack: () => Promise<void> }
 *   | { granted: false, limits: { files: number, bytes: number }, retryAfter: number, resetAt: string }>}
 */
export const reserveDailyUpload = async (userId, bytes) => {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const keys = dailyUploadKeys(userId, now);
  const secondsLeft = secondsUntilMinskMidnight(now);

  const files = await incrementWithExpiry(keys.files, secondsLeft);
  const total = await incrementWithExpiry(keys.bytes, secondsLeft, bytes);

  let given = false;
  const giveBack = async () => {
    if (given) return;
    given = true;
    await decrement(keys.files);
    // An empty file added nothing; DECRBY 0 on a counter that has expired
    // would bring it back at zero, with no expiry.
    if (bytes > 0) {
      await decrement(keys.bytes, bytes);
    }
  };

  let limits = DAILY_UPLOAD_LIMITS.regular;
  if (exceeds(limits, files, total) && await isServiceAccount(userId)) {
    limits = DAILY_UPLOAD_LIMITS.service;
  }

  if (exceeds(limits, files, total)) {
    await giveBack();
    logger.warn('Daily upload allowance spent', {
      userId,
      files,
      bytes: total,
      filesLimit: limits.files,
      bytesLimit: limits.bytes,
    });
    return {
      granted: false,
      limits,
      retryAfter: secondsLeft,
      // Minsk midnight: whole seconds from the current second
      resetAt: new Date((Math.floor(nowMs / 1000) + secondsLeft) * 1000).toISOString(),
    };
  }

  return { granted: true, giveBack };
};

/**
 * A spent allowance, as every uploader answers it: 429 RATE_LIMIT_EXCEEDED —
 * the code of every limit, the review quota's too — with the uploader's own
 * sentence. errorHandler sends `details` (the limits held and when they
 * renew) and a Retry-After header from `retryAfter`.
 */
export class DailyUploadLimitError extends AppError {
  /**
   * @param {string} message - The sentence the uploader's clients read
   * @param {{ limits: { files: number, bytes: number }, retryAfter: number, resetAt: string }} refusal
   */
  constructor(message, refusal) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', {
      files_limit: refusal.limits.files,
      bytes_limit: refusal.limits.bytes,
      retry_after: refusal.retryAfter,
      reset_at: refusal.resetAt,
    });
    this.retryAfter = refusal.retryAfter;
  }
}

/**
 * Send a checked file to the cloud within the account's daily allowance: the
 * reservation comes first, then `send`. A spent allowance throws
 * DailyUploadLimitError and `send` is never called. A `send` that fails
 * rethrows; the reservation goes back only when the cloud refused the file
 * for certain (cloudRefusedUpload) — after a timeout or a 5xx the file may be
 * stored all the same, so the reservation stays spent.
 *
 * @param {{ userId: string, bytes: number, message: string }} upload - Whose
 *   allowance, the file's size, and the sentence a refusal carries
 * @param {() => Promise<Object>} send - The cloud call
 * @returns {Promise<Object>} What `send` returned
 * @throws {DailyUploadLimitError} When the allowance is spent
 */
export const sendWithinDailyAllowance = async ({ userId, bytes, message }, send) => {
  const allowance = await reserveDailyUpload(userId, bytes);
  if (!allowance.granted) {
    throw new DailyUploadLimitError(message, allowance);
  }

  try {
    return await send();
  } catch (error) {
    if (cloudRefusedUpload(error)) {
      await allowance.giveBack();
    }
    throw error;
  }
};
