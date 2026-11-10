/**
 * How the server's clean-up of abandoned wizard files runs
 * (services/mediaOrphanSweepLoop.js; thread «Фото людей», step 1, finding 2).
 *
 * Pure: reads the env object it is given and returns the warnings instead of
 * logging them, as config/avatarDeletion.js does.
 */

/**
 * Once a day. A run lists the whole cloud through the Admin API — about a
 * dozen calls plus one per 500 files of a list, of the 500 an hour the plan
 * allows, beside the avatar loop's 180 at most — and reads the whole database
 * once, in one read-only transaction. The term it serves is thirty days; a
 * day's delay costs nothing.
 */
export const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The first run after a start waits a quarter of an hour: deploys come in
 * series, and a run per deploy would only repeat the listing.
 */
export const FIRST_RUN_DELAY_MS = 15 * 60 * 1000;

/**
 * Files removed in one run at most. Each costs one probe of the database and
 * one destroy through the Upload API; a run stays within minutes, and the rest
 * waits for the next day. The first run after the switch-on removes the old
 * backlog in a few days instead of one burst.
 */
export const MAX_DELETIONS_PER_RUN = 300;

/**
 * Whether this process removes anything. Off unless MEDIA_ORPHAN_SWEEP_ENABLED
 * says `true` — on production too: the first real deletion waits until the
 * Coordinator has seen the list of candidates (directive п. 9; the list comes
 * from scripts/media-orphans-audit.js --sweep). A local server has the real
 * keys of the cloud in its .env and may stand on a restored snapshot, where
 * a sweep would remove the real people's files: it never runs under
 * NODE_ENV other than production, whatever the variable says.
 *
 * @param {Object} [env] - Environment map (process.env in production)
 * @returns {{ enabled: boolean, intervalMs: number, warnings: string[] }}
 */
export const resolveMediaOrphanSweepPolicy = (env = {}) => {
  const warnings = [];
  const raw = String(env.MEDIA_ORPHAN_SWEEP_ENABLED ?? '').trim();
  let asked = false;
  if (raw === 'true' || raw === 'false') {
    asked = raw === 'true';
  } else if (raw !== '') {
    warnings.push(`MEDIA_ORPHAN_SWEEP_ENABLED is neither true nor false: the sweep stays off`);
  }
  const production = env.NODE_ENV === 'production';
  if (asked && !production) {
    warnings.push('MEDIA_ORPHAN_SWEEP_ENABLED=true outside production: the sweep stays off');
  }
  return { enabled: asked && production, intervalMs: RUN_INTERVAL_MS, warnings };
};
