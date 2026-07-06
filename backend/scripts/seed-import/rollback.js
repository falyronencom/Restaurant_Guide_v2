/**
 * Batch rollback — remove every card of a seed-import batch.
 *
 * ORDER IS LOAD-BEARING (Phase-0 finding): snapshot the registry (the only map
 * of Cloudinary public_ids) to a file FIRST, delete the Cloudinary assets
 * SECOND, and DELETE the establishments LAST — because deleting establishments
 * CASCADE-deletes the registry rows (and their media_state) that hold the
 * public_ids. Reversing this order strands orphaned Cloudinary assets with no
 * DB record to find them by.
 *
 * GUARDS (Phase-0 finding): rollback is a blunt CASCADE (reviews, favorites,
 * bookings, subscriptions all cascade). It is legal only before real user
 * interaction. This refuses to delete:
 *   - a card that has been CLAIMED by a real partner (never, even with --force);
 *   - a batch whose cards carry user interactions, unless --force-with-interactions.
 */

import { writeFileSync } from 'fs';
import * as registry from './registry.js';

/**
 * @param {object} args
 * @param {import('pg').Pool} args.db
 * @param {string} args.batchId
 * @param {string} args.snapshotFile - where to write the pre-delete snapshot
 * @param {(publicId:string)=>Promise<void>} args.destroy - Cloudinary destroy (real path)
 * @param {boolean} [args.forceWithInteractions]
 * @returns {Promise<{ deleted:number, skipped_claimed:number, assets_destroyed:number, blocked?:string }>}
 */
export async function rollbackBatch({ db, batchId, snapshotFile, destroy, forceWithInteractions = false }) {
  const rows = await registry.getBatch(db, batchId);
  if (rows.length === 0) return { deleted: 0, skipped_claimed: 0, assets_destroyed: 0, blocked: 'empty batch' };

  // 1. Snapshot FIRST (survives the CASCADE that removes registry rows).
  writeFileSync(snapshotFile, JSON.stringify(rows, null, 2));

  const estIds = rows.map((r) => r.establishment_id).filter(Boolean);

  // Guard A: never touch claimed cards.
  const { rows: claimed } = estIds.length
    ? await db.query('SELECT id FROM establishments WHERE id = ANY($1::uuid[]) AND claimed_at IS NOT NULL', [estIds])
    : { rows: [] };
  const claimedSet = new Set(claimed.map((r) => r.id));

  // Guard B: refuse on user interactions unless explicitly forced.
  const deletable = estIds.filter((id) => !claimedSet.has(id));
  if (deletable.length && !forceWithInteractions) {
    const { rows: [counts] } = await db.query(
      `SELECT
         (SELECT count(*) FROM reviews   WHERE establishment_id = ANY($1::uuid[])) AS reviews,
         (SELECT count(*) FROM favorites WHERE establishment_id = ANY($1::uuid[])) AS favorites,
         (SELECT count(*) FROM bookings  WHERE establishment_id = ANY($1::uuid[])) AS bookings`,
      [deletable],
    );
    const total = Number(counts.reviews) + Number(counts.favorites) + Number(counts.bookings);
    if (total > 0) {
      return {
        deleted: 0, skipped_claimed: claimedSet.size, assets_destroyed: 0,
        blocked: `batch has ${counts.reviews} reviews / ${counts.favorites} favorites / ${counts.bookings} bookings — ` +
                 `re-run with --force-with-interactions to delete user content, or handle manually. Snapshot: ${snapshotFile}`,
      };
    }
  }

  // 2. Destroy Cloudinary assets (idempotent; skip stub/dry-run ids).
  let assetsDestroyed = 0;
  for (const r of rows) {
    if (claimedSet.has(r.establishment_id)) continue;
    const state = r.media_state || {};
    for (const relpath of Object.keys(state)) {
      const publicId = state[relpath].public_id;
      if (!publicId || publicId.startsWith('dryrun/')) continue; // stub asset — nothing to destroy
      if (destroy) { await destroy(publicId); assetsDestroyed++; }
    }
  }

  // 3. DELETE establishments LAST (CASCADE removes media/ocr/registry rows).
  const { rowCount } = deletable.length
    ? await db.query('DELETE FROM establishments WHERE id = ANY($1::uuid[])', [deletable])
    : { rowCount: 0 };

  return { deleted: rowCount, skipped_claimed: claimedSet.size, assets_destroyed: assetsDestroyed };
}
