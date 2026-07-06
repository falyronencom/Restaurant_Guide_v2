/**
 * seed_import_registry access — the phase-machine persistence for idempotency
 * and resume (migration 031).
 *
 * All functions take an explicit `db` (a pg Pool or Client) so the module stays
 * testable and never binds a global pool. Keyed on stable_id.
 *
 * Phase machine: creating → created → media_done → ocr_enqueued → activated.
 * The 'creating' row is written BEFORE establishmentService.createEstablishment,
 * so a crash between the service create and the registry write cannot leave a
 * draft with no registry entry (Phase-0 finding — the orphan/duplicate window).
 */

/** @returns {Promise<object|null>} the registry row for a stable_id, or null. */
export async function findByStableId(db, stableId) {
  const { rows } = await db.query(
    'SELECT * FROM seed_import_registry WHERE stable_id = $1',
    [stableId],
  );
  return rows[0] || null;
}

/** Insert the pre-create 'creating' row (establishment_id still NULL). */
export async function insertCreating(db, { stableId, batchId, contentHash, coordsSource }) {
  await db.query(
    `INSERT INTO seed_import_registry (stable_id, batch_id, content_hash, phase, coords_source)
     VALUES ($1, $2, $3, 'creating', $4)`,
    [stableId, batchId, contentHash, coordsSource],
  );
}

/** Attach the created establishment and advance to 'created'. */
export async function setCreated(db, stableId, establishmentId) {
  await db.query(
    `UPDATE seed_import_registry
     SET establishment_id = $2, phase = 'created', updated_at = CURRENT_TIMESTAMP
     WHERE stable_id = $1`,
    [stableId, establishmentId],
  );
}

/** Persist media_state (authoritative public_id / media_row_id map). */
export async function setMediaState(db, stableId, mediaState) {
  await db.query(
    `UPDATE seed_import_registry
     SET media_state = $2::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE stable_id = $1`,
    [stableId, JSON.stringify(mediaState)],
  );
}

/** Advance the phase (created → media_done → ocr_enqueued → activated). */
export async function setPhase(db, stableId, phase) {
  await db.query(
    `UPDATE seed_import_registry
     SET phase = $2, updated_at = CURRENT_TIMESTAMP
     WHERE stable_id = $1`,
    [stableId, phase],
  );
}

/** All rows for a batch (rollback snapshot + reporting). */
export async function getBatch(db, batchId) {
  const { rows } = await db.query(
    'SELECT * FROM seed_import_registry WHERE batch_id = $1 ORDER BY stable_id',
    [batchId],
  );
  return rows;
}

/** Delete a registry row (used only by reconcile when adopting/discarding). */
export async function remove(db, stableId) {
  await db.query('DELETE FROM seed_import_registry WHERE stable_id = $1', [stableId]);
}
