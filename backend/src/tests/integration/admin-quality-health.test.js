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
import * as qualityHealthService from '../../services/qualityHealthService.js';
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

// Establishment in `status` carrying one unactioned flagged menu_item.
// `agedDays` backdates the item IN SQL — the column is `timestamp without time zone`
// and node-pg would read a JS-built date as process-local time (three hours off on a
// developer machine, invisible on Railway where the process is UTC).
async function createFlaggedIn(status, { agedDays = 0 } = {}) {
  const { establishment } = await createPartnerWithEstablishment(status);
  const mediaId = await addMenuMedia(establishment.id);
  await query(
    `INSERT INTO menu_items (id, establishment_id, media_id, item_name, sanity_flag, is_hidden_by_admin, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW() - ($6 || ' days')::interval)`,
    [
      randomUUID(),
      establishment.id,
      mediaId,
      `Блюдо (${status})`,
      JSON.stringify({ reason: 'low_confidence' }),
      String(agedDays),
    ],
  );
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

  // 10-13) population of the hanging-flag signal — the SAME flagged item under four
  // establishment statuses. OCR is enqueued at CREATION (createEstablishment fires jobs
  // for menu media while status is still 'draft'), so these are not hypothetical rows:
  // an abandoned draft really does leave flags behind, and they used to be counted.
  await createFlaggedIn('draft'); // never submitted → out
  await createFlaggedIn('rejected'); // never will be published → out
  await createFlaggedIn('pending'); // about to be judged → in
  await createFlaggedIn('suspended'); // unsuspend puts it back in the catalogue → in

  // 14-15) aged flags on active establishments — one in each age band.
  // Both bands need an occupant that the OTHER band excludes, otherwise the two counts
  // would be equal and a mutation collapsing them onto one interval would pass unnoticed.
  await createFlaggedIn('active', { agedDays: 15 }); // past 7, inside 30
  await createFlaggedIn('active', { agedDays: 40 }); // past both
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

  test('F — hanging flags: counted only on catalogue-track establishments', async () => {
    const r = await qualityHealthModel.getHangingFlags();
    // 7 flagged items exist. Two of them sit on a draft and a rejected establishment and
    // must not be counted: nobody can see those prices and nobody will publish them.
    expect(r.hanging_count).toBe(5);
  });

  test('F — hanging flags: draft and rejected are the excluded pair, not some other pair',
    async () => {
      // The count above would also hold if the join dropped, say, suspended and pending
      // instead. Pin the membership by flipping ONE establishment's status at a time and
      // watching the count follow.
      const { rows } = await query(
        `SELECT e.id, e.status
           FROM menu_items mi JOIN establishments e ON e.id = mi.establishment_id
          WHERE mi.sanity_flag IS NOT NULL AND e.status = 'draft'`,
      );
      expect(rows).toHaveLength(1);
      const draftId = rows[0].id;

      for (const status of ['active', 'pending', 'suspended']) {
        await query('UPDATE establishments SET status = $2 WHERE id = $1', [draftId, status]);
        const inScope = await qualityHealthModel.getHangingFlags();
        expect(inScope.hanging_count).toBe(6);
      }

      for (const status of ['draft', 'rejected', 'archived']) {
        await query('UPDATE establishments SET status = $2 WHERE id = $1', [draftId, status]);
        const outOfScope = await qualityHealthModel.getHangingFlags();
        expect(outOfScope.hanging_count).toBe(5);
      }

      await query('UPDATE establishments SET status = $2 WHERE id = $1', [draftId, 'draft']);
    });

  test('F — hanging flags: the two age bands are distinct intervals', async () => {
    const r = await qualityHealthModel.getHangingFlags();
    // 15-day and 40-day items are both older than 7; only the 40-day one is older than 30.
    expect(r.aged_over_7d).toBe(2);
    expect(r.aged_over_30d).toBe(1);
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
    expect(d.hanging_flags.hanging_count).toBe(5);
    expect(d.hanging_flags.aged_over_7d).toBe(2);
    // Reaches the wire, not just the SQL — the client dropped this field until stage 7.
    expect(d.hanging_flags.aged_over_30d).toBe(1);
    expect(d.attribute_census.non_object_count).toBe(1);
    expect(d.price_distribution.status).toBe('deferred');
  });
});

// ===========================================================================
// Snapshot cache — the screen header prints generated_at as "снимок HH:MM",
// so a cached read is what that header already promises. What must not happen
// is a refresh button that returns the cached copy.
// ===========================================================================
describe('quality-health snapshot cache', () => {
  let hostId;
  let hostMediaId;

  beforeAll(async () => {
    const { rows } = await query(
      `SELECT mi.establishment_id, mi.media_id
         FROM menu_items mi JOIN establishments e ON e.id = mi.establishment_id
        WHERE e.status = 'active' AND mi.sanity_flag IS NOT NULL
        LIMIT 1`,
    );
    hostId = rows[0].establishment_id;
    hostMediaId = rows[0].media_id;
  });

  test('a second read inside the TTL returns the snapshot already taken', async () => {
    const first = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);
    const before = first.body.data.hanging_flags.hanging_count;

    const extraId = randomUUID();
    await query(
      `INSERT INTO menu_items (id, establishment_id, media_id, item_name, sanity_flag, is_hidden_by_admin)
       VALUES ($1, $2, $3, 'Свежий флаг', $4::jsonb, false)`,
      [extraId, hostId, hostMediaId, JSON.stringify({ reason: 'low_confidence' })],
    );

    try {
      // The world changed underneath. A cached read must not notice — that is the point,
      // and it is also the only way to tell caching apart from "the query was just fast".
      const cached = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);
      expect(cached.body.data.hanging_flags.hanging_count).toBe(before);
      expect(cached.body.data.generated_at).toBe(first.body.data.generated_at);

      const forced = await request(app)
        .get(`${HEALTH_URL}?refresh=1`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(forced.body.data.hanging_flags.hanging_count).toBe(before + 1);
    } finally {
      await query('DELETE FROM menu_items WHERE id = $1', [extraId]);
    }
  });

  test('a menu-item write DOES drop the cache — it changes this very number',
    async () => {
      // Через настоящий HTTP-путь, а не вызовом invalidateCache из теста. Прежняя
      // версия дёргала badgesService.invalidateCache() напрямую и была зелёной при
      // ЛЮБОЙ реализации: кэши — две независимые модульные переменные, они и так не
      // влияют друг на друга. Тест соглашался сам с собой.
      const flagId = randomUUID();
      await query(
        `INSERT INTO menu_items (id, establishment_id, media_id, item_name, sanity_flag, is_hidden_by_admin)
         VALUES ($1, $2, $3, 'Позиция под снятие флага', $4::jsonb, false)`,
        [flagId, hostId, hostMediaId, JSON.stringify({ reason: 'low_confidence' })],
      );

      // Через ?refresh=1: обычное чтение здесь подхватило бы снимок, оставленный
      // предыдущим тестом, и countBefore описывал бы прошлое состояние. Совпадало
      // оно случайно — обе вставки по одной строке.
      const before = await request(app)
        .get(`${HEALTH_URL}?refresh=1`)
        .set('Authorization', `Bearer ${adminToken}`);
      const countBefore = before.body.data.hanging_flags.hanging_count;

      await request(app)
        .post(`/api/v1/admin/menu-items/${flagId}/dismiss-flag`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const after = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);
      expect(after.body.data.hanging_flags.hanging_count).toBe(countBefore - 1);
      expect(after.body.data.generated_at).not.toBe(before.body.data.generated_at);

      await query('DELETE FROM menu_items WHERE id = $1', [flagId]);
    });

  test('одобрение заявки кэш НЕ сбрасывает — область не покидается', async () => {
    // Одобрение ведёт pending → active, оба статуса внутри области счётчика, так
    // что величина не меняется. Пересчёт стоил бы восьми запросов, три из которых
    // перебирают весь активный каталог, — и ради нуля изменений.
    const { establishment } = await createPartnerWithEstablishment('pending');

    const before = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(200);

    const after = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data.generated_at).toBe(before.body.data.generated_at);

    // Прибираем за собой: одобренное заведение стало активным и попало бы в
    // область восьми сигналов, сбив ожидания соседних тестов при перестановке.
    await query('DELETE FROM establishments WHERE id = $1', [establishment.id]);
    qualityHealthService.invalidateCache();
  });

  test('отказ кэш сбрасывает — заведение выходит из области', async () => {
    // Асимметрия с одобрением не осторожность, а следствие области: отказ ведёт
    // pending → rejected, то есть ЗА пределы CATALOGUE_TRACK_STATUSES, и все
    // флагованные позиции этого заведения разом выпадают из счёта. До появления
    // JOIN по статусу отказ был безвреден — тест сторожит, чтобы прежняя,
    // ставшая неверной, формулировка не вернулась.
    const { establishment } = await createPartnerWithEstablishment('pending');
    const mediaId = await addMenuMedia(establishment.id);
    await query(
      `INSERT INTO menu_items (id, establishment_id, media_id, item_name, sanity_flag, is_hidden_by_admin)
       VALUES ($1, $2, $3, 'Позиция под отказ', $4::jsonb, false)`,
      [randomUUID(), establishment.id, mediaId, JSON.stringify({ reason: 'low_confidence' })],
    );

    const before = await request(app)
      .get(`${HEALTH_URL}?refresh=1`)
      .set('Authorization', `Bearer ${adminToken}`);
    const countBefore = before.body.data.hanging_flags.hanging_count;

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject', moderation_notes: { name: 'не подходит' } })
      .expect(200);

    // Обычное чтение, не форсированное: проверяется именно сброс.
    const after = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data.hanging_flags.hanging_count).toBe(countBefore - 1);

    await query('DELETE FROM establishments WHERE id = $1', [establishment.id]);
    qualityHealthService.invalidateCache();
  });

  test('сброс не отменяется сборкой, стартовавшей до него', async () => {
    // Дефект самой правки, найденный вторым ревью: `invalidateCache()` ставит
    // cache = null, и условие записи, начинавшееся с `!cache`, пропускало любую
    // летящую сборку — она возвращала дореформенный снимок и получала на него
    // полную аренду. Здесь это воспроизводится последовательно: снимок взят,
    // мир изменился, кэш сброшен — обычное чтение обязано увидеть новое.
    const extraId = randomUUID();
    await request(app)
      .get(`${HEALTH_URL}?refresh=1`)
      .set('Authorization', `Bearer ${adminToken}`);

    await query(
      `INSERT INTO menu_items (id, establishment_id, media_id, item_name, sanity_flag, is_hidden_by_admin)
       VALUES ($1, $2, $3, 'После сброса', $4::jsonb, false)`,
      [extraId, hostId, hostMediaId, JSON.stringify({ reason: 'low_confidence' })],
    );
    qualityHealthService.invalidateCache();

    try {
      const after = await request(app).get(HEALTH_URL).set('Authorization', `Bearer ${adminToken}`);
      const expected = await qualityHealthModel.getHangingFlags();
      expect(after.body.data.hanging_flags.hanging_count).toBe(expected.hanging_count);
    } finally {
      await query('DELETE FROM menu_items WHERE id = $1', [extraId]);
      qualityHealthService.invalidateCache();
    }
  });

  // Порядок записи в кэш (медленная ранняя сборка не затирает свежую) проверяется
  // не здесь, а в `src/tests/unit/qualityHealthService.test.js`: гонку нужно
  // расставить по шагам, а на живой базе моменты завершения не подчинить.
});
