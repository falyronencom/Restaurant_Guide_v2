/**
 * The daily recognition allowance of an account: how many menu files one
 * account may send to recognition in a Minsk calendar day.
 *
 * Why (review of PR #56 by the resource-exhaustion lens, finding 1; the
 * Coordinator's word of 17.10.2026): recognition is paid per call — a menu
 * photo is a vision call and a structurer call to OpenRouter, every page of a
 * PDF the same — and it runs in one queue for every partner, one job at a
 * time (ocr/ocrJobPoller.js). A card's save queued a file that the save named
 * anew without any upload behind it, so neither the daily upload allowance
 * (services/uploadAllowance.js) nor the five restarts a day of retry-ocr held
 * it: a few saves a minute could queue hundreds of jobs and keep every other
 * partner's menu waiting.
 *
 * Who counts: every job queued on a partner's request — a new card's menu
 * (establishmentService.createEstablishment), a menu file added in an edit
 * (updateEstablishment) or uploaded to a card (mediaService), the partner's
 * restart (partnerMenuItemService.retryOcr) — one allowance per account, so
 * that one door does not open a fresh allowance for another. Not counted: the
 * moderator's approval (adminService queues what was never recognised) and
 * the operator's scripts. tests/unit/ocrEnqueueDoors.test.js holds the list.
 *
 * What is counted: a job queued. A file whose job is already pending or
 * processing costs nothing — that job is returned, as OcrJobModel.enqueue
 * returns it.
 *
 * How: one counter in Redis per account and Minsk day, reserved first and
 * checked after — the upload allowance's technique: INCR is atomic, so
 * parallel saves at the edge cannot all read «one left» and all pass. Over
 * the limit the reservation is given back at once, nothing is queued and a
 * line goes to the log; the save or the upload that asked is not refused —
 * the file stays on the card, and its recognition can be restarted the next
 * day. The counter carries the date in its name and expires at Minsk
 * midnight (utils/minskDay.js).
 *
 * Whose limits: every account gets the regular one; the seed house
 * (users.is_service_account), the account the catalogue is filled through,
 * gets its own, higher one. The flag is read from the database only once an
 * account has passed the regular limit.
 *
 * Redis unavailable: jobs are queued without a limit, like every limiter here
 * (config/redis.js answers «first increment» and skips the give-back).
 *
 * Accepted: two requests queuing the same file at the same moment can both
 * find no active job and both reserve; the second may then get the first's
 * job back from OcrJobModel.enqueue and keep its reservation — the day's count
 * of that account comes out one higher.
 */

import pool from '../config/database.js';
import { decrement, incrementWithExpiry } from '../config/redis.js';
import { serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { RATE_LIMIT_MESSAGE } from '../constants/rateLimitRefusal.js';
import { AppError } from '../middleware/errorHandler.js';
import * as OcrJobModel from '../models/ocrJobModel.js';
import { minskDate, secondsUntilMinskMidnight } from '../utils/minskDay.js';
import logger from '../utils/logger.js';

/**
 * Jobs per Minsk day. Proposed to the Coordinator on 17.10.2026 — awaiting
 * the word. A job costs about a cent a photo or a page at the price of
 * google/gemini-3.8-flash on 17.10.2026 ($0.825 a million tokens in, $4.125
 * out; measured 28.09.2026: ≈ 1 950 tokens in and ≈ 1 700–1 950 out for the
 * two calls of a page), a dense page up to about five; a PDF is read up to
 * its first PDF_PAGE_LIMIT pages (ocr/ocrService.js).
 * - regular: a full card's menu is 30 photos and two PDFs — 32 jobs
 *   (MEDIA_LIMITS); 100 is a full card and two restarts of it, or the menus
 *   of three cards, and the same number as the files the account may upload
 *   a day. At the limit an account costs about a dollar a day in photos, and
 *   at most about eighteen in PDFs of twenty ordinary pages;
 * - service: the seed house enters 30–40 cards on a busy day, several menu
 *   files each — a few hundred jobs; 1000 is the number of files it may
 *   upload a day.
 */
export const DAILY_OCR_JOB_LIMITS = Object.freeze({ regular: 100, service: 1000 });

/**
 * The account's counter for the Minsk day of `now`.
 *
 * @param {string} userId
 * @param {Date} now
 * @returns {string}
 */
export const dailyOcrJobKey = (userId, now) => `ocr:daily:${userId}:${minskDate(now)}:jobs`;

/**
 * Whether the account is the seed house. A failed lookup reads as «no»: the
 * account is held to the regular limit, which only the seed house passes.
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
    logger.error('Recognition allowance: service flag lookup failed, the regular limit applies', {
      error: error.message,
      userId,
    });
    return false;
  }
};

/**
 * Reserve one job from the account's allowance for today.
 *
 * Granted: a job may be queued; `giveBack` returns the reservation — call it
 * when the job was not queued after all (once is enough, more is a no-op).
 * Refused: the reservation is already given back; the result names the count
 * it would have reached, the limit held and when it renews (Minsk midnight).
 *
 * @param {string} userId
 * @returns {Promise<{ granted: true, giveBack: () => Promise<void> }
 *   | { granted: false, jobs: number, limit: number, retryAfter: number, resetAt: string }>}
 */
export const reserveDailyOcrJob = async (userId) => {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const key = dailyOcrJobKey(userId, now);
  const secondsLeft = secondsUntilMinskMidnight(now);

  const jobs = await incrementWithExpiry(key, secondsLeft);

  let given = false;
  const giveBack = async () => {
    if (given) return;
    given = true;
    await decrement(key);
  };

  let limit = DAILY_OCR_JOB_LIMITS.regular;
  if (jobs > limit && await isServiceAccount(userId)) {
    limit = DAILY_OCR_JOB_LIMITS.service;
  }

  if (jobs > limit) {
    await giveBack();
    return {
      granted: false,
      jobs,
      limit,
      retryAfter: secondsLeft,
      // Minsk midnight: whole seconds from the current second
      resetAt: new Date((Math.floor(nowMs / 1000) + secondsLeft) * 1000).toISOString(),
    };
  }

  return { granted: true, giveBack };
};

/**
 * Queue the recognition of a menu file on a partner's request, within the
 * account's daily allowance. A file whose job is already pending or
 * processing costs nothing: that job is returned. A spent allowance queues
 * nothing and writes a line to the log; the caller decides what its client
 * hears (a save or an upload goes on, a restart with nothing queued is
 * refused — partnerMenuItemService.retryOcr). A failed queuing gives the
 * reservation back and rethrows.
 *
 * @param {{ userId: string, establishmentId: string, mediaId: string }} request -
 *   Whose allowance, and the card and the file to recognise
 * @returns {Promise<{ queued: true, job: Object } | { queued: false, refusal: Object }>}
 */
export const enqueueWithinDailyAllowance = async ({ userId, establishmentId, mediaId }) => {
  const active = await OcrJobModel.findActiveJob(mediaId);
  if (active) {
    return { queued: true, job: active };
  }

  const allowance = await reserveDailyOcrJob(userId);
  if (!allowance.granted) {
    logger.warn('Daily recognition allowance spent: job not queued', {
      userId,
      establishmentId,
      mediaId,
      jobs: allowance.jobs,
      jobsLimit: allowance.limit,
    });
    return { queued: false, refusal: allowance };
  }

  try {
    const job = await OcrJobModel.enqueue({ establishmentId, mediaId });
    return { queued: true, job };
  } catch (error) {
    await allowance.giveBack();
    throw error;
  }
};

/**
 * A restart that queued nothing because the allowance is spent: 429
 * RATE_LIMIT_EXCEEDED — the code of every limit — with the limiters' sentence
 * (approved, constants/rateLimitRefusal.js): the restart's screens show their own
 * words for any 429 (the app: «Лимит перезапусков исчерпан. Повторите через …»
 * from Retry-After), so no new text is needed. errorHandler sends `details`
 * (the limit held and when it renews) and a Retry-After header from
 * `retryAfter`.
 */
export class DailyOcrLimitError extends AppError {
  /**
   * @param {{ limit: number, retryAfter: number, resetAt: string }} refusal
   */
  constructor(refusal) {
    super(RATE_LIMIT_MESSAGE, 429, 'RATE_LIMIT_EXCEEDED', {
      jobs_limit: refusal.limit,
      retry_after: refusal.retryAfter,
      reset_at: refusal.resetAt,
    });
    this.retryAfter = refusal.retryAfter;
  }
}
