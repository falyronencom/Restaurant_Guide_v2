/**
 * Refresh-token pruning policy
 *
 * The refresh_tokens table had no reaper: nothing ever deleted a row. Rows
 * outlive their usefulness three ways — the 30-day expiry passes, rotation or
 * logout burns them (used_at), or a rotation dies between the successor INSERT
 * and the atomic claim and leaves a successor nobody holds the string of
 * (authService.refreshAccessToken, since 5ede30c). All three accumulate
 * forever.
 *
 * ONE criterion, decided by the Coordinator 2026-09-13: expiry, plus a
 * retention tail. Not because the other two are hard to express, but because
 * expiry already covers them and the alternatives are unsafe:
 *
 *   - A burned row is what makes a replay detectable at all, so deleting one
 *     early turns a security alert into INVALID_REFRESH_TOKEN. Pruning by
 *     expiry never touches an unexpired burned row: it keeps every one of them
 *     for the full 30 days, four orders of magnitude past the 60-second reuse
 *     grace window (config/auth.js).
 *   - An orphaned successor CANNOT be identified early. It carries used_at
 *     IS NULL and no referrer — and so does a perfectly live token the user
 *     simply has not spent yet, which happens routinely for the 4 hours an
 *     access token lives and for all 30 days if the app is not opened. Any
 *     "used_at IS NULL and older than X" predicate logs real users out. The
 *     orphan waits for its expiry like everything else.
 *
 * What pruning by expiry costs: presenting a token old enough to be pruned
 * answers INVALID_TOKEN instead of TOKEN_EXPIRED. Both are 401 and no client
 * separates them — web branches on the status alone (lib/auth/session.ts),
 * mobile and admin-web never name either code. Checked by reading, 2026-09-10.
 *
 * It costs one thing in the logs, which is worth knowing because the retention
 * tail below was partly bought for them: such a presentation now takes the
 * "Refresh token not found" branch, whose metadata is a prefix of the token
 * string, instead of "Expired refresh token used", whose metadata is the
 * userId. Past the tail there is no longer a row to name the user from
 * (authService.refreshAccessToken).
 *
 * Pure: reads the env object it is given, never process.env, and returns the
 * warnings instead of logging them — server.js logs them at startup.
 */

/**
 * Coordinator decision 2026-09-13. Days to keep a row AFTER its expires_at.
 *
 * Zero would also be correct on security grounds — an expired row is already
 * inert, because refreshAccessToken checks the expiry BEFORE the reuse branch
 * and so can never raise a reuse alert from one. The tail buys two things
 * instead: a week to answer "why was I logged out", and slack against the
 * clock axis. expires_at is a `timestamp without time zone` written from a JS
 * Date, i.e. in the process's local wall clock; a process and a database in
 * different zones disagree about "now" by up to 14 hours. The cutoff below is
 * built on the process clock precisely so that disagreement cannot arise
 * (see buildPruneCutoff), and the tail is what keeps a future caller that
 * reaches for SQL NOW() from deleting anything early.
 */
export const DEFAULT_RETENTION_DAYS = 7;

/**
 * Ceiling for a configured retention. Not a security boundary — a typo guard,
 * mirroring config/auth.js: an extra digit must not silently pin the table at
 * a year of dead rows. A value above this is clamped with a warning.
 */
export const MAX_RETENTION_DAYS = 365;

/** Housekeeping, not a queue: hourly is far more often than 7 days needs. */
export const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** Below a minute the prune would spend more time waking up than working. */
export const MIN_INTERVAL_MS = 60 * 1000;

/**
 * Rows per DELETE. The point of batching is lock duration: the first run on a
 * table that has never been pruned could otherwise match everything at once
 * and hold row locks across the whole sweep. A thousand rows is a few
 * milliseconds of work and a lock nobody notices.
 */
export const BATCH_SIZE = 1000;

/**
 * Batches per tick. Bounds how long one cycle can run — the tick must be able
 * to finish inside the graceful-shutdown budget, which on Railway is the drain
 * period and defaults to zero (config/shutdown.js). At BATCH_SIZE this drains
 * 50 000 rows per hour; a backlog larger than that simply takes more ticks.
 */
export const MAX_BATCHES_PER_TICK = 50;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Strict non-negative integer parse: '7' → 7; undefined, '', '7d', '-1' and
 * '7e0' → null. Strictness matters — a typo must fall back to the default,
 * not become 0 and silently delete rows the moment they expire.
 *
 * @param {*} value
 * @returns {number|null}
 */
const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
};

/**
 * Resolve the pruning policy from the environment.
 *
 * @param {Object} [env] - Environment map (process.env in production)
 * @returns {{ retentionDays: number, intervalMs: number, warnings: string[] }}
 */
export const resolveRefreshTokenPrunePolicy = (env = {}) => {
  const warnings = [];

  let retentionDays = DEFAULT_RETENTION_DAYS;
  const rawRetention = env.REFRESH_TOKEN_RETENTION_DAYS;
  if (rawRetention !== undefined && rawRetention !== null && String(rawRetention).trim() !== '') {
    const parsed = parseNonNegativeInt(rawRetention);
    if (parsed === null) {
      warnings.push(
        `REFRESH_TOKEN_RETENTION_DAYS is not a non-negative integer (${rawRetention}): ` +
        `falling back to ${DEFAULT_RETENTION_DAYS} days — ` +
        'set it to 0 if rows are meant to go the moment they expire',
      );
    } else if (parsed > MAX_RETENTION_DAYS) {
      warnings.push(
        `REFRESH_TOKEN_RETENTION_DAYS ${parsed} exceeds the ${MAX_RETENTION_DAYS}-day ceiling ` +
        'and was clamped to it',
      );
      retentionDays = MAX_RETENTION_DAYS;
    } else {
      retentionDays = parsed;
    }
  }

  let intervalMs = DEFAULT_INTERVAL_MS;
  const rawInterval = env.REFRESH_TOKEN_PRUNE_INTERVAL_MS;
  if (rawInterval !== undefined && rawInterval !== null && String(rawInterval).trim() !== '') {
    const parsed = parseNonNegativeInt(rawInterval);
    if (parsed === null) {
      warnings.push(
        `REFRESH_TOKEN_PRUNE_INTERVAL_MS is not a non-negative integer (${rawInterval}): ` +
        `falling back to ${DEFAULT_INTERVAL_MS} ms`,
      );
    } else if (parsed < MIN_INTERVAL_MS) {
      warnings.push(
        `REFRESH_TOKEN_PRUNE_INTERVAL_MS ${parsed} ms is below the ${MIN_INTERVAL_MS} ms floor ` +
        'and was raised to it',
      );
      intervalMs = MIN_INTERVAL_MS;
    } else {
      intervalMs = parsed;
    }
  }

  return { retentionDays, intervalMs, warnings };
};

/**
 * The cutoff a prune compares expires_at against, as a JS Date.
 *
 * A Date, deliberately, and not SQL NOW(). expires_at is written by
 * generateTokenPair from a JS Date into a `timestamp without time zone`, so it
 * carries the PROCESS's local wall clock; SQL NOW() returns the DATABASE
 * session's. On this project those differ — the database sessions run Etc/UTC
 * while CI pins the process to Europe/Minsk on purpose — and comparing the two
 * would shift every verdict by that offset, silently. node-pg serialises the
 * Date below through the same local-wall-clock convention that wrote the
 * column, so both sides of the comparison are on one clock by construction.
 * This is the same rule handleReusedToken follows in the other direction:
 * used_at is written by SQL NOW(), so used_at is compared in SQL.
 *
 * @param {number} retentionDays - Days to keep a row past its expires_at
 * @param {number} [nowMs=Date.now()] - Injectable clock for tests
 * @returns {Date}
 */
export const buildPruneCutoff = (retentionDays, nowMs = Date.now()) =>
  new Date(nowMs - retentionDays * MS_PER_DAY);
