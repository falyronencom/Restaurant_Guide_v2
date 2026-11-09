/**
 * Removes from the cloud the card wizard's files that never became part of a
 * card — thirty days after the person's last upload there, and at once when the
 * account or the card is gone (thread «Фото людей», step 1, finding 2; the
 * Coordinator's word 09.11.2026; directive п. 9). Which files: the one plan of
 * scripts/lib/mediaOrphanSweep.js, the same the operator's list prints
 * (scripts/media-orphans-audit.js --sweep).
 *
 * A run, once a day:
 *   1. the whole cloud is listed through the Admin API, read calls only
 *      (scripts/prod-snapshot/cloudinaryReader.js refuses anything else);
 *   2. the whole database is read once, in one read-only transaction of a
 *      connection of its own (scripts/lib/mediaOrphansDb.js) — never a pooled
 *      one: that read switches its session to read-only;
 *   3. the plan: files nothing in the database names, of a quiet, deleted or
 *      missing owner;
 *   4. right before each removal the database is asked once more whether
 *      anything names the file now (models/mediaReferenceModel.js); a card
 *      saved since keeps it;
 *   5. the file is destroyed only inside its owner's folder, with the CDN's
 *      copies; at most MAX_DELETIONS_PER_RUN a run.
 * The journal gets numbers only — no file names, no account or card ids.
 *
 * A run cut short (a restart, a stop) costs nothing: what is gone stays gone,
 * what is left is planned again the next day. No table, no state.
 *
 * Whether it runs at all: config/mediaOrphanSweep.js — off unless
 * MEDIA_ORPHAN_SWEEP_ENABLED=true, and never outside production. Tests call
 * runOnce() with the cloud and the listing given.
 */

import pg from 'pg';
import { pool } from '../config/database.js';
import { deleteImage, ownedFolders } from '../config/cloudinary.js';
import {
  FIRST_RUN_DELAY_MS,
  MAX_DELETIONS_PER_RUN,
  resolveMediaOrphanSweepPolicy,
} from '../config/mediaOrphanSweep.js';
import { isNamedAnywhere, loadTextColumns } from '../models/mediaReferenceModel.js';
import {
  DELIVERY_URL_REGEX_SOURCE,
  GROUP,
  folderOf,
  indexReferences,
  isUuid,
  listWholeCloud,
  parseListing,
  tokenRegexSource,
  topFoldersOf,
} from '../../scripts/lib/mediaOrphans.js';
import { readDatabase } from '../../scripts/lib/mediaOrphansDb.js';
import { planSweep } from '../../scripts/lib/mediaOrphanSweep.js';
import { CloudinaryReader, DELIVERY_TYPES, RESOURCE_TYPES } from '../../scripts/prod-snapshot/cloudinaryReader.js';
import logger from '../utils/logger.js';

const CLOUD_CALL_DEADLINE_MS = 20 * 1000;

let firstTimer = null;
let intervalId = null;
let runPromise = null;
let stopRequested = false;

const withinDeadline = (promise, ms) => {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from the cloud in ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};

/** The ids of the accounts and cards whose folders hold files — only UUIDs go to the database. */
const ownerIdsOf = (assets) => {
  const users = new Set();
  const cards = new Set();
  for (const a of assets) {
    const f = folderOf(a.public_id);
    if (!f.ownerId || !isUuid(f.ownerId)) continue;
    if (f.group === GROUP.CARDS) cards.add(f.ownerId);
    else if (f.group === GROUP.TEMP || f.group === GROUP.AVATARS) users.add(f.ownerId);
  }
  return { users: [...users].sort(), cards: [...cards].sort() };
};

/** The live cloud, read calls only. */
const listCloud = async (env) => {
  const reader = new CloudinaryReader({
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  });
  const resources = await listWholeCloud(reader, { resourceTypes: RESOURCE_TYPES, deliveryTypes: DELIVERY_TYPES });
  return { assets: parseListing({ resources }).assets, cloudName: env.CLOUDINARY_CLOUD_NAME };
};

/** The database's references, read on a connection of its own (read-only session). */
const readReferences = async (assets, cloudName) => {
  const topFolders = topFoldersOf(assets);
  const client = new pg.Client(pool.options);
  await client.connect();
  let db;
  try {
    db = await readDatabase(client, {
      tokenRegex: tokenRegexSource(topFolders) || '(?!)',
      urlRegex: DELIVERY_URL_REGEX_SOURCE,
      ownerIds: ownerIdsOf(assets),
    });
  } finally {
    await client.end().catch(() => {});
  }
  const refs = indexReferences({
    tokenHits: db.tokenHits,
    urlHits: db.urlHits,
    topFolders,
    cloudName,
    listed: new Set(assets.map((a) => a.public_id)),
  });
  return { refs, owners: db.owners, topFolders };
};

/** The folder the file may be destroyed from: its owner's. */
const ownerFolder = (file) => (file.group === GROUP.TEMP
  ? ownedFolders.partnerUploads(file.ownerId)
  : ownedFolders.establishment(file.ownerId));

/**
 * One run. Never rejects.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @param {Function} [options.list] - () => {assets, cloudName}; the live cloud by default
 * @param {Date} [options.asOf]
 * @param {Function} [options.afterPlan] - tests: called with the plan before
 *   the removals start — the moment a card may take a planned file
 * @returns {Promise<{due: number, removed: number, named: number, failed: number, refused: string|null}>}
 */
export const runOnce = async ({
  env = process.env, list = () => listCloud(env), asOf = new Date(), afterPlan = async () => {},
} = {}) => {
  const outcome = { due: 0, removed: 0, named: 0, failed: 0, refused: null };
  try {
    const { assets, cloudName } = await list();
    const { refs, owners, topFolders } = await readReferences(assets, cloudName);
    // A database of another cloud would make every file an orphan.
    if (assets.length > 0 && (refs.clouds.ours === 0 || refs.clouds.others > refs.clouds.ours)) {
      outcome.refused = 'the database does not link this cloud';
      logger.error('Media orphan sweep: refused, the database and the cloud are not of one environment', refs.clouds);
      return outcome;
    }

    const due = planSweep({ assets, refs, owners, topFolders, asOf });
    outcome.due = due.length;
    await afterPlan(due);
    const tables = await loadTextColumns(pool);

    for (const file of due.slice(0, MAX_DELETIONS_PER_RUN)) {
      if (stopRequested) break;
      if (await isNamedAnywhere(pool, tables, file.public_id)) {
        outcome.named += 1;
        continue;
      }
      try {
        const { result } = await withinDeadline(
          deleteImage(file.public_id, [ownerFolder(file)], { invalidate: true, resourceType: file.resource_type }),
          CLOUD_CALL_DEADLINE_MS,
        );
        if (result === 'ok' || result === 'not found') outcome.removed += 1;
        else outcome.failed += 1;
      } catch {
        outcome.failed += 1;
      }
    }
    logger.info('Media orphan sweep: run done', outcome);
  } catch (error) {
    outcome.refused = 'run failed';
    logger.error('Media orphan sweep: run failed', { error: String(error?.message ?? error).slice(0, 300) });
  }
  return outcome;
};

const run = () => {
  if (runPromise) return runPromise;
  stopRequested = false;
  runPromise = runOnce().finally(() => {
    runPromise = null;
  });
  return runPromise;
};

/**
 * Start the loop, if the policy says so. Idempotent.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @returns {{ enabled: boolean, intervalMs: number, warnings: string[] }}
 */
export const start = ({ env = process.env } = {}) => {
  const policy = resolveMediaOrphanSweepPolicy(env);
  if (firstTimer !== null || intervalId !== null) {
    logger.warn('Media orphan sweep already running — start() ignored');
    return policy;
  }
  if (!policy.enabled) return policy;
  stopRequested = false;
  firstTimer = setTimeout(() => {
    firstTimer = null;
    run();
    intervalId = setInterval(run, policy.intervalMs);
  }, FIRST_RUN_DELAY_MS);
  return policy;
};

/**
 * Stop and wait for the file in progress — one probe and one call to the cloud
 * at most (20 s). Called during graceful shutdown.
 *
 * @returns {Promise<void>}
 */
export const stop = async () => {
  stopRequested = true;
  if (firstTimer !== null) {
    clearTimeout(firstTimer);
    firstTimer = null;
  }
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (runPromise) await runPromise;
};
