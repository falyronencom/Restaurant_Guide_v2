/**
 * The project's daily mail allowance: how many letters of each kind the whole
 * project may hand to the mail provider in a Minsk calendar day.
 *
 * Why (thread «Расходы посторонних», point 2, 03.11.2026): the provider's plan
 * is the free one — 100 letters a day for the whole project (Resend panel,
 * 03.11.2026). Every registration by e-mail sends a code, and nothing but the
 * per-account and per-address limits stood between a flood of registrations
 * and those 100: once they were spent, no one got a code or a password-reset
 * link until the next day, and the undelivered letters weighed on the
 * sender's standing.
 *
 * Two kinds, each with its own allowance, so that a flood of one does not
 * spend the other:
 * - code — the e-mail confirmation code, at registration and on a resend;
 * - reset — the password-reset link.
 * Together they stay under the provider's 100, with room for a letter sent by
 * hand.
 *
 * How: one counter in Redis per kind and Minsk day, reserved first and
 * checked after (INCR is atomic, as in services/uploadAllowance.js). Over the
 * allowance the letter is not sent and the reservation stays — the day is
 * spent anyway, and the count past the allowance tells the first refusal of
 * the day, logged as an error (the operator sees the day's allowance spent),
 * from the next ones, logged as warnings. A letter the provider
 * refused gives its reservation back; one whose outcome is unknown (no answer
 * in time) keeps it. The counter carries the date in its name and expires at
 * Minsk midnight (utils/minskDay.js).
 *
 * The allowances can be raised without a release — EMAIL_DAILY_CODE_LIMIT and
 * EMAIL_DAILY_RESET_LIMIT, whole numbers above zero (a paid plan); anything
 * else keeps the default.
 *
 * Redis unavailable: letters go out without the allowance, like every
 * allowance here (config/redis.js answers «first increment» and skips the
 * give-back); the per-account limits in the database still hold.
 */

import { decrement, incrementWithExpiry } from '../config/redis.js';
import { minskDate, secondsUntilMinskMidnight } from '../utils/minskDay.js';
import logger from '../utils/logger.js';

/**
 * Letters per Minsk day, by kind. 50 codes is several times the registrations
 * of a busy day before the launch; 40 links leave room for every person who
 * forgot a password that day; 90 together stay under the provider's 100.
 */
export const DAILY_MAIL_LIMITS = Object.freeze({ code: 50, reset: 40 });

const LIMIT_VARIABLES = Object.freeze({
  code: 'EMAIL_DAILY_CODE_LIMIT',
  reset: 'EMAIL_DAILY_RESET_LIMIT',
});

/**
 * The allowance of a kind: the variable when it is a whole number above zero,
 * otherwise the default.
 *
 * @param {'code'|'reset'} kind
 * @param {Object} [env]
 * @returns {number}
 */
export const dailyMailLimit = (kind, env = process.env) => {
  const raw = env[LIMIT_VARIABLES[kind]];
  if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return DAILY_MAIL_LIMITS[kind];
};

/**
 * The counter of a kind for the Minsk day of `now`.
 *
 * @param {'code'|'reset'} kind
 * @param {Date} now
 * @returns {string}
 */
export const dailyMailKey = (kind, now) => `mail:daily:${kind}:${minskDate(now)}`;

/**
 * Reserve one letter of a kind from today's allowance.
 *
 * Granted: the letter may go; `giveBack` returns the reservation (once is
 * enough, more is a no-op). Refused: nothing to give back.
 *
 * @param {'code'|'reset'} kind
 * @param {{ userId?: string }} [context] - Named in the refusal's log line
 * @returns {Promise<{ granted: true, giveBack: () => Promise<void> }
 *   | { granted: false, limit: number }>}
 */
export const reserveDailyMail = async (kind, { userId } = {}) => {
  const now = new Date();
  const key = dailyMailKey(kind, now);
  const count = await incrementWithExpiry(key, secondsUntilMinskMidnight(now));

  let given = false;
  const giveBack = async () => {
    if (given) return;
    given = true;
    await decrement(key);
  };

  const limit = dailyMailLimit(kind);
  if (count > limit) {
    const level = count === limit + 1 ? 'error' : 'warn';
    logger[level]('Daily mail allowance spent: letter not sent', {
      kind,
      limit,
      userId,
      reason: 'DAILY_LIMIT',
    });
    return { granted: false, limit };
  }

  return { granted: true, giveBack };
};
