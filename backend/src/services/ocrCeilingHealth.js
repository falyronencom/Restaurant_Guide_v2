/**
 * The `recognition` block of GET /api/v1/search/health — what the ceiling of
 * menu recognition did, day by day (thread «Потолок распознавания: малые
 * правки», finding 3; the Coordinator's choice, option Б, 08.11.2026).
 *
 * Why. The ceiling of pages a Minsk day (services/ocrAllowance.js) keeps the
 * model key's month for everybody, and when it is spent, partners' menus are not
 * recognised until the next day. Until this block a refusal went only to the
 * log, and the Coordinator heard of it from a partner. Now the day and the seven
 * before it are here — the pages counted against the ceiling and the refusals by
 * kind — and the Friday watchdog (backend/scripts/openrouter-usage/watch.js,
 * workflow «Расход OpenRouter») turns red when the ceiling refused a file in
 * the week. A refusal by an account's own share is shown and wakes nobody: that
 * is the share doing its work.
 *
 * Aggregates only — the endpoint answers without sign-in: no account, no file,
 * no card, no money. Counters Redis cannot be asked for are null («unknown»),
 * never 0, as in the `smart` block (services/smartSearchBudget.js).
 *
 * Read on every request, one MGET under the Redis deadline: the counters are
 * the limits' own (dailyOcrCeilingKey) and the refusals' (dailyOcrRefusalKey),
 * kept CEILING_HISTORY_DAYS past their day.
 */

import redisClient, { withRedisDeadline } from '../config/redis.js';
import logger from '../utils/logger.js';
import { minskDate } from '../utils/minskDay.js';
import {
  CEILING_HISTORY_DAYS,
  REFUSAL_KINDS,
  dailyOcrCeilingKey,
  dailyOcrPageCeiling,
  dailyOcrRefusalKey,
} from './ocrAllowance.js';

/** Minsk keeps UTC+3 all year: a day back is 24 hours back. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** A counter as Redis holds it: a whole number, none — 0; anything else is not a count. */
const countOf = (value) => {
  if (value === null || value === undefined) return 0;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};

/**
 * The block.
 *
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{
 *   ceiling_pages: number,
 *   ceiling_reached: boolean|null,
 *   redis_ready: boolean,
 *   days: Array<{ date: string, pages_counted: number|null, refusals: Object<string, number|null> }>|null,
 * }>}
 *   ceiling_pages — the ceiling now (OCR_DAILY_PAGE_CEILING or the code's);
 *   ceiling_reached — today's pages have reached it: the doors are closed;
 *   days — today first, then the CEILING_HISTORY_DAYS before it: the pages
 *   counted against the ceiling (read for a partner's request, retries
 *   included; the moderator's approval, the operator's scripts and the seed
 *   house are not counted) and the refusals by kind (REFUSAL_KINDS);
 *   null when Redis could not be asked
 */
export const getRecognitionHealth = async ({ now = new Date() } = {}) => {
  const ceiling = dailyOcrPageCeiling();
  const redisReady = redisClient.isReady === true;
  const unknown = { ceiling_pages: ceiling, ceiling_reached: null, redis_ready: redisReady, days: null };
  if (!redisReady) return unknown;

  const dayStarts = Array.from({ length: CEILING_HISTORY_DAYS + 1 }, (_, back) => new Date(now.getTime() - back * DAY_MS));
  const keysOfDay = (day) => [dailyOcrCeilingKey(day), ...REFUSAL_KINDS.map((kind) => dailyOcrRefusalKey(kind, day))];
  const width = 1 + REFUSAL_KINDS.length;

  let values;
  try {
    values = await withRedisDeadline(redisClient.mGet(dayStarts.flatMap(keysOfDay)));
  } catch (error) {
    logger.warn('Recognition health: the counters could not be read', { error: error.message });
    return unknown;
  }

  const days = dayStarts.map((day, index) => {
    const row = values.slice(index * width, (index + 1) * width).map(countOf);
    return {
      date: minskDate(day),
      pages_counted: row[0],
      refusals: Object.fromEntries(REFUSAL_KINDS.map((kind, k) => [kind, row[k + 1]])),
    };
  });
  const today = days[0].pages_counted;
  return {
    ceiling_pages: ceiling,
    ceiling_reached: today === null ? null : today >= ceiling,
    redis_ready: true,
    days,
  };
};
