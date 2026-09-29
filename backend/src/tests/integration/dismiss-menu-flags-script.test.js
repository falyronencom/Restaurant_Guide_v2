/* eslint-env jest */
/**
 * scripts/dismiss-menu-flags — пакетное снятие флагов проверки (логика —
 * dismiss.js, запуск — index.js).
 *
 * Скрипт пишет в прод мимо сервера. Здесь на настоящей базе проверены:
 * граница пачки, подтверждённое число и состав (отпечаток), автор записи,
 * журнал на каждую позицию, откат с выходом соединения из транзакции, гонка
 * с модератором, снимающим флаг в ту же секунду, и сам запуск index.js
 * (только локальная база: вызова с --production здесь нет и быть не должно —
 * в основном checkout рядом лежит backend/.env.production).
 *
 * Не проверено тестами: откат при отказах ДО записи (автор, заведение) —
 * снаружи он не наблюдаем, а index.js после отказа закрывает соединение.
 * Ожидаемые значения — литералы: сырники и чай из волны 28.09.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import {
  VIEWER_CREDENTIALS,
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  createViewerAndGetToken,
} from '../utils/adminTestHelpers.js';
import { SANITY_FLAG_REASONS } from '../../services/ocr/sanityChecker.js';
import {
  REASON_LABELS,
  Refusal,
  applyDismissal,
  confirmationText,
  describeFlag,
  fingerprint,
  listFlaggedVenues,
  planDismissal,
  plural,
} from '../../../scripts/dismiss-menu-flags/dismiss.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../../../scripts/dismiss-menu-flags/index.js');

const DELTA = 'price_delta_anomaly';
const ADMIN_EMAIL = 'admin@test.com';
/** Метка вставки фикстур: запись обязана сдвинуть updated_at с неё, как панель. */
const SEEDED_AT = '2026-09-28 10:00:00';

const SYRNIKI_FLAG = {
  reason: DELTA,
  details: { previousPrice: 240, currentPrice: 22, ratio: 10.91, threshold: 3 },
};
const TEA_FLAG = {
  reason: DELTA,
  details: { previousPrice: 500, currentPrice: 4, ratio: 125, threshold: 3 },
};
const BORSCH_FLAG = {
  reason: DELTA,
  details: { previousPrice: 350, currentPrice: 9, ratio: 38.89, threshold: 3 },
};
const COFFEE_FLAG = {
  reason: DELTA,
  details: { previousPrice: 200, currentPrice: 5, ratio: 40, threshold: 3 },
};
const SALAD_FLAG = {
  reason: 'low_confidence',
  details: { confidence: 0.5, threshold: 0.7 },
};

let adminId;

beforeAll(async () => {
  adminId = (await createAdminAndGetToken()).user.id;
  await createViewerAndGetToken();
});

beforeEach(async () => {
  // menu_items и establishment_media уходят каскадом; у audit_log внешнего
  // ключа на заведения нет — чистится отдельно.
  await query('TRUNCATE TABLE establishments CASCADE');
  await query('TRUNCATE TABLE audit_log');
});

afterAll(async () => {
  await clearAllData();
});

async function seedVenue(name, { status = 'active', city = 'Минск' } = {}) {
  const { partner, establishment } = await createPartnerWithEstablishment(status);
  await query('UPDATE establishments SET name = $1, city = $2 WHERE id = $3', [
    name,
    city,
    establishment.id,
  ]);
  const media = await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
     RETURNING id`,
    [establishment.id],
  );
  return { id: establishment.id, mediaId: media.rows[0].id, partnerEmail: partner.user.email };
}

async function seedItem(venue, itemName, price, flag, { hidden = false, position = 0 } = {}) {
  const { rows } = await query(
    `INSERT INTO menu_items
       (establishment_id, media_id, item_name, price_byn, sanity_flag,
        is_hidden_by_admin, hidden_reason, position, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $9)
     RETURNING id`,
    [
      venue.id,
      venue.mediaId,
      itemName,
      price,
      JSON.stringify(flag),
      hidden,
      hidden ? 'проверено вручную' : null,
      position,
      SEEDED_AT,
    ],
  );
  return rows[0].id;
}

/** Волна 28.09 в миниатюре: два заведения с флагами цены, третье — чужое. */
async function seedWave() {
  const pigeon = await seedVenue('Le Pigeon');
  const malevich = await seedVenue('МАЛЕВИЧ');
  const other = await seedVenue('Другое место');
  const ids = {
    syrniki: await seedItem(pigeon, 'Сырники', 22, SYRNIKI_FLAG, { position: 0 }),
    tea: await seedItem(pigeon, 'Чай', 4, TEA_FLAG, { position: 1, hidden: true }),
    salad: await seedItem(pigeon, 'Салат', 12, SALAD_FLAG, { position: 2 }),
    borsch: await seedItem(malevich, 'Борщ', 9, BORSCH_FLAG),
    coffee: await seedItem(other, 'Кофе', 5, COFFEE_FLAG),
  };
  return { pigeon, malevich, other, ids };
}

const flagOf = async (id) =>
  (await query('SELECT sanity_flag FROM menu_items WHERE id = $1', [id])).rows[0].sanity_flag;

const auditCount = async () =>
  (await query('SELECT COUNT(*)::int AS n FROM audit_log')).rows[0].n;

/** Отказ — именно Refusal (index.js отвечает на него кодом 1), с нужной причиной. */
async function expectRefusal(call, message) {
  let caught;
  try {
    await call();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Refusal);
  expect(caught.message).toMatch(message);
  return caught;
}

describe('scripts/dismiss-menu-flags — на базе', () => {
  let client;

  beforeEach(async () => {
    client = await pool.connect();
  });

  // true — соединение уничтожается, а не возвращается в пул: транзакция,
  // которую тест мог оставить открытой, не переедет в следующий тест.
  afterEach(() => client.release(true));

  /** Запись по свежему сухому прогону — так, как её ведёт сессия. */
  const applyAfterPlan = async (establishments, overrides = {}) => {
    const plan = await planDismissal(client, { establishments, reason: DELTA });
    return applyDismissal(client, {
      establishments,
      reason: DELTA,
      expect: plan.total,
      plan: plan.fingerprint,
      adminEmail: ADMIN_EMAIL,
      ...overrides,
    });
  };

  test('сухой прогон: флаги причины у названного заведения, скрытые тоже; ничего не пишет', async () => {
    const { pigeon, ids } = await seedWave();

    const plan = await planDismissal(client, { establishments: [pigeon.id], reason: DELTA });

    expect(plan.total).toBe(2);
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{10}$/);
    expect(plan.venues.map((v) => [v.name, v.items.map((i) => i.item_name)]))
      .toEqual([['Le Pigeon', ['Сырники', 'Чай']]]);
    expect(await flagOf(ids.syrniki)).toEqual(SYRNIKI_FLAG);
    expect(await flagOf(ids.tea)).toEqual(TEA_FLAG);
    expect(await auditCount()).toBe(0);
  });

  test('запись: снимает ровно пачку, журнал на каждую позицию, скрытие не трогает', async () => {
    const { pigeon, ids } = await seedWave();

    const result = await applyAfterPlan([pigeon.id]);

    expect(await flagOf(ids.syrniki)).toBeNull();
    expect(await flagOf(ids.tea)).toBeNull();
    // Не тронуты: другая причина у того же заведения, та же причина у других.
    expect(await flagOf(ids.salad)).toEqual(SALAD_FLAG);
    expect(await flagOf(ids.borsch)).toEqual(BORSCH_FLAG);
    expect(await flagOf(ids.coffee)).toEqual(COFFEE_FLAG);

    const { rows: [tea] } = await query(
      `SELECT is_hidden_by_admin, hidden_reason,
              updated_at = $2::timestamp AS updated_at_unchanged
         FROM menu_items WHERE id = $1`,
      [ids.tea, SEEDED_AT],
    );
    expect(tea).toEqual({
      is_hidden_by_admin: true,
      hidden_reason: 'проверено вручную',
      // Как у «Снять флаг» в панели (MenuItemModel.updateById).
      updated_at_unchanged: false,
    });

    const { rows: audit } = await query(
      `SELECT user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent
         FROM audit_log`,
    );
    expect(audit).toHaveLength(2);
    const entry = (entityId, flag) => ({
      user_id: adminId,
      action: 'dismiss_sanity_flag',
      entity_type: 'menu_item',
      entity_id: entityId,
      old_data: { sanity_flag: flag },
      new_data: { sanity_flag: null },
      ip_address: null,
      user_agent: 'scripts/dismiss-menu-flags',
    });
    expect(audit).toEqual(expect.arrayContaining([
      entry(ids.syrniki, SYRNIKI_FLAG),
      entry(ids.tea, TEA_FLAG),
    ]));

    expect([...result.dismissed].sort()).toEqual([ids.syrniki, ids.tea].sort());
  });

  test('несколько заведений — одна пачка, число — сумма', async () => {
    const { pigeon, ids } = await seedWave();

    const result = await applyAfterPlan([pigeon.id, 'МАЛЕВИЧ']);

    expect(result.dismissed).toHaveLength(3);
    expect(await flagOf(ids.borsch)).toBeNull();
    expect(await flagOf(ids.coffee)).toEqual(COFFEE_FLAG);
    expect(await auditCount()).toBe(3);
  });

  test.each([
    [1, 'меньше'],
    [3, 'больше'],
  ])('подтверждено %i (%s, чем есть) — отказ, ничего не изменено, соединение вне транзакции', async (confirmed) => {
    const { pigeon, ids } = await seedWave();
    const plan = await planDismissal(client, { establishments: [pigeon.id], reason: DELTA });

    await expectRefusal(
      () => applyDismissal(client, {
        establishments: [pigeon.id],
        reason: DELTA,
        expect: confirmed,
        plan: plan.fingerprint,
        adminEmail: ADMIN_EMAIL,
      }),
      new RegExp(`Под условие попало 2, подтверждено ${confirmed} — ничего не изменено`),
    );

    // То же соединение: без отката оно видело бы свою незавершённую запись.
    const { rows } = await client.query('SELECT sanity_flag FROM menu_items WHERE id = $1', [ids.syrniki]);
    expect(rows[0].sanity_flag).toEqual(SYRNIKI_FLAG);
    expect(await flagOf(ids.tea)).toEqual(TEA_FLAG);
    expect(await auditCount()).toBe(0);
  });

  test('число сошлось, состав — нет: отказ по отпечатку, ничего не изменено', async () => {
    const { pigeon, ids } = await seedWave();
    const plan = await planDismissal(client, { establishments: [pigeon.id], reason: DELTA });

    // Между сухим прогоном и записью: сырники сняли в панели, а повторное
    // распознавание принесло новый флаг той же причины. Позиций снова две.
    await query('UPDATE menu_items SET sanity_flag = NULL WHERE id = $1', [ids.syrniki]);
    const pancakes = await seedItem(pigeon, 'Блины', 3, COFFEE_FLAG, { position: 3 });

    await expectRefusal(
      () => applyDismissal(client, {
        establishments: [pigeon.id],
        reason: DELTA,
        expect: 2,
        plan: plan.fingerprint,
        adminEmail: ADMIN_EMAIL,
      }),
      new RegExp(`Число сошлось \\(2\\), но состав — не тот.*ожидался ${plan.fingerprint}`),
    );

    expect(await flagOf(ids.tea)).toEqual(TEA_FLAG);
    expect(await flagOf(pancakes)).toEqual(COFFEE_FLAG);
    expect(await auditCount()).toBe(0);
  });

  test('флаг сняли в панели, пока шла запись, — отказ, а не повторное снятие с лишней записью журнала', async () => {
    const { pigeon, ids } = await seedWave();
    const plan = await planDismissal(client, { establishments: [pigeon.id], reason: DELTA });

    // «Панель»: снимает флаг сырников и держит строку до COMMIT.
    const panel = await pool.connect();
    let outcome;
    try {
      await panel.query('BEGIN');
      await panel.query(
        'UPDATE menu_items SET sanity_flag = NULL, updated_at = NOW() WHERE id = $1',
        [ids.syrniki],
      );

      const pending = applyDismissal(client, {
        establishments: [pigeon.id],
        reason: DELTA,
        expect: 2,
        plan: plan.fingerprint,
        adminEmail: ADMIN_EMAIL,
      }).then(() => null, (err) => err);

      // Предпосылка сцены — запись действительно упёрлась в строку «панели».
      // Без этого тест прошёл бы и там, где гонки не было.
      let waitingOnLock = false;
      for (let i = 0; i < 250 && !waitingOnLock; i += 1) {
        const { rows } = await pool.query(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
          [client.processID],
        );
        waitingOnLock = rows[0]?.wait_event_type === 'Lock';
        if (!waitingOnLock) await new Promise((r) => setTimeout(r, 20));
      }
      expect(waitingOnLock).toBe(true);

      await panel.query('COMMIT');
      outcome = await pending;
    } finally {
      panel.release(true);
    }

    expect(outcome).toBeInstanceOf(Refusal);
    expect(outcome.message).toMatch(/Под условие попало 1, подтверждено 2/);
    expect(await flagOf(ids.syrniki)).toBeNull();
    expect(await flagOf(ids.tea)).toEqual(TEA_FLAG);
    expect(await auditCount()).toBe(0);
  });

  test('запись требует подтверждённое число и отпечаток сухого прогона', async () => {
    const { pigeon, ids } = await seedWave();
    const plan = await planDismissal(client, { establishments: [pigeon.id], reason: DELTA });

    for (const bad of [undefined, 0, -2, 2.5, '2']) {
      await expectRefusal(
        () => applyDismissal(client, {
          establishments: [pigeon.id],
          reason: DELTA,
          expect: bad,
          plan: plan.fingerprint,
          adminEmail: ADMIN_EMAIL,
        }),
        /Запись требует --expect=<N>/,
      );
    }
    for (const bad of [undefined, '', 'abc', `${plan.fingerprint}0`, 'ABCDEF0123']) {
      await expectRefusal(
        () => applyDismissal(client, {
          establishments: [pigeon.id],
          reason: DELTA,
          expect: 2,
          plan: bad,
          adminEmail: ADMIN_EMAIL,
        }),
        /Запись требует --plan=<отпечаток>/,
      );
    }
    expect(await flagOf(ids.syrniki)).toEqual(SYRNIKI_FLAG);
    expect(await auditCount()).toBe(0);
  });

  test('автор записи — только действующий администратор; почта без учёта регистра и пробелов', async () => {
    const { pigeon, ids } = await seedWave();
    await query(
      `INSERT INTO users (email, name, role, auth_method, is_active)
       VALUES ('retired-admin@test.com', 'Бывший админ', 'admin', 'email', false)`,
    );

    const cases = [
      [VIEWER_CREDENTIALS.email, /роль viewer: снимать флаги может только admin/],
      [pigeon.partnerEmail, /роль partner: снимать флаги может только admin/],
      ['retired-admin@test.com', /Аккаунт retired-admin@test\.com отключён/],
      ['nobody@test.com', /Аккаунта с почтой nobody@test\.com нет/],
      [undefined, /Запись требует --admin-email/],
    ];
    for (const [email, message] of cases) {
      await expectRefusal(() => applyAfterPlan([pigeon.id], { adminEmail: email }), message);
    }
    expect(await flagOf(ids.syrniki)).toEqual(SYRNIKI_FLAG);
    expect(await auditCount()).toBe(0);

    const result = await applyAfterPlan([pigeon.id], { adminEmail: ' ADMIN@Test.com ' });
    expect(result.author.id).toBe(adminId);
  });

  test('причина — только из канона', async () => {
    const { pigeon } = await seedWave();

    await expectRefusal(
      () => planDismissal(client, { establishments: [pigeon.id], reason: 'price_delta' }),
      /Неизвестная причина «price_delta»/,
    );
    await expectRefusal(
      () => applyDismissal(client, {
        establishments: [pigeon.id],
        reason: 'price_delta',
        expect: 2,
        plan: '0123456789',
        adminEmail: ADMIN_EMAIL,
      }),
      /Неизвестная причина «price_delta»/,
    );
    await expectRefusal(() => listFlaggedVenues(client, 'price_delta'), /Неизвестная причина/);
  });

  test('заведение: точное название; одно название у двух — отказ со списком id; вне очереди — отказ', async () => {
    const { pigeon } = await seedWave();

    // Название (с пробелами по краям) и id одного заведения — одно заведение.
    const plan = await planDismissal(client, {
      establishments: [' Le Pigeon ', pigeon.id],
      reason: DELTA,
    });
    expect(plan.venues.map((v) => v.id)).toEqual([pigeon.id]);
    expect(plan.total).toBe(2);

    await expectRefusal(
      () => planDismissal(client, { establishments: ['le pigeon'], reason: DELTA }),
      /Заведение «le pigeon» не найдено/,
    );
    await expectRefusal(
      () => planDismissal(client, { establishments: [], reason: DELTA }),
      /Не названо ни одного заведения/,
    );

    const twin = await seedVenue('Le Pigeon', { city: 'Гродно' });
    const ambiguous = await expectRefusal(
      () => planDismissal(client, { establishments: ['Le Pigeon'], reason: DELTA }),
      /Название «Le Pigeon» у 2 заведений — укажите id/,
    );
    expect(ambiguous.message).toContain(pigeon.id);
    expect(ambiguous.message).toContain(twin.id);

    // Приостановленное — в очереди (его флаги модератор видит), закрытое — нет.
    const suspended = await seedVenue('Приостановленное', { status: 'suspended' });
    await seedItem(suspended, 'Суп', 7, COFFEE_FLAG);
    expect((await planDismissal(client, { establishments: [suspended.id], reason: DELTA })).total)
      .toBe(1);

    const archived = await seedVenue('Закрытое', { status: 'archived' });
    const soup = await seedItem(archived, 'Суп', 7, COFFEE_FLAG);
    await expectRefusal(
      () => planDismissal(client, { establishments: [archived.id], reason: DELTA }),
      /статус archived, вне очереди модерации/,
    );
    await expectRefusal(
      () => applyDismissal(client, {
        establishments: [archived.id],
        reason: DELTA,
        expect: 1,
        plan: '0123456789',
        adminEmail: ADMIN_EMAIL,
      }),
      /статус archived, вне очереди модерации/,
    );
    expect(await flagOf(soup)).toEqual(COFFEE_FLAG);
  });

  test('список: только заведения очереди, по числу флагов, со скрытыми', async () => {
    await seedWave();
    const archived = await seedVenue('Закрытое', { status: 'archived' });
    await seedItem(archived, 'Суп', 7, COFFEE_FLAG);

    const venues = await listFlaggedVenues(client, DELTA);

    expect(venues.map((v) => [v.name, v.items, v.hidden])).toEqual([
      ['Le Pigeon', 2, 1],
      ['Другое место', 1, 0],
      ['МАЛЕВИЧ', 1, 0],
    ]);
  });
});

describe('scripts/dismiss-menu-flags — запуск index.js (локальная база)', () => {
  /**
   * Процесс наследует DB_* теста — значит, пишет в ту же тестовую базу.
   * spawnSync держит цикл событий jest, но соединений пула в это время никто
   * не ждёт.
   */
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {
    env: process.env,
    encoding: 'utf8',
  });

  test('ошибка в команде — код 2 до подключения к базе', () => {
    const cases = [
      [['--establishment=x'], /Нужен --reason=<причина>/],
      [['--reason=price_delta_anomaly', '--establishments=x'], /Неизвестный аргумент: --establishments=x/],
      [['--reason=price_delta_anomaly', '--aply'], /Неизвестный аргумент: --aply/],
      [['--reason=price_delta_anomaly', '--reason=low_confidence'], /--reason указан дважды/],
      [['--reason=price_delta_anomaly', '--establishment=x', '--expect=два'], /--expect — целое число/],
      [['--reason=price_delta_anomaly', '--apply'], /Запись требует --establishment/],
      [['--reason=price_delta_anomaly', '--establishment=x', '--apply'], /Запись требует --expect/],
      [['--reason=price_delta_anomaly', '--establishment=x', '--expect=2', '--apply'], /Запись требует --plan/],
      [['--reason=price_delta_anomaly', '--establishment=x', '--expect=2', '--plan=0123456789', '--apply'],
        /Запись требует --admin-email/],
    ];
    for (const [args, message] of cases) {
      const res = run(...args);
      expect({ args, status: res.status }).toEqual({ args, status: 2 });
      expect(res.stderr).toMatch(message);
    }
  });

  test('список → сухой прогон → запись по его N и отпечатку; отказ — код 1', async () => {
    const { pigeon, ids } = await seedWave();

    const list = run('--reason=price_delta_anomaly');
    expect(list.status).toBe(0);
    expect(list.stdout).toMatch(/^Цель: локальная база /);
    expect(list.stdout).toContain(`${pigeon.id}  Le Pigeon · Минск · active — 2 (скрыто 1)`);

    const dry = run('--reason=price_delta_anomaly', `--establishment=${pigeon.id}`);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('  Сырники — цена упала с 240 до 22 BYN — в 10,9 раза');
    expect(dry.stdout).toContain('  Чай — цена упала с 500 до 4 BYN — в 125 раз  [скрыта]');
    expect(dry.stdout).toContain(
      'Вопрос Координатору: Снять 2 флага «Резкое изменение цены» у Le Pigeon (Минск)?',
    );
    const [, fp] = /--expect=2 --plan=([0-9a-f]{10}) --admin-email=<почта> --apply/.exec(dry.stdout) ?? [];
    expect(fp).toMatch(/^[0-9a-f]{10}$/);
    expect(await flagOf(ids.syrniki)).toEqual(SYRNIKI_FLAG);

    const common = ['--reason=price_delta_anomaly', `--establishment=${pigeon.id}`,
      `--admin-email=${ADMIN_EMAIL}`, '--apply'];
    const refused = run(...common, '--expect=3', `--plan=${fp}`);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/⛔ Отказ: Под условие попало 2, подтверждено 3/);
    // Отпечаток сверяется тот, что дал оператор, а не свежий сухой прогон.
    const foreign = run(...common, '--expect=2', '--plan=0123456789');
    expect(foreign.status).toBe(1);
    expect(foreign.stderr).toMatch(/⛔ Отказ: Число сошлось \(2\), но состав — не тот/);
    expect(await flagOf(ids.syrniki)).toEqual(SYRNIKI_FLAG);

    const applied = run(...common, '--expect=2', `--plan=${fp}`);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain(
      `✅ Снято флагов: 2; записей в журнале действий: 2 (автор ${ADMIN_EMAIL}).`,
    );
    expect(await flagOf(ids.syrniki)).toBeNull();
    expect(await flagOf(ids.tea)).toBeNull();
    expect(await flagOf(ids.borsch)).toEqual(BORSCH_FLAG);
    expect(await auditCount()).toBe(2);
  });
});

describe('scripts/dismiss-menu-flags — тексты', () => {
  test('вопрос Координатору — текст, утверждённый 29.09.2026', () => {
    const venue = (name) => ({ name, city: 'Минск', items: [] });

    expect(confirmationText({ reason: DELTA, total: 19, venues: [venue('Le Pigeon')] })).toBe(
      'Снять 19 флагов «Резкое изменение цены» у Le Pigeon (Минск)? Позиции уйдут из очереди. '
      + 'Скрытые позиции останутся скрытыми. Каждая попадёт в журнал действий.',
    );
    expect(confirmationText({
      reason: DELTA,
      total: 32,
      venues: [venue('Le Pigeon'), venue('МАЛЕВИЧ')],
    })).toBe(
      'Снять 32 флага «Резкое изменение цены» у Le Pigeon (Минск) и МАЛЕВИЧ (Минск)? '
      + 'Позиции уйдут из очереди. Скрытые позиции останутся скрытыми. '
      + 'Каждая попадёт в журнал действий.',
    );
    expect(confirmationText({ reason: 'price_above_threshold', total: 1, venues: [venue('Zalkind')] }))
      .toBe('Снять 1 флаг «Цена выше порога» у Zalkind (Минск)? Позиция уйдёт из очереди. '
        + 'Если она скрыта, то останется скрытой. Снятие попадёт в журнал действий.');
  });

  test('отпечаток не зависит от порядка id и различает состав', () => {
    expect(fingerprint(['b', 'a', 'c'])).toBe(fingerprint(['a', 'c', 'b']));
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['a', 'c']));
    expect(fingerprint(['a'])).toMatch(/^[0-9a-f]{10}$/);
  });

  test('склонение', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 112, 121]
      .map((n) => `${n} ${plural(n, 'флаг', 'флага', 'флагов')}`))
      .toEqual([
        '1 флаг', '2 флага', '4 флага', '5 флагов', '11 флагов', '12 флагов', '14 флагов',
        '21 флаг', '22 флага', '25 флагов', '111 флагов', '112 флагов', '121 флаг',
      ]);
  });

  test('строка позиции — фраза панели (describeSanityFlag), числа по её форматтерам', () => {
    // Разделитель тысяч ru — неразрывный пробел U+00A0, как у NumberFormat панели.
    expect(describeFlag(SYRNIKI_FLAG)).toBe('цена упала с 240 до 22 BYN — в 10,9 раза');
    expect(describeFlag({ reason: DELTA, details: { previousPrice: 5, currentPrice: 20, ratio: 4 } }))
      .toBe('цена выросла с 5 до 20 BYN — в 4 раза');
    expect(describeFlag({ reason: DELTA, details: { previousPrice: 100, currentPrice: 20, ratio: 5 } }))
      .toBe('цена упала с 100 до 20 BYN — в 5 раз');
    expect(describeFlag({ reason: DELTA, details: { previousPrice: 12.5, currentPrice: 38, ratio: 3.04 } }))
      .toBe('цена выросла с 12,50 до 38 BYN — в 3,0 раза');
    expect(describeFlag({ reason: 'price_above_threshold', details: { price: 1200, threshold: 1000 } }))
      .toBe('цена 1 200 BYN при пороге 1 000 BYN');
    expect(describeFlag({ reason: 'price_below_threshold', details: { price: '0.00', threshold: 0.5 } }))
      .toBe('цена 0 BYN при пороге 0,50 BYN');
    expect(describeFlag(SALAD_FLAG)).toBe('уверенность распознавания 50% при пороге 70%');
    // Неполные подробности — исходная запись, а не «NaN».
    expect(describeFlag({ reason: DELTA, details: {} })).toBe('{"reason":"price_delta_anomaly","details":{}}');
  });

  test('подписи причин — те же, что в панели, и есть у каждой причины канона', () => {
    const dart = readFileSync(
      resolve(HERE, '../../../../admin-web/lib/config/moderation_vocabulary.dart'),
      'utf8',
    );
    // Якорь: блок карты найден ровно один раз, иначе проверка ослепла бы молча.
    const blocks = [...dart.matchAll(/kSanityFlagReasons = <String, String>\{([\s\S]*?)\};/g)];
    expect(blocks).toHaveLength(1);
    const panel = Object.fromEntries(
      [...blocks[0][1].matchAll(/'([a-z_]+)':\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
    );

    expect(REASON_LABELS).toEqual(panel);
    expect(Object.keys(REASON_LABELS).sort()).toEqual([...SANITY_FLAG_REASONS].sort());
  });
});
