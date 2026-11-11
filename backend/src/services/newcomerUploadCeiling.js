/**
 * The day's shared upload ceiling of the new accounts: how many files and
 * bytes the accounts that have confirmed their e-mail, but have no card in the
 * catalogue yet, may send to the cloud between them in a Minsk calendar day.
 *
 * Why (thread «2Г: общие пределы», point 1.05, 10.11.2026; the Coordinator's
 * word «Да на 1–9», 09.11.2026): the accounts without a confirmed e-mail share
 * one ceiling of the day (services/unconfirmedAllowance.js), but a confirmed
 * account left it at once and kept only its own allowance — 100 files and
 * 300 MB a day (services/uploadAllowance.js). A confirmed account costs one
 * mailbox, or a sign-in through Google; with a few dozen of them the cloud's
 * free plan (25 credits over a sliding 30 days) was gone in a day or two, and
 * the project would pay.
 *
 * Who counts here — services/unconfirmedAllowance.js uploadStanding: an
 * account with a confirmed e-mail (or phone) that is neither the seed house,
 * nor a panel account, nor the owner of a card in the catalogue (status
 * 'active': a moderator has approved it). The partners whose cards the guests
 * see never meet this ceiling, so a flood of new accounts does not stop them;
 * an honest new partner meets it only on the day of such a flood, and the
 * refusal says to go on tomorrow.
 *
 * Inside the ceiling one account spends at most its share — 40 files and
 * 120 MB a day, a fifth of the ceiling (NEWCOMER_ACCOUNT_DAILY_SHARE). With its
 * own allowance as the share, two accounts spent the day of every new partner
 * (lens review of 10.11.2026); now five are needed. Once a card of the account
 * is in the catalogue, neither the ceiling nor the share applies — its own
 * allowance does.
 *
 * Two pools of the same size, counted apart (review of 10.11.2026): the card's
 * material — the wizard's files, a card's photos and PDFs, a promotion's
 * picture — and the avatars. A guest who confirmed the e-mail has no card
 * either, and the guests' avatars must not take the day of the new partners'
 * cards, nor the partners' cards the guests' avatars; a flood through the
 * avatar stops at its own pool. An avatar replaces the one before it
 * (config/avatarDeletion.js), so its pool costs the cloud uploads, not storage.
 *
 * How: counters in Redis per Minsk day — the pool's, and the account's share in
 * it — reserved first and checked after (INCR is atomic), given back at once
 * over a limit, as the pool of the unconfirmed accounts does, next to which it
 * stands: an upload of a new account spends its own allowance and this
 * ceiling. The day's refusals of the pool are counted, so that the first one is
 * an error in the log (the operator sees that the day's ceiling was reached)
 * and the others are warnings; an account past its share is a warning.
 *
 * The ceiling can be raised without a release — UPLOAD_NEWCOMERS_DAILY_FILES
 * and UPLOAD_NEWCOMERS_DAILY_MB, whole numbers above zero (a launch day with
 * many new partners, or a paid plan); anything else keeps the default. The
 * share stays.
 *
 * Redis unavailable: no ceiling, like every allowance here (config/redis.js).
 */

import { decrement, incrementWithExpiry } from '../config/redis.js';
import { minskDate, secondsUntilMinskMidnight } from '../utils/minskDay.js';
import logger from '../utils/logger.js';

const MEGABYTE = 1024 * 1024;

/**
 * Per Minsk day and pool, for all the new accounts together — technical choice
 * of the thread's executor (delegated by the Coordinator), 10.11.2026: 200
 * files hold three or more full cards (a full card is up to 60 photos and two
 * PDFs; the seed house averaged 16 files a card), and the site saw no such day
 * before the launch. At the ceiling the cards' pool spends at most about 1.4
 * cloud credits a day (600 MB stored, 200 uploads and their three sizes — the
 * arithmetic of services/uploadAllowance.js), the avatars' pool about 0.2 (an
 * avatar replaces the one before it), the unconfirmed accounts about 0.7: some
 * eight days of a flood before the headroom of the plan (about 19.5 credits,
 * 16.10.2026) is spent — longer than the week between the cloud's usage
 * checks (.github/workflows/cloudinary-usage.yml).
 */
export const NEWCOMERS_DAILY_UPLOAD_CEILING = Object.freeze({
  files: 200,
  bytes: 600 * MEGABYTE,
});

/**
 * One account's share inside a pool of the ceiling, per Minsk day — the share
 * of an unconfirmed account (services/unconfirmedAllowance.js), so that
 * confirming the e-mail changes nothing in a new partner's day: 40 files and
 * 120 MB fill an ordinary card twice; a card of up to 60 photos is finished the
 * next day, or at once after its approval.
 */
export const NEWCOMER_ACCOUNT_DAILY_SHARE = Object.freeze({
  files: 40,
  bytes: 120 * MEGABYTE,
});

/** The pools of the ceiling: the card's material, and the avatars. */
export const NEWCOMER_POOLS = Object.freeze(['card', 'avatar']);

const VARIABLES = Object.freeze({
  files: 'UPLOAD_NEWCOMERS_DAILY_FILES',
  megabytes: 'UPLOAD_NEWCOMERS_DAILY_MB',
});

/**
 * A whole number above zero from the environment, or null.
 *
 * @param {*} raw
 * @returns {number|null}
 */
const wholeAboveZero = (raw) => {
  if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

/**
 * The ceiling of a pool now: the variables where they are whole numbers above
 * zero, otherwise the defaults.
 *
 * @param {Object} [env]
 * @returns {{ files: number, bytes: number }}
 */
export const newcomersUploadCeiling = (env = process.env) => {
  const megabytes = wholeAboveZero(env[VARIABLES.megabytes]);
  return {
    files: wholeAboveZero(env[VARIABLES.files]) ?? NEWCOMERS_DAILY_UPLOAD_CEILING.files,
    bytes: megabytes !== null ? megabytes * MEGABYTE : NEWCOMERS_DAILY_UPLOAD_CEILING.bytes,
  };
};

/**
 * A pool's counters for the Minsk day of `now`.
 *
 * @param {Date} now
 * @param {'card'|'avatar'} [pool]
 * @returns {{ files: string, bytes: string, refusals: string }}
 */
export const newcomersKeys = (now, pool = 'card') => {
  const day = minskDate(now);
  return {
    files: `uploads:newcomers:${day}:${pool}:files`,
    bytes: `uploads:newcomers:${day}:${pool}:bytes`,
    refusals: `uploads:newcomers:${day}:${pool}:refusals`,
  };
};

/**
 * One account's counters of its share in a pool, for the Minsk day of `now`.
 *
 * @param {string} userId
 * @param {Date} now
 * @param {'card'|'avatar'} [pool]
 * @returns {{ files: string, bytes: string }}
 */
export const newcomerAccountKeys = (userId, now, pool = 'card') => {
  const day = minskDate(now);
  return {
    files: `uploads:newcomers:${day}:${pool}:account:${userId}:files`,
    bytes: `uploads:newcomers:${day}:${pool}:account:${userId}:bytes`,
  };
};

/**
 * Reserve one file of `bytes` from a pool of the new accounts' ceiling of
 * today, and from the account's share in it.
 *
 * Granted: `giveBack` returns the reservation (once is enough, more is a
 * no-op). Refused: the reservation is already given back; the result names the
 * limits that refused — the pool's, or the account's share — and when they
 * renew (Minsk midnight).
 *
 * @param {string} userId
 * @param {number} bytes
 * @param {'card'|'avatar'} [pool] - Anything else counts as the card's
 * @returns {Promise<{ granted: true, giveBack: () => Promise<void> }
 *   | { granted: false, limits: { files: number, bytes: number }, retryAfter: number, resetAt: string }>}
 */
export const reserveNewcomerUpload = async (userId, bytes, pool = 'card') => {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const counted = NEWCOMER_POOLS.includes(pool) ? pool : 'card';
  const keys = newcomersKeys(now, counted);
  const own = newcomerAccountKeys(userId, now, counted);
  const secondsLeft = secondsUntilMinskMidnight(now);

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
    // An empty file added nothing (uploadAllowance.js, the same reason).
    if (bytes > 0) {
      await decrement(keys.bytes, bytes);
      await decrement(own.bytes, bytes);
    }
  };

  const ceiling = newcomersUploadCeiling();
  const share = NEWCOMER_ACCOUNT_DAILY_SHARE;
  const overCeiling = files > ceiling.files || total > ceiling.bytes;
  if (!overCeiling && ownFiles <= share.files && ownTotal <= share.bytes) {
    return { granted: true, giveBack };
  }

  await giveBack();
  const limits = overCeiling ? ceiling : share;
  if (overCeiling) {
    const refusals = await incrementWithExpiry(keys.refusals, secondsLeft);
    logger[refusals === 1 ? 'error' : 'warn']('New accounts\' daily upload ceiling spent', {
      userId,
      pool: counted,
      files,
      bytes: total,
      filesCeiling: ceiling.files,
      bytesCeiling: ceiling.bytes,
      refusalsToday: refusals,
    });
  } else {
    // The account's own share: the others' day is untouched — a warning only.
    logger.warn('New account\'s share of the daily upload ceiling spent', {
      userId,
      pool: counted,
      ownFiles,
      ownBytes: ownTotal,
    });
  }
  return {
    granted: false,
    limits: { files: limits.files, bytes: limits.bytes },
    retryAfter: secondsLeft,
    // Minsk midnight: whole seconds from the current second
    resetAt: new Date((Math.floor(nowMs / 1000) + secondsLeft) * 1000).toISOString(),
  };
};
