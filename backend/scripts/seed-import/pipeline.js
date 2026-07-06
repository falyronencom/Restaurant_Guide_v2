/**
 * Per-card import pipeline — the resume-safe phase machine.
 *
 * Phases: (skip/conflict check) → created → media_done → ocr_enqueued → activated.
 * Each phase is idempotent and re-entrant, so a re-run resumes from wherever a
 * prior run stopped without duplicating work. No single DB transaction spans a
 * card (the service is pool-based and Cloudinary is out-of-transaction anyway);
 * safety comes from the registry phase machine + the card being invisible
 * (draft) until the final activation phase.
 *
 * Direct model writes (MediaModel, is_seed, primary_image_url, activation) are
 * deliberate: the service create path cannot emit exterior/dishes media, writes
 * degenerate identical URLs, cannot set is_seed, and its only draft→active path
 * (admin moderate) is pending-only with notifications unwanted for seed. All DB
 * invariants are still enforced by the establishment_media CHECKs + the canon
 * CHECK from migration 030.
 */

import { ATTRIBUTE_CANON } from './contract.js';
import * as registry from './registry.js';
import { uploadMedia } from './media.js';

const PHASE_ORDER = ['creating', 'created', 'media_done', 'ocr_enqueued', 'activated'];
const atLeast = (phase, target) => PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(target);

/** Map a normalized record + resolved coords → establishmentService payload
 *  (deliberately NO media fields, so the service's media + OCR branches stay
 *  dormant — the pipeline owns media/OCR directly). */
function buildPayload(rec, coords) {
  return {
    name: rec.name,
    description: rec.description,
    city: rec.city,
    address: rec.address,
    latitude: coords.latitude,
    longitude: coords.longitude,
    phone: rec.phone || undefined,
    email: rec.email || undefined,
    website: rec.website || undefined,
    categories: rec.categories,
    cuisines: rec.cuisines,
    price_range: rec.price_range || undefined,
    working_hours: rec.working_hours,
    attributes: rec.attributes,
  };
}

/** SELECT an existing establishment id for (partner, name) — adopt-by-name recovery. */
async function findEstablishmentId(db, partnerId, name) {
  const { rows } = await db.query(
    'SELECT id, status FROM establishments WHERE partner_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
    [partnerId, name],
  );
  return rows[0] || null;
}

async function assertSeed(db, estId) {
  await db.query('UPDATE establishments SET is_seed = true WHERE id = $1', [estId]);
}

/** Phase: ensure the establishment row exists (create or adopt), registry 'created'. */
async function ensureCreated(ctx, rec, reg) {
  if (reg && reg.establishment_id) return reg.establishment_id;

  const coords = await ctx.geocoder.resolve(rec);
  if (!reg) {
    await registry.insertCreating(ctx.db, {
      stableId: rec.stable_id,
      batchId: ctx.batchId,
      contentHash: rec.content_hash,
      coordsSource: coords.coords_source,
    });
  }

  // Adopt a prior-crash orphan (est created but registry not advanced) by name.
  const existing = await findEstablishmentId(ctx.db, ctx.partnerId, rec.name);
  if (existing) {
    await registry.setCreated(ctx.db, rec.stable_id, existing.id);
    await assertSeed(ctx.db, existing.id);
    return existing.id;
  }

  const est = await ctx.service.createEstablishment(ctx.partnerId, buildPayload(rec, coords));
  await registry.setCreated(ctx.db, rec.stable_id, est.id);
  await assertSeed(ctx.db, est.id);
  return est.id;
}

/** Phase: ensure all media uploaded + rows written, primary set, registry 'media_done'. */
async function ensureMedia(ctx, estId, rec, mediaItems, reg) {
  if (reg && atLeast(reg.phase, 'media_done')) return;

  const mediaState = (reg && reg.media_state) || {};
  const perType = {}; // position counter per media type
  let firstExteriorRelpath = null;

  for (const item of mediaItems) {
    if (item.type === 'exterior' && firstExteriorRelpath === null) firstExteriorRelpath = item.relpath;
    const position = (perType[item.type] = (perType[item.type] ?? -1) + 1);
    const isPrimary = item.relpath === firstExteriorRelpath;

    let st = mediaState[item.relpath];

    // Already fully materialised (row exists) → skip. Predicate is media_row_id
    // presence AND the row still existing — NOT mere relpath presence.
    if (st && st.media_row_id && await mediaRowExists(ctx.db, st.media_row_id)) continue;

    // Uploaded but no row (crash between upload and createMedia) → reuse the
    // public_id/URLs, do not re-upload.
    if (!st || !st.public_id) {
      const up = await uploadMedia(item, estId, ctx.mediaMode);
      st = {
        public_id: up.public_id, type: up.type, file_type: up.file_type,
        url: up.url, preview_url: up.preview_url, thumbnail_url: up.thumbnail_url,
      };
      mediaState[item.relpath] = st;
      await registry.setMediaState(ctx.db, rec.stable_id, mediaState); // persist BEFORE the row write
    }

    const row = await ctx.MediaModel.createMedia({
      establishment_id: estId,
      type: st.type,
      file_type: st.file_type,
      url: st.url,
      preview_url: st.preview_url,
      thumbnail_url: st.thumbnail_url,
      position,
      is_primary: isPrimary,
    });
    mediaState[item.relpath].media_row_id = row.id;
    await registry.setMediaState(ctx.db, rec.stable_id, mediaState);
  }

  // primary_image_url = COALESCE(preview_url, url) of the first exterior (matches
  // setPrimaryPhoto convention — serves the 800×600 preview, not the 1920 original).
  if (firstExteriorRelpath && mediaState[firstExteriorRelpath]) {
    const ext = mediaState[firstExteriorRelpath];
    await ctx.db.query(
      'UPDATE establishments SET primary_image_url = $2 WHERE id = $1',
      [estId, ext.preview_url || ext.url],
    );
  }

  await registry.setPhase(ctx.db, rec.stable_id, 'media_done');
}

async function mediaRowExists(db, mediaRowId) {
  const { rows } = await db.query('SELECT 1 FROM establishment_media WHERE id = $1', [mediaRowId]);
  return rows.length > 0;
}

/** Phase: enqueue OCR for every menu media (photo + PDF), registry 'ocr_enqueued'. */
async function ensureOcr(ctx, estId, rec, reg) {
  if (reg && atLeast(reg.phase, 'ocr_enqueued')) return;

  const { rows } = await ctx.db.query(
    "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
    [estId],
  );
  for (const row of rows) {
    // Skip media whose OCR already completed; enqueue is idempotent vs active jobs.
    if (await ctx.OcrJobModel.hasCompletedJobForMedia(row.id)) continue;
    await ctx.OcrJobModel.enqueue({ establishmentId: estId, mediaId: row.id });
  }
  await registry.setPhase(ctx.db, rec.stable_id, 'ocr_enqueued');
}

/** Phase: scripted draft→active (CAT-E-2.2), registry 'activated'. */
async function ensureActivated(ctx, estId, rec, reg) {
  if (reg && reg.phase === 'activated') return;

  const notes = JSON.stringify({ seed_import: 'CAT-E-2.2 scripted activation', batch_id: ctx.batchId });
  const res = await ctx.db.query(
    `UPDATE establishments
     SET status = 'active', is_seed = true,
         published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
         moderated_at = CURRENT_TIMESTAMP,
         moderation_notes = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'draft'`,
    [estId, notes],
  );

  // Idempotency: 0 rows updated is success IFF the row is already active.
  if (res.rowCount === 0) {
    const { rows } = await ctx.db.query('SELECT status FROM establishments WHERE id = $1', [estId]);
    const status = rows[0] && rows[0].status;
    if (status !== 'active') {
      throw new Error(`activation no-op with unexpected status '${status}' for ${rec.stable_id}`);
    }
  }
  await registry.setPhase(ctx.db, rec.stable_id, 'activated');
}

/**
 * Process one card end-to-end (or resume it).
 *
 * @param {object} ctx - { db, service, MediaModel, OcrJobModel, geocoder, partnerId, batchId, mediaMode }
 * @param {object} rec - normalized record with `content_hash` attached
 * @param {Array} mediaItems - scanned media items for this card
 * @returns {Promise<{ status: 'created'|'resumed'|'skipped'|'conflict', stable_id, establishment_id? }>}
 */
export async function processCard(ctx, rec, mediaItems) {
  const reg0 = await registry.findByStableId(ctx.db, rec.stable_id);

  if (reg0 && reg0.phase === 'activated') {
    if (reg0.content_hash === rec.content_hash) {
      return { status: 'skipped', stable_id: rec.stable_id, establishment_id: reg0.establishment_id };
    }
    // Sheet edited after activation — the importer is not an editor. Report, skip.
    return { status: 'conflict', stable_id: rec.stable_id, establishment_id: reg0.establishment_id };
  }

  const resuming = !!reg0;
  const estId = await ensureCreated(ctx, rec, reg0);
  // Re-read registry between phases (media_state/phase advanced by prior calls).
  let reg = await registry.findByStableId(ctx.db, rec.stable_id);
  await ensureMedia(ctx, estId, rec, mediaItems, reg);
  reg = await registry.findByStableId(ctx.db, rec.stable_id);
  await ensureOcr(ctx, estId, rec, reg);
  reg = await registry.findByStableId(ctx.db, rec.stable_id);
  await ensureActivated(ctx, estId, rec, reg);

  return { status: resuming ? 'resumed' : 'created', stable_id: rec.stable_id, establishment_id: estId };
}
