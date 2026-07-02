/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Quality Health Integration Tests — AI-ops Brick-1 (Tier-0 immunity)
 *
 * Covers GET /api/v1/admin/quality/health (auth guards + envelope) and the
 * underlying qualityHealthModel invariants. Violations are injected via RAW SQL
 * because the write path (establishmentService) prevents them — the monitor exists
 * precisely to catch what slipped past write-time validation.
 *
 * Also unit-tests the pure workingHoursSanity checker (no DB).
 *
 * Fixture set (9 active establishments, built once in beforeAll):
 *   1 clean baseline · 1 English-category (unreachable + cat off-canon, + attr keys)
 *   1 off-canon cuisine · 1 out-of-bounds coords (+ folded/non-object attributes)
 *   1 malformed hours · 1 all-closed hours
 *   1 empty menu (media, no items) · 1 OCR-failed (media, no items, failed job)
 *   1 hanging flag (media + flagged menu_item)
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { createAdminAndGetToken, createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';
import * as qualityHealthModel from '../../models/qualityHealthModel.js';
import { checkWorkingHours } from '../../utils/workingHoursSanity.js';

const HEALTH_URL = '/api/v1/admin/quality/health';

let adminToken;
let userToken;

// Attach a menu-photo media row to an establishment; returns the media id.
async function addMenuMedia(establishmentId, fileType = 'image') {
  const id = randomUUID();
  await query(
    `INSERT INTO establishment_media (id, establishment_id, type, url, file_type)
     VALUES ($1, $2, 'menu', $3, $4)`,
    [id, establishmentId, `https://example.test/${id}.jpg`, fileType],
  );
  return id;
}

// Create an active establishment (valid baseline) and return its row.
async function createActive() {
  const { establishment } = await createPartnerWithEstablishment('active');
  return establishment;
}

beforeAll(async () => {
  await clearAllData();

  adminToken = (await createAdminAndGetToken()).accessToken;
  userToken = (await createUserAndGetTokens({
    email: `qh-user-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: 'QH Regular User',
    role: 'user',
    authMethod: 'email',
  })).accessToken;

  // 1) clean baseline — must stay unflagged on every signal
  await createActive();

  // 2) English category → unreachable + category off-canon; also carries attribute keys
  const englishCat = await createActive();
  await query(
    `UPDATE establishments
       SET categories = $2, attributes = '{"banquets":true,"wifi":true}'::jsonb
     WHERE id = $1`,
    [englishCat.id, ['cafe']],
  );

  // 3) off-canon cuisine (category stays canonical → not unreachable)
  const offCuisine = await createActive();
  await query('UPDATE establishments SET cuisines = $2 WHERE id = $1', [offCuisine.id, ['Французская']]);

  // 4) out-of-bounds coords + folded (non-object) attributes
  const badCoords = await createActive();
  await query(
    `UPDATE establishments SET latitude = 10.0, longitude = 10.0, attributes = '[1,2]'::jsonb WHERE id = $1`,
    [badCoords.id],
  );

  // 5) malformed hours (one bad day, one good → malformed but not all-closed)
  const malformed = await createActive();
  await query(
    `UPDATE establishments SET working_hours = '{"monday":"garbage","tuesday":"10:00-22:00"}'::jsonb WHERE id = $1`,
    [malformed.id],
  );

  // 6) all-closed hours (empty object → open on no day)
  const allClosed = await createActive();
  await query(`UPDATE establishments SET working_hours = '{}'::jsonb WHERE id = $1`, [allClosed.id]);

  // 7) empty menu — menu media present, no menu_items, no OCR job
  const emptyMenu = await createActive();
  await addMenuMedia(emptyMenu.id);

  // 8) OCR failed — menu media, no items, one failed job
  const ocrFailed = await createActive();
  const failedMediaId = await addMenuMedia(ocrFailed.id);
  await query(
    `INSERT INTO ocr_jobs (id, establishment_id, media_id, status, attempts)
     VALUES ($1, $2, $3, 'failed', 3)`,
    [randomUUID(), ocrFailed.id, failedMediaId],
  );

  // 9) hanging flag — media + a flagged, unactioned menu_item
  const flagged = await createActive();
  const flaggedMediaId = await addMenuMedia(flagged.id);
  await query(
    `INSERT INTO menu_items (id, establishment_id, media_id, item_name, sanity_flag, is_hidden_by_admin)
     VALUES ($1, $2, $3, $4, $5::jsonb, false)`,
    [randomUUID(), flagged.id, flaggedMediaId, 'Тестовое блюдо', JSON.stringify({ reason: 'low_confidence' })],
  );
});

afterAll(async () => {
  await clearAllData();
});

// ===========================================================================
// Pure unit — workingHoursSanity (no DB)
// ===========================================================================
describe('workingHoursSanity.checkWorkingHours (pure)', () => {
  test('valid string week (incl. overnight span) is clean', () => {
    expect(checkWorkingHours({ monday: '10:00-22:00', friday: '14:00-03:00' }))
      .toEqual({ malformed: false, allClosed: false });
  });

  test('valid object week is clean', () => {
    expect(checkWorkingHours({ monday: { open: '10:00', close: '22:00' } }))
      .toEqual({ malformed: false, allClosed: false });
  });

  test('24/7 marker "00:00-23:59" is clean', () => {
    expect(checkWorkingHours({ monday: '00:00-23:59' }))
      .toEqual({ malformed: false, allClosed: false });
  });

  test('unparseable day (with another open day) is malformed, not all-closed', () => {
    expect(checkWorkingHours({ monday: 'garbage', tuesday: '10:00-22:00' }))
      .toEqual({ malformed: true, allClosed: false });
  });

  test('invalid clock time is malformed', () => {
    expect(checkWorkingHours({ monday: '25:00-30:00' }).malformed).toBe(true);
  });

  test('empty object and explicit-closed week resolve to all-closed', () => {
    expect(checkWorkingHours({})).toEqual({ malformed: false, allClosed: true });
    expect(checkWorkingHours({ monday: { is_open: false } }))
      .toEqual({ malformed: false, allClosed: true });
  });

  test('non-object values are malformed', () => {
    expect(checkWorkingHours(null)).toEqual({ malformed: true, allClosed: false });
    expect(checkWorkingHours('nope')).toEqual({ malformed: true, allClosed: false });
    expect(checkWorkingHours([1, 2])).toEqual({ malformed: true, allClosed: false });
  });
});

// ===========================================================================
// Model invariants (against pg-test, over the injected fixture set)
// ===========================================================================
describe('qualityHealthModel signals', () => {
  test('A1 — slug reachability: only the English-category row is unreachable', async () => {
    const r = await qualityHealthModel.getUnreachableEstablishments();
    expect(r.count).toBe(1);
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0].category_slug).toBeNull();
  });

  test('A2 — canon membership: one off-canon category, one off-canon cuisine', async () => {
    const r = await qualityHealthModel.getOffCanonCounts();
    expect(r.category_offcanon_count).toBe(1);
    expect(r.cuisine_offcanon_count).toBe(1);
  });

  test('B — menu completeness: 2 empty, 1 OCR-failed, 0 stuck', async () => {
    const r = await qualityHealthModel.getMenuCompleteness();
    expect(r.empty_menus_count).toBe(2);
    expect(r.ocr_failed_count).toBe(1);
    expect(r.ocr_stuck_count).toBe(0);
  });

  test('C — geo bounds: one out-of-Belarus establishment', async () => {
    const r = await qualityHealthModel.getOutOfBoundsEstablishments();
    expect(r.count).toBe(1);
    expect(r.samples[0].reason).toBe('outside_belarus');
  });

  test('D — working hours: one malformed, one all-closed', async () => {
    const r = await qualityHealthModel.getInvalidHours();
    expect(r.malformed_count).toBe(1);
    expect(r.all_closed_count).toBe(1);
  });

  test('E — attribute census: keys counted, folded row counted, no SRF error', async () => {
    const r = await qualityHealthModel.getAttributeKeyCensus();
    const byKey = Object.fromEntries(r.keys.map((k) => [k.key, k.count]));
    expect(byKey.banquets).toBe(1);
    expect(byKey.wifi).toBe(1);
    expect(r.non_object_count).toBe(1);
  });

  test('F — hanging flags: one unactioned flagged menu item', async () => {
    const r = await qualityHealthModel.getHangingFlags();
    expect(r.hanging_count).toBe(1);
  });

  test('G — price distribution: deferred stub (statistical, wire at 500)', async () => {
    const r = await qualityHealthModel.getPriceDistributionAnomalies();
    expect(r.status).toBe('deferred');
  });
});

// ===========================================================================
// Endpoint — auth guards + envelope (end-to-end: route → service → model → DB)
// ===========================================================================
describe('GET /api/v1/admin/quality/health', () => {
  test('401 without a token', async () => {
    const res = await request(app).get(HEALTH_URL);
    expect(res.status).toBe(401);
  });

  test('403 for a non-admin token', async () => {
    const res = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  test('200 for an admin token, with a well-formed snapshot', async () => {
    const res = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    expect(d.scope).toBe('active');
    expect(d.canon_reachability.unreachable_count).toBe(1);
    expect(d.canon_reachability.category_offcanon_count).toBe(1);
    expect(d.canon_reachability.cuisine_offcanon_count).toBe(1);
    expect(d.menu_completeness.empty_menus_count).toBe(2);
    expect(d.geo_bounds.count).toBe(1);
    expect(d.working_hours.malformed_count).toBe(1);
    expect(d.working_hours.all_closed_count).toBe(1);
    expect(d.hanging_flags.hanging_count).toBe(1);
    expect(d.attribute_census.non_object_count).toBe(1);
    expect(d.price_distribution.status).toBe('deferred');
  });
});
