/**
 * How the loop that empties a deleted account's avatar folder runs
 * (services/avatarDeletionLoop.js).
 *
 * Pure: reads the env object it is given and returns the warnings instead of
 * logging them, as config/refreshTokenPrune.js does.
 */

/**
 * One account per tick, one tick a minute: the rate limit of the Admin API
 * holds by construction, with no counter that a restart would reset. An account
 * costs three listings (one per resource type), so at most 180 calls an hour of
 * the 500 the plan allows (scripts/media-orphans-audit.js), and the deploy's
 * immediate tick adds three more. The destroy of each file goes through the
 * Upload API and does not count. Fixed on purpose: a variable here could only
 * break that sum.
 */
export const TICK_INTERVAL_MS = 60 * 1000;

/**
 * How long a claimed task stays out of the queue. Longer than a task takes, and
 * it is what brings a task back when the process dies in the middle: nothing
 * marks it «in progress», and no sweep is needed. A second process reaching the
 * same folder would do no harm: the deletion is idempotent.
 */
export const CLAIM_LEASE_MS = 10 * 60 * 1000;

/**
 * How long a new task waits before its first attempt. An avatar upload already
 * under way when the account is deleted lands in the folder afterwards, and a task
 * closed by then would never see that file. A request lives at most 300 s (Node's
 * requestTimeout: the body comes first) and the upload after it at most 60 s
 * (cloudinary/lib/uploader.js), so ten minutes outlast it. The answer to the person
 * does not wait for this.
 */
export const FIRST_ATTEMPT_DELAY_MS = 10 * 60 * 1000;

/**
 * The pause after each failed attempt; when they run out, the task is failed
 * and stays in the table. Nine attempts over about three days: a short outage
 * of the cloud passes on the first steps. A wrong key is the one failure that
 * lasts (keys were changed on 22–25.10.2026); it also stops every upload, so it
 * does not go unnoticed for long, and after it the header of migration 040 has
 * the statement that returns failed rows to the queue.
 */
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const RETRY_PAUSES_MS = Object.freeze([
  5 * MINUTE,
  15 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
  24 * HOUR,
]);

/** How often the loop says it is alive and how many tasks are open. */
export const HEARTBEAT_INTERVAL_MS = HOUR;

/**
 * Whether this process runs the loop. By default only on production: a local
 * server has the real keys of the cloud in its .env and may stand on a restored
 * snapshot, where deleting a test account would remove the real person's
 * pictures. AVATAR_DELETION_ENABLED says otherwise when needed: `false` stops
 * the loop on production without a deploy of code; the tasks wait in the table.
 *
 * @param {Object} [env] - Environment map (process.env in production)
 * @returns {{ enabled: boolean, intervalMs: number, warnings: string[] }}
 */
export const resolveAvatarDeletionPolicy = (env = {}) => {
  const warnings = [];
  let enabled = env.NODE_ENV === 'production';

  const raw = String(env.AVATAR_DELETION_ENABLED ?? '').trim();
  if (raw === 'true' || raw === 'false') {
    enabled = raw === 'true';
  } else if (raw !== '') {
    warnings.push(`AVATAR_DELETION_ENABLED is neither true nor false: the default is used (${enabled})`);
  }
  if (env.NODE_ENV === 'production' && !enabled) {
    warnings.push('is switched off on production: the pictures of deleted accounts wait on the cloud');
  }

  return { enabled, intervalMs: TICK_INTERVAL_MS, warnings };
};
