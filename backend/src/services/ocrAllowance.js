/**
 * The daily allowances of menu recognition, per Minsk calendar day: the jobs a
 * partner's requests may queue, and the pages that may be read. The jobs hold
 * the queue, the pages hold the money.
 *
 * Why jobs (review of PR #56; the Coordinator's word of 17.10.2026): recognition
 * is paid per call — a menu photo is a vision call and a structurer call to
 * OpenRouter, every page of a PDF the same — and it runs in one queue for every
 * partner, one job at a time (ocr/ocrJobPoller.js). A card's save queued a file
 * that the save named anew without any upload behind it, so neither the daily
 * upload allowance (services/uploadAllowance.js) nor the five restarts a day of
 * retry-ocr held it: a few saves a minute could queue hundreds of jobs and keep
 * every other partner's menu waiting.
 *
 * Why pages (thread «Общий потолок распознавания», November 2026): the model key
 * is one for recognition and the smart search. A fresh account with a confirmed
 * throwaway mailbox had a hundred jobs a day of its own, each of them a PDF of up
 * to twenty pages: one person could spend the key's month in minutes, and
 * recognition and the smart search would stop for everybody until its limit
 * renewed. Now the pages read are counted: by account, by all the regular
 * accounts together — the ceiling — and, for the accounts that have not confirmed
 * their e-mail, by those accounts together (services/unconfirmedAllowance.js).
 *
 * When pages are counted: when they are about to be read, and only then. How many
 * pages a PDF has is known only when its job runs, after its download and parse
 * and before the first model call; when a card is saved the file is only a link.
 * A photo is one page, a PDF as many as are read of it (ocr/ocrService.js, up to
 * PDF_PAGE_LIMIT). Every attempt of a job takes its pages again: every attempt is
 * paid for. Only the first attempt can be refused: a file already begun goes on
 * to its retries, or a provider's failure would cost a big file all of them and
 * the last attempt's fallback too. So the day's reads can pass the ceiling, at most
 * threefold and only if every job fails; the doors are closed from then on. A job
 * that was removed before it ran, or was refused, spends no page. It spent its
 * job, though, and a job is not given back: what the day's jobs hold is exactly
 * a file refused and queued again without end.
 *
 * Who counts: every job queued on a partner's request — a new card's menu
 * (establishmentService.createEstablishment), a menu file added in an edit
 * (updateEstablishment) or uploaded to a card (mediaService), the partner's
 * restart (partnerMenuItemService.retryOcr) — one allowance per account, so
 * that one door does not open a fresh allowance for another. Not counted, and
 * never refused: the moderator's approval (adminService queues what was never
 * recognised — a person has looked at the card) and the operator's scripts. The
 * seed house has its own limit of jobs; its pages are not counted either.
 * tests/unit/ocrEnqueueDoors.test.js holds the list.
 *
 * A file whose job is already pending or processing costs nothing — that job is
 * returned, as OcrJobModel.enqueue returns it.
 *
 * How: counters in Redis per Minsk day, reserved first and checked after — the
 * upload allowance's technique: INCR is atomic, so parallel saves at the edge
 * cannot all read «one left» and all pass. Over a limit the reservation is given
 * back at once and a line goes to the log. The counters carry the date in their
 * names and expire at Minsk midnight (utils/minskDay.js).
 *
 * What a refusal does. At a door — the account's jobs are spent, or the day's
 * pages are spent already (spentPagesRefusal): nothing is queued; the save or the
 * upload that asked is not refused — the file stays on the card, its recognition
 * can be restarted the next day, and the moderator's approval reads it anyway.
 * When the job first runs — its pages do not fit what is left: the job fails for
 * good before any model call and the partner is told the service is unavailable
 * for now (ocr/failureReason.js). The file is not read in part: half a menu looks
 * like a whole one.
 *
 * Whose limits: every account gets the regular one; the seed house
 * (users.is_service_account), the account the catalogue is filled through,
 * gets its own, higher one of jobs. That limit reads the flag from the database
 * only once an account has passed the regular one.
 *
 * Redis unavailable: jobs are queued and read without a limit, like every limiter
 * here (config/redis.js answers «first increment» and skips the give-back).
 *
 * Accepted: pages are counted before the call and are not given back when it
 * fails, and their number comes from the file itself: the count can be higher
 * than what was paid, the safe side. Two requests queuing the same file at the
 * same moment can both find no active job and both reserve; the second may then
 * get the first's job back from OcrJobModel.enqueue and keep its reservation — the
 * day's count of that account comes out one higher. On the last attempt a failed
 * image read falls back to the text layer in one structurer call
 * (ocr/ocrService.js), inside the pages already counted.
 */

import pool from '../config/database.js';
import { decrement, getCounter, incrementWithExpiry } from '../config/redis.js';
import { serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { RATE_LIMIT_MESSAGE } from '../constants/rateLimitRefusal.js';
import { AppError } from '../middleware/errorHandler.js';
import * as OcrJobModel from '../models/ocrJobModel.js';
import { minskDate, secondsUntilMinskMidnight } from '../utils/minskDay.js';
import logger from '../utils/logger.js';
import { RECOGNITION_CEILING_MESSAGE } from './ocr/failureReason.js';
import { reserveUnconfirmedOcrJob, unconfirmedPagePots } from './unconfirmedAllowance.js';

/**
 * The error code of a job whose pages did not fit: processJob fails the job for
 * good by it.
 */
export const RECOGNITION_CEILING = 'RECOGNITION_CEILING';

/**
 * Jobs per Minsk day. Approved by the Coordinator on 17.10.2026 (PR #59).
 * A job costs about a cent a photo or a page at the price of
 * google/gemini-3.8-flash on 17.10.2026 ($0.825 a million tokens in, $4.125
 * out; measured 28.09.2026: ≈ 1 950 tokens in and ≈ 1 700–1 950 out for the
 * two calls of a page), a dense page up to about five; a PDF is read up to
 * its first PDF_PAGE_LIMIT pages (ocr/ocrService.js).
 * - regular: a full card's menu is 30 photos and two PDFs — 32 jobs
 *   (MEDIA_LIMITS); 100 is a full card and two restarts of it, or the menus
 *   of three cards, and the same number as the files the account may upload
 *   a day. What an account costs is held by its pages (below);
 * - service: the seed house enters 30–40 cards on a busy day, several menu
 *   files each — a few hundred jobs; 1000 is the number of files it may
 *   upload a day. Its pages are not counted.
 */
export const DAILY_OCR_JOB_LIMITS = Object.freeze({ regular: 100, service: 1000 });

/**
 * Pages per Minsk day for all the regular accounts together — the Coordinator's
 * decision (thread «Общий потолок распознавания», November 2026). At the price
 * of google/gemini-3.8-flash on 06.11.2026 (the numbers above, unchanged) a page
 * costs about a cent, a dense one up to about five. The menus read in 2026 (110
 * files of 28 cards; the digital set of 19 places, 86 pages) run to four or five
 * pages, the largest a card can hold to 70. OCR_DAILY_PAGE_CEILING changes the
 * number without a release.
 */
export const DAILY_OCR_PAGE_CEILING = 100;

const CEILING_VARIABLE = 'OCR_DAILY_PAGE_CEILING';

/**
 * The pages one regular account may have read per Minsk day, at most: 100, as many
 * as it may queue jobs, and at most half of the ceiling (accountPageLimit), so
 * that one account cannot spend the day of all the others. Technical choice of the
 * thread, delegated by the Coordinator.
 */
export const DAILY_OCR_ACCOUNT_PAGE_LIMIT = 100;

/**
 * The ceiling now: the variable when it is a whole number above zero, otherwise
 * the default (as services/mailAllowance.js reads its own).
 *
 * @param {Object} [env]
 * @returns {number}
 */
export const dailyOcrPageCeiling = (env = process.env) => {
  const raw = env[CEILING_VARIABLE];
  if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return DAILY_OCR_PAGE_CEILING;
};

/**
 * A regular account's limit of pages under a ceiling.
 *
 * @param {number} ceiling
 * @returns {number}
 */
export const accountPageLimit = (ceiling) => Math.min(DAILY_OCR_ACCOUNT_PAGE_LIMIT, Math.ceil(ceiling / 2));

/**
 * The account's counter of jobs for the Minsk day of `now`.
 *
 * @param {string} userId
 * @param {Date} now
 * @returns {string}
 */
export const dailyOcrJobKey = (userId, now) => `ocr:daily:${userId}:${minskDate(now)}:jobs`;

/**
 * The account's counter of pages for the Minsk day of `now`.
 *
 * @param {string} userId
 * @param {Date} now
 * @returns {string}
 */
export const dailyOcrPagesKey = (userId, now) => `ocr:daily:${userId}:${minskDate(now)}:pages`;

/**
 * The counter of pages of all the regular accounts for the Minsk day of `now`.
 *
 * @param {Date} now
 * @returns {string}
 */
export const dailyOcrCeilingKey = (now) => `ocr:ceiling:${minskDate(now)}:pages`;

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
 * Whether the account is the seed house and whether it has confirmed its e-mail
 * or phone. A failed lookup reads as a regular unconfirmed account, the stricter
 * answer.
 *
 * @param {string} userId
 * @returns {Promise<{ service: boolean, unconfirmed: boolean }>}
 */
const accountStanding = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT (email_verified OR phone_verified) AS confirmed,
              ${serviceAccountFlagSql('users')} AS is_service_account
       FROM users WHERE id = $1`,
      [userId],
    );
    const service = result.rows[0]?.is_service_account === true;
    return { service, unconfirmed: !service && result.rows[0]?.confirmed !== true };
  } catch (error) {
    logger.error('Recognition allowance: account lookup failed, the limits of an unconfirmed account apply', {
      error: error.message,
      userId,
    });
    return { service: false, unconfirmed: true };
  }
};

/**
 * Where a page read for a regular account is counted.
 *
 * @param {string} userId
 * @param {boolean} unconfirmed
 * @param {Date} now
 * @returns {Array<{ pot: 'account'|'unconfirmed'|'ceiling', key: string, limit: number }>}
 */
const pagePots = (userId, unconfirmed, now) => {
  const ceiling = dailyOcrPageCeiling();
  return [
    { pot: 'account', key: dailyOcrPagesKey(userId, now), limit: accountPageLimit(ceiling) },
    ...(unconfirmed ? unconfirmedPagePots(userId, now) : []),
    { pot: 'ceiling', key: dailyOcrCeilingKey(now), limit: ceiling },
  ];
};

/**
 * What a refusal by pages says: what refused, the count, the limit held and when it
 * renews (Minsk midnight).
 *
 * @param {string} pot
 * @param {number} pages
 * @param {number} limit
 * @param {number} nowMs
 * @returns {{ granted: false, pot: string, pages: number, limit: number, retryAfter: number, resetAt: string }}
 */
const pagesRefusal = (pot, pages, limit, nowMs) => {
  const secondsLeft = secondsUntilMinskMidnight(new Date(nowMs));
  return {
    granted: false,
    pot,
    pages,
    limit,
    retryAfter: secondsLeft,
    // Minsk midnight: whole seconds from the current second
    resetAt: new Date((Math.floor(nowMs / 1000) + secondsLeft) * 1000).toISOString(),
  };
};

/**
 * Whether the day's pages are spent for this account already — a look, nothing is
 * taken: a door queues nothing then. Whether a file's pages fit is decided when
 * they are known (takePagesForAttempt).
 *
 * @param {string} userId
 * @param {boolean} unconfirmed
 * @returns {Promise<ReturnType<typeof pagesRefusal>|null>} The refusal, or null while pages are left
 */
const spentPagesRefusal = async (userId, unconfirmed) => {
  const nowMs = Date.now();
  const pots = pagePots(userId, unconfirmed, new Date(nowMs));
  // All at once: a half-open Redis costs one deadline, not one for each.
  const counts = await Promise.all(pots.map(({ key }) => getCounter(key)));
  const spent = pots.findIndex(({ limit }, index) => counts[index] >= limit);
  return spent === -1 ? null : pagesRefusal(pots[spent].pot, counts[spent], pots[spent].limit, nowMs);
};

/**
 * Take the pages an attempt of a job is about to read — called once their number
 * is known, before the first model call; called for the jobs a partner's request
 * queued. Not enough left anywhere, on the job's first attempt: nothing stays
 * taken, and the attempt ends with code RECOGNITION_CEILING. A later attempt is
 * counted and goes on (the header says why).
 *
 * @param {{ userId: string, pages: number, attempt: number, jobId: string, mediaId: string }} attempt
 *   `userId` — the account the job counts against; `attempt` — the job's attempts,
 *   as pickNextPending counted them
 * @returns {Promise<void>}
 * @throws {Error} code RECOGNITION_CEILING
 */
export const takePagesForAttempt = async ({
  userId, pages, attempt, jobId, mediaId,
}) => {
  const standing = await accountStanding(userId);
  if (standing.service) return;

  const nowMs = Date.now();
  const now = new Date(nowMs);
  const secondsLeft = secondsUntilMinskMidnight(now);

  const mayRefuse = attempt <= 1;
  const taken = [];
  for (const { pot, key, limit } of pagePots(userId, standing.unconfirmed, now)) {
    const count = await incrementWithExpiry(key, secondsLeft, pages);
    taken.push(key);
    if (mayRefuse && count > limit) {
      for (const takenKey of taken) {
        await decrement(takenKey, pages);
      }
      logger.warn('Recognition pages of the day do not fit: file not read', {
        userId,
        jobId,
        mediaId,
        filePages: pages,
        attempt,
        refusedBy: pot,
        pages: count,
        pagesLimit: limit,
      });
      throw Object.assign(new Error(RECOGNITION_CEILING_MESSAGE), { code: RECOGNITION_CEILING });
    }
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

const NOTHING_TO_GIVE_BACK = async () => {};

/**
 * Queue the recognition of a menu file on a partner's request, within the
 * day's allowances. A file whose job is already pending or processing costs
 * nothing: that job is returned. A spent allowance queues nothing and writes a
 * line to the log; the caller decides what its client hears (a save or an upload
 * goes on, a restart with nothing queued is refused —
 * partnerMenuItemService.retryOcr). A failed queuing gives the reservation back
 * and rethrows.
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

  const standing = await accountStanding(userId);

  if (!standing.service) {
    const spent = await spentPagesRefusal(userId, standing.unconfirmed);
    if (spent) {
      logger.warn('Recognition pages of the day spent: job not queued', {
        userId,
        establishmentId,
        mediaId,
        refusedBy: spent.pot,
        pages: spent.pages,
        pagesLimit: spent.limit,
      });
      return { queued: false, refusal: spent };
    }
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

  // An unconfirmed account spends the shared ceiling of the day too
  // (services/unconfirmedAllowance.js).
  const shared = standing.unconfirmed
    ? await reserveUnconfirmedOcrJob(userId)
    : { granted: true, giveBack: NOTHING_TO_GIVE_BACK };
  if (!shared.granted) {
    await allowance.giveBack();
    logger.warn("Unconfirmed accounts' recognition ceiling spent: job not queued", {
      userId,
      establishmentId,
      mediaId,
    });
    return { queued: false, refusal: shared };
  }

  try {
    const job = await OcrJobModel.enqueue({
      establishmentId,
      mediaId,
      ...(standing.service ? {} : { countedFor: userId }),
    });
    return { queued: true, job };
  } catch (error) {
    await allowance.giveBack();
    await shared.giveBack();
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
   * @param {{ limit: number, pot?: string, retryAfter: number, resetAt: string }} refusal -
   *   `pot` — a refusal by pages
   */
  constructor(refusal) {
    super(RATE_LIMIT_MESSAGE, 429, 'RATE_LIMIT_EXCEEDED', {
      [refusal.pot ? 'pages_limit' : 'jobs_limit']: refusal.limit,
      retry_after: refusal.retryAfter,
      reset_at: refusal.resetAt,
    });
    this.retryAfter = refusal.retryAfter;
  }
}
