/**
 * The product's calendar day is Minsk's (Europe/Minsk, UTC+3 all year — no DST
 * since 2011). The process clock is not this clock: production runs UTC, CI
 * pins Europe/Minsk (see bookingModel.js), so the day boundary is computed
 * through Intl for the named zone and never through the process offset.
 *
 * First use: the review quota — 10 reviews per Minsk calendar day, reset at
 * Minsk midnight (decision of the Coordinator 11.10.2026, closing 23.09 #26).
 * Second: the daily upload allowance (services/uploadAllowance.js), whose
 * counters carry the day in their name (minskDate).
 */

export const MINSK_TIME_ZONE = 'Europe/Minsk';

const wallClockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MINSK_TIME_ZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const calendarParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MINSK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The Minsk calendar date of `now`, as YYYY-MM-DD.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export const minskDate = (now = new Date()) => {
  const parts = Object.fromEntries(
    calendarParts.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * Seconds from `now` until the next midnight in Minsk — at least 1, at most
 * 86400 (exactly 86400 at midnight itself, when a new day has just begun).
 *
 * @param {Date} [now]
 * @returns {number}
 */
export const secondsUntilMinskMidnight = (now = new Date()) => {
  const parts = Object.fromEntries(
    wallClockParts.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  // Intl may print midnight as "24" in some engines for hour12:false.
  const hour = Number(parts.hour) % 24;
  const elapsed = hour * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return Math.max(1, 86400 - elapsed);
};
