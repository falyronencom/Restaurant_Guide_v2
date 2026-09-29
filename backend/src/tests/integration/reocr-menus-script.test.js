/* eslint-env jest */
/**
 * scripts/reocr-menus — какие файлы меню перераспознавать (логика —
 * scripts/reocr-menus/plan.js). Сам reocr-menus.js здесь не запускается: он
 * читает только backend/.env.production, то есть прод.
 *
 * На настоящей базе:
 * - тронута ли позиция человеком и чем; снятие флага правкой не считается;
 *   окно в 1 с; последнее изменение объясняет ПОСЛЕДНЯЯ запись журнала в
 *   окне; запись журнала о соседней позиции не объясняет ничего;
 * - те же правила на записях настоящих писателей: «Снять флаг», «Скрыть» и
 *   «Показать» панели (adminService), скрипт dismiss-menu-flags;
 * - прежние причины пропуска (формат, задача в очереди), статусы, файл без
 *   позиций, --include-touched;
 * - строки отчёта.
 *
 * Отдельно — страж ПРИНЦИПА, на котором держится правило про снятый флаг:
 * непустой sanity_flag пишут только вставки распознавания, каждая правка
 * содержимого существующей позиции его обнуляет (сегодня это правка
 * партнёра), и снять после неё нечего. Покраснел страж — пересматривать
 * правило в plan.js, а не страж.
 *
 * Метки фикстур — литералы от BASE: наивные колонки сравниваются между собой,
 * пояс процесса на них не влияет. Настоящие писатели пишут NOW() базы, их
 * позиции вставлены сутки назад по часам той же базы.
 */

import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { createAdminAndGetToken, createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';
import * as adminService from '../../services/adminService.js';
import * as partnerMenuItemService from '../../services/partnerMenuItemService.js';
import { applyDismissal, planDismissal } from '../../../scripts/dismiss-menu-flags/dismiss.js';
import { TOUCHED_REASON, formatPlan, planReocr } from '../../../scripts/reocr-menus/plan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../../..');

const DISMISS = 'dismiss_sanity_flag';
const HIDE = 'hide_menu_item';
const UNHIDE = 'unhide_menu_item';
const TOUCHED = TOUCHED_REASON;
const DELTA_FLAG = {
  reason: 'price_delta_anomaly',
  details: { previousPrice: 240, currentPrice: 22, ratio: 10.91, threshold: 3 },
};
const ADMIN_EMAIL = 'admin@test.com';
/** Метка вставки позиций в фикстурах-литералах. */
const BASE = '2026-09-28 10:00:00';

let adminId;

beforeAll(async () => {
  adminId = (await createAdminAndGetToken()).user.id;
});

beforeEach(async () => {
  // Файлы, позиции и задачи уходят каскадом; у audit_log внешнего ключа на
  // заведения нет — чистится отдельно.
  await query('TRUNCATE TABLE establishments CASCADE');
  await query('TRUNCATE TABLE audit_log');
});

afterAll(async () => {
  await clearAllData();
});

async function seedVenue(name, { status = 'active' } = {}) {
  const { partner, establishment } = await createPartnerWithEstablishment(status);
  await query('UPDATE establishments SET name = $1 WHERE id = $2', [name, establishment.id]);
  return { id: establishment.id, partnerId: partner.user.id };
}

/** Файл меню заведения; позиция в списке файлов — по порядку создания. */
async function seedFile(venue, { url = 'http://test/menu.pdf' } = {}) {
  const { rows } = await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url, position)
     VALUES ($1, 'menu', 'pdf', $2, 'http://test/t.png', 'http://test/p.png',
             (SELECT COUNT(*) FROM establishment_media WHERE establishment_id = $1))
     RETURNING id`,
    [venue.id, url],
  );
  return { venueId: venue.id, mediaId: rows[0].id };
}

/** Позиция файла: вставлена в base, изменена через updatedAfter секунд (0 — не менялась). */
async function seedItem(file, itemName, { flag = null, hidden = false, updatedAfter = 0, base = BASE } = {}) {
  const { rows } = await query(
    `INSERT INTO menu_items
       (establishment_id, media_id, item_name, price_byn, sanity_flag,
        is_hidden_by_admin, hidden_reason, created_at, updated_at)
     VALUES ($1, $2, $3, 10, $4::jsonb, $5, $6, $7::timestamp,
             $7::timestamp + make_interval(secs => $8))
     RETURNING id`,
    [
      file.venueId,
      file.mediaId,
      itemName,
      flag && JSON.stringify(flag),
      hidden,
      hidden ? 'проверено вручную' : null,
      base,
      updatedAfter,
    ],
  );
  return rows[0].id;
}

/** Запись журнала о позиции через seconds секунд после BASE. */
async function journal(itemId, action, seconds) {
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, created_at)
     VALUES ($1, $2, 'menu_item', $3, $4::timestamp + make_interval(secs => $5))`,
    [adminId, action, itemId, BASE, seconds],
  );
}

/** Сутки назад по часам базы — метка вставки для настоящих писателей. */
const yesterday = async () => (await query(
  "SELECT to_char(NOW() - interval '1 day', 'YYYY-MM-DD HH24:MI:SS.US') AS t",
)).rows[0].t;

/**
 * Таблица по файлам, в порядке files:
 * [файл, вердикт, позиций, скрыто модератором, показано после скрытия,
 *  правка без записи в журнале, последним снят флаг]. Вердикт — причина
 * пропуска или «в работу».
 */
const verdicts = ({ targets, skipped }, files) => {
  const byMedia = new Map([
    ...targets.map((row) => [row.media_id, { ...row, verdict: 'в работу' }]),
    ...skipped.map((row) => [row.media_id, { ...row, verdict: row.reason }]),
  ]);
  return Object.entries(files).map(([label, file]) => {
    const row = byMedia.get(file.mediaId);
    return row
      ? [label, row.verdict, row.items, row.hidden, row.unhidden, row.unlogged, row.flag_dismissed]
      : [label, 'нет в отчёте'];
  });
};

describe('scripts/reocr-menus — отбор файлов на базе', () => {
  let client;

  beforeEach(async () => {
    client = await pool.connect();
  });

  // true — соединение уничтожается: транзакция скрипта снятия, если тест
  // оставил её открытой, не переедет в следующий тест.
  afterEach(() => client.release(true));

  const plan = (options = {}) => planReocr(client, { statuses: ['active'], ...options });

  test('тронута ли позиция — по последнему изменению; снятый флаг — не правка', async () => {
    const cafe = await seedVenue('Кафе');
    const files = {};
    const file = async (label) => {
      files[label] = await seedFile(cafe);
      return files[label];
    };
    let id;

    await seedItem(await file('не менялась'), 'Суп');
    await seedItem(await file('сдвиг 0,5 с после вставки'), 'Суп', { updatedAfter: 0.5 });

    // Панель: журнал отдельным запросом — позже updated_at на миллисекунды.
    id = await seedItem(await file('снят флаг панелью'), 'Суп', { updatedAfter: 3600 });
    await journal(id, DISMISS, 3600.004);
    // Скрипт dismiss-menu-flags: снятие и журнал одним запросом — метки равны.
    id = await seedItem(await file('снят флаг скриптом'), 'Суп', { updatedAfter: 3600 });
    await journal(id, DISMISS, 3600);
    // Окно: запись за 0,9 с до updated_at объясняет его, за 1,1 с — уже нет.
    id = await seedItem(await file('снятие за 0,9 с до updated_at'), 'Суп', { updatedAfter: 3600 });
    await journal(id, DISMISS, 3599.1);
    id = await seedItem(await file('снятие за 1,1 с до updated_at'), 'Суп', { updatedAfter: 3600 });
    await journal(id, DISMISS, 3598.9);

    await seedItem(await file('без записи в журнале'), 'Суп', { updatedAfter: 3600 });

    // Скрыта сейчас — правка, даже если последним сняли флаг.
    id = await seedItem(await file('скрыта, потом снят флаг'), 'Суп', { hidden: true, updatedAfter: 7200 });
    await journal(id, HIDE, 3600);
    await journal(id, DISMISS, 7200);
    id = await seedItem(await file('скрыта и показана'), 'Суп', { updatedAfter: 7200 });
    await journal(id, HIDE, 3600);
    await journal(id, UNHIDE, 7200);
    // Решает последняя запись в окне: снятие после показа — не правка…
    id = await seedItem(await file('скрыта, показана, снят флаг'), 'Суп', { updatedAfter: 10800 });
    await journal(id, HIDE, 3600);
    await journal(id, UNHIDE, 7200);
    await journal(id, DISMISS, 10800);
    // …а показ после снятия, даже в ту же секунду, — правка.
    id = await seedItem(await file('снят флаг, скрыта и показана за 0,4 с'), 'Суп', { updatedAfter: 3600.4 });
    await journal(id, DISMISS, 3600);
    await journal(id, HIDE, 3600.2);
    await journal(id, UNHIDE, 3600.4);

    // Запись журнала о соседней позиции не объясняет правку этой.
    const pair = await file('соседке сняли флаг, эту правили без журнала');
    id = await seedItem(pair, 'Суп', { updatedAfter: 3600 });
    await journal(id, DISMISS, 3600.004);
    await seedItem(pair, 'Салат', { updatedAfter: 3600 });

    expect(verdicts(await plan(), files)).toEqual([
      ['не менялась', 'в работу', 1, 0, 0, 0, 0],
      ['сдвиг 0,5 с после вставки', 'в работу', 1, 0, 0, 0, 0],
      ['снят флаг панелью', 'в работу', 1, 0, 0, 0, 1],
      ['снят флаг скриптом', 'в работу', 1, 0, 0, 0, 1],
      ['снятие за 0,9 с до updated_at', 'в работу', 1, 0, 0, 0, 1],
      ['снятие за 1,1 с до updated_at', TOUCHED, 1, 0, 0, 1, 0],
      ['без записи в журнале', TOUCHED, 1, 0, 0, 1, 0],
      ['скрыта, потом снят флаг', TOUCHED, 1, 1, 0, 0, 0],
      ['скрыта и показана', TOUCHED, 1, 0, 1, 0, 0],
      ['скрыта, показана, снят флаг', 'в работу', 1, 0, 0, 0, 1],
      ['снят флаг, скрыта и показана за 0,4 с', TOUCHED, 1, 0, 1, 0, 0],
      ['соседке сняли флаг, эту правили без журнала', TOUCHED, 2, 0, 0, 1, 1],
    ]);
  });

  test('настоящие писатели: снятие флага панелью и скриптом — не правка; скрытие и показ — правка', async () => {
    const cafe = await seedVenue('Кафе');
    const base = await yesterday();
    const files = {};
    const ids = {};
    for (const [label, flag] of [
      ['панель: «Снять флаг»', DELTA_FLAG],
      ['скрипт снятия флагов', DELTA_FLAG],
      ['панель: «Скрыть»', null],
      ['панель: «Скрыть», затем «Показать»', null],
    ]) {
      files[label] = await seedFile(cafe);
      ids[label] = await seedItem(files[label], 'Суп', { flag, base });
    }
    const actor = { adminUserId: adminId, ipAddress: '127.0.0.1', userAgent: 'jest' };

    await adminService.dismissMenuItemFlag(ids['панель: «Снять флаг»'], actor);
    // Второй флаг остался один — его снимает скрипт.
    const dry = await planDismissal(client, { establishments: [cafe.id], reason: DELTA_FLAG.reason });
    expect(dry.total).toBe(1);
    await applyDismissal(client, {
      establishments: [cafe.id],
      reason: DELTA_FLAG.reason,
      expect: 1,
      plan: dry.fingerprint,
      adminEmail: ADMIN_EMAIL,
    });
    await adminService.hideMenuItem(ids['панель: «Скрыть»'], { ...actor, reason: 'не блюдо' });
    await adminService.hideMenuItem(ids['панель: «Скрыть», затем «Показать»'], { ...actor, reason: 'не блюдо' });
    await adminService.unhideMenuItem(ids['панель: «Скрыть», затем «Показать»'], actor);

    expect(verdicts(await plan(), files)).toEqual([
      ['панель: «Снять флаг»', 'в работу', 1, 0, 0, 0, 1],
      ['скрипт снятия флагов', 'в работу', 1, 0, 0, 0, 1],
      ['панель: «Скрыть»', TOUCHED, 1, 1, 0, 0, 0],
      ['панель: «Скрыть», затем «Показать»', TOUCHED, 1, 0, 1, 0, 0],
    ]);
  });

  test('прежние причины пропуска, статусы, файл без позиций, --include-touched', async () => {
    const cafe = await seedVenue('Кафе');
    const draft = await seedVenue('Черновик', { status: 'draft' });
    const archived = await seedVenue('Закрытое', { status: 'archived' });
    const files = {
      'формат .ai': await seedFile(cafe, { url: 'http://test/menu.ai' }),
      'задача в работе': await seedFile(cafe),
      'задача выполнена': await seedFile(cafe),
      'без позиций': await seedFile(cafe),
      'позиция скрыта': await seedFile(cafe),
      'черновик': await seedFile(draft),
      'закрытое заведение': await seedFile(archived),
    };
    for (const [label, file] of Object.entries(files)) {
      if (label !== 'без позиций') await seedItem(file, 'Суп', { hidden: label === 'позиция скрыта' });
    }
    for (const [label, status] of [['задача в работе', 'processing'], ['задача выполнена', 'done']]) {
      await query(
        'INSERT INTO ocr_jobs (establishment_id, media_id, status) VALUES ($1, $2, $3)',
        [cafe.id, files[label].mediaId, status],
      );
    }

    const statuses = ['active', 'draft'];
    expect(verdicts(await plan({ statuses }), files)).toEqual([
      ['формат .ai', 'формат не читается', 1, 0, 0, 0, 0],
      ['задача в работе', 'задача уже в очереди', 1, 0, 0, 0, 0],
      ['задача выполнена', 'в работу', 1, 0, 0, 0, 0],
      ['без позиций', 'в работу', 0, 0, 0, 0, 0],
      ['позиция скрыта', TOUCHED, 1, 1, 0, 0, 0],
      ['черновик', 'в работу', 1, 0, 0, 0, 0],
      ['закрытое заведение', 'нет в отчёте'],
    ]);
    expect(verdicts(await plan({ statuses, includeTouched: true }), { 'позиция скрыта': files['позиция скрыта'] }))
      .toEqual([['позиция скрыта', 'в работу', 1, 1, 0, 0, 0]]);
  });
});

describe('scripts/reocr-menus — отчёт', () => {
  const row = (over) => ({
    media_id: 'm1',
    name: 'Le Pigeon',
    status: 'active',
    items: 20,
    hidden: 0,
    unhidden: 0,
    unlogged: 0,
    flag_dismissed: 0,
    ...over,
  });

  test('пропуск — с правками людей по категориям; снятые флаги — в итоге', () => {
    expect(formatPlan({
      skipped: [
        row({ media_id: 'm2', name: 'Кафе', items: 4, hidden: 1, unhidden: 1, unlogged: 2, reason: TOUCHED }),
        row({ media_id: 'm3', name: 'Кафе', items: 2, reason: 'задача уже в очереди' }),
      ],
      targets: [
        row({ media_id: 'm1', flag_dismissed: 19 }),
        row({ media_id: 'm4', name: 'МАЛЕВИЧ', items: 30, flag_dismissed: 13 }),
        row({ media_id: 'm5', name: 'МАЛЕВИЧ', items: 5 }),
      ],
    })).toBe([
      '✗ skip  Кафе [active]  media=m2  items=4  — есть правки людей (--include-touched)',
      '          скрыто модератором: 1',
      '          показано после скрытия: 1',
      '          правка без записи в журнале — вероятно, партнёр: 2',
      '✗ skip  Кафе [active]  media=m3  items=2  — задача уже в очереди',
      '',
      'К перераспознаванию:',
      '  Le Pigeon [active] — файлов 1, позиций сейчас 20',
      '  МАЛЕВИЧ [active] — файлов 2, позиций сейчас 35',
      '',
      'Итого: 3 файлов меню, 2 карточек, позиций будет заменено 55.',
      'Снятые флаги правкой не считаются: позиций со снятым флагом — 32, файлов — 2. '
        + 'Проверка цен пройдёт заново, и флаг может встать снова.',
    ].join('\n'));
  });

  test('с --include-touched — какие правки заменит новый вывод; без снятых флагов строки о них нет', () => {
    expect(formatPlan({
      skipped: [],
      targets: [row({ media_id: 'm1', name: 'Кафе', items: 3, unlogged: 1 })],
    })).toBe([
      '⚠ правки людей будут заменены  Кафе [active]  media=m1  items=3',
      '          правка без записи в журнале — вероятно, партнёр: 1',
      '',
      'К перераспознаванию:',
      '  Кафе [active] — файлов 1, позиций сейчас 3',
      '',
      'Итого: 1 файлов меню, 1 карточек, позиций будет заменено 3.',
    ].join('\n'));
  });
});

describe('страж принципа: флаг живёт только на нетронутом выводе распознавания', () => {
  /*
   * Правило plan.js «последним сняли флаг — значит, содержимое позиции —
   * чистый вывод распознавания» верно, пока флаг живёт только на нетронутом
   * выводе. Для этого нужны две половины: непустой флаг пишут только вставки
   * распознавания, и каждая правка содержимого существующей позиции флаг
   * обнуляет. Опоры: два сканера исходников (ниже) и поведение правки
   * партнёра (последний тест).
   *
   * Чего сканеры не ловят: поле, собранное по имени из переменной
   * (updateById с объектом из запроса); SQL, склеенный из кусков; вызов
   * через именованный импорт или модель под другим именем; INSERT без списка
   * столбцов и COPY.
   */

  /**
   * Формы записи sanity_flag. Значение, которое начинается с null/NULL, —
   * снятие флага, а не запись.
   */
  const WRITE_FORMS = [
    // SET в SQL и присваивание в JS; не == и ===.
    { form: 'присваивание', re: /\bsanity_flag\s*=(?!=)\s*([^\n]*)/g },
    // Ключ объекта: поля для updateById, строки для вставки; не приведение ::.
    { form: 'ключ объекта', re: /\bsanity_flag\s*:(?!:)\s*([^\n]*)/g },
    // Столбец вставки: значение приходит от вызывающего.
    {
      form: 'столбец вставки',
      re: /INSERT\s+INTO\s+(?:public\.)?menu_items\s*\(([^)]*\bsanity_flag\b[^)]*)\)/gi,
      writes: true,
    },
    // Вызов вставки распознавания: пишет флаги, которые ей передали.
    { form: 'вызов вставки распознавания', re: /\b[Mm]enuItemModel\.(?:replaceForMedia|createMany)\s*\(/g, writes: true },
  ];

  const findFlagWrites = (text) => WRITE_FORMS.flatMap(({ form, re, writes }) => [...text.matchAll(re)]
    .map((match) => ({ form, clears: !writes && /^(?:null|NULL)\b/.test(match[1]) })));

  /** Формы изменения существующей позиции — что бы ни менялось. */
  const ROW_UPDATE_FORMS = [
    { form: 'UPDATE menu_items', re: /\bUPDATE\s+(?:public\.)?menu_items\b/gi },
    { form: 'вызов updateById', re: /\b[Mm]enuItemModel\.updateById\s*\(/g },
  ];

  const findRowUpdates = (text) => ROW_UPDATE_FORMS.flatMap(({ form, re }) => [...text.matchAll(re)].map(() => form));

  /** Корни обхода; тесты пишут флаги фикстурами — не в счёт. */
  const SCAN_ROOTS = ['src', 'scripts', 'migrations'];
  const listFiles = (dir) => readdirSync(join(BACKEND, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return path === 'src/tests' || entry.name === 'node_modules' ? [] : listFiles(path);
    return /\.(?:[cm]?js|sql)$/.test(entry.name) ? [path] : [];
  });

  /**
   * Где непустой флаг писать можно — и почему. Новое место — сначала решение
   * о правиле plan.js, потом строка здесь.
   */
  const FLAG_WRITERS = [
    ['src/services/ocr/sanityChecker.js · ключ объекта',
      'check(): флаг проверки распознавания — единственный источник непустого флага'],
    ['src/services/ocr/ocrService.js · вызов вставки распознавания',
      'processJob: replaceForMedia с выходом sanityChecker.check'],
    ['src/models/menuItemModel.js · столбец вставки',
      'createMany: вставляет, что передали; вызовов вне тестов нет — новый поймает «вызов вставки»'],
    ['src/models/menuItemModel.js · столбец вставки', 'replaceForMedia: вставка распознавания в транзакции замены'],
    ['src/services/adminService.js · ключ объекта',
      'dismissMenuItemFlag: old_data записи журнала — пишется в audit_log, не в позицию'],
  ];

  /**
   * Кто меняет существующую позицию — и почему принцип держится: каждое место
   * либо обнуляет флаг, либо не трогает содержимое. Новое место (правка цены
   * модератором, перестановка позиций) обязано обнулять флаг — иначе
   * «Снять флаг» после него выдаст правку человека за чистый вывод
   * распознавания, и перераспознавание её сотрёт.
   */
  const ROW_WRITERS = [
    ['src/models/menuItemModel.js · UPDATE menu_items', 'updateById — общий UPDATE; кто им пишет — строки ниже'],
    ['scripts/dismiss-menu-flags/dismiss.js · UPDATE menu_items', 'снимает флаг, журнал — тем же запросом'],
    ['src/services/adminService.js · вызов updateById',
      'hideMenuItem: только is_hidden_by_admin и hidden_reason — содержимое не меняется'],
    ['src/services/adminService.js · вызов updateById', 'unhideMenuItem: то же'],
    ['src/services/adminService.js · вызов updateById', 'dismissMenuItemFlag: sanity_flag = null'],
    ['src/services/partnerMenuItemService.js · вызов updateById',
      'updateMenuItem: правка партнёра обнуляет флаг всегда (последний тест)'],
  ];

  test('якорь: сканер узнаёт каждую форму записи и не принимает за неё снятие и чтение', () => {
    const forms = (text) => findFlagWrites(text).map((w) => (w.clears ? `${w.form}: снятие` : w.form));

    expect(forms('UPDATE menu_items SET sanity_flag = $1::jsonb WHERE id = $2')).toEqual(['присваивание']);
    expect(forms("UPDATE menu_items SET price_byn = 5, sanity_flag=jsonb_set(sanity_flag, '{a}', '1')"))
      .toEqual(['присваивание']);
    expect(forms('item.sanity_flag = computeFlag(item);')).toEqual(['присваивание']);
    expect(forms('MenuItemModel.updateById(id, { sanity_flag: flag })')).toEqual(['ключ объекта']);
    expect(forms('INSERT INTO menu_items (establishment_id,\n  item_name, sanity_flag)\nVALUES ($1, $2, $3)'))
      .toEqual(['столбец вставки']);
    expect(forms('INSERT INTO public.menu_items (item_name, sanity_flag) SELECT name, flag FROM x'))
      .toEqual(['столбец вставки']);
    expect(forms('await menuItemModel.replaceForMedia({ newItems })')).toEqual(['вызов вставки распознавания']);
    expect(forms('MenuItemModel.createMany({ items })')).toEqual(['вызов вставки распознавания']);

    expect(forms('SET sanity_flag = NULL, updated_at = NOW()')).toEqual(['присваивание: снятие']);
    expect(forms('filteredUpdates.sanity_flag = null;')).toEqual(['присваивание: снятие']);
    expect(forms('updateById(id, { sanity_flag: null })')).toEqual(['ключ объекта: снятие']);

    expect(forms([
      'if (existing.sanity_flag === null || item.sanity_flag != null) return;',
      "WHERE mi.sanity_flag->>'reason' = $1 AND mi.sanity_flag IS NOT NULL",
      'SELECT sanity_flag::text FROM menu_items',
      'INSERT INTO menu_items (establishment_id, item_name) VALUES ($1, $2)',
      'export const createMany = async ({ items }) => items;',
    ].join('\n'))).toEqual([]);

    // Изменение существующей позиции — любое.
    expect(findRowUpdates('UPDATE menu_items SET position = 1 WHERE id = $1')).toEqual(['UPDATE menu_items']);
    expect(findRowUpdates('UPDATE public.menu_items mi SET item_name = $1')).toEqual(['UPDATE menu_items']);
    expect(findRowUpdates('await MenuItemModel.updateById(id, { price_byn: 5 })')).toEqual(['вызов updateById']);
    expect(findRowUpdates('menuItemModel.updateById(itemId, updates)')).toEqual(['вызов updateById']);
    expect(findRowUpdates([
      'export const updateById = async (id, updates) => {',
      'await EstablishmentModel.updateById(id, { name })',
      'UPDATE menu_items_archive SET position = 1',
      'DELETE FROM menu_items WHERE media_id = $1',
      'SELECT * FROM menu_items WHERE id = $1',
    ].join('\n'))).toEqual([]);
  });

  test('непустой sanity_flag пишется только там, где перечислено', () => {
    const scanned = SCAN_ROOTS.flatMap(listFiles);
    // Обход не ослеп: каждый корень дал файлы.
    expect(SCAN_ROOTS.filter((root) => !scanned.some((path) => path.startsWith(`${root}/`)))).toEqual([]);

    const writers = scanned.flatMap((path) => findFlagWrites(readFileSync(join(BACKEND, path), 'utf8'))
      .filter((write) => !write.clears)
      .map((write) => `${path} · ${write.form}`));
    expect(writers.sort()).toEqual(FLAG_WRITERS.map(([where]) => where).sort());
  });

  test('существующую позицию меняют только перечисленные места: каждое обнуляет флаг или не трогает содержимое', () => {
    const updates = SCAN_ROOTS.flatMap(listFiles).flatMap((path) =>
      findRowUpdates(readFileSync(join(BACKEND, path), 'utf8')).map((form) => `${path} · ${form}`));
    expect(updates.sort()).toEqual(ROW_WRITERS.map(([where]) => where).sort());
  });

  test('правка партнёра обнуляет флаг, и снять после неё нечего — позиция остаётся правленой', async () => {
    const cafe = await seedVenue('Кафе');
    const file = await seedFile(cafe);
    const id = await seedItem(file, 'Сырники', { flag: DELTA_FLAG, base: await yesterday() });

    await partnerMenuItemService.updateMenuItem(cafe.partnerId, id, { price_byn: 24 });
    const { rows: [item] } = await query('SELECT sanity_flag, price_byn FROM menu_items WHERE id = $1', [id]);
    expect(item).toEqual({ sanity_flag: null, price_byn: '24.00' });

    // Ни панель, ни скрипт не оставят записи 'dismiss_sanity_flag', которая
    // выдала бы правку партнёра за чистый вывод распознавания.
    await expect(adminService.dismissMenuItemFlag(id, {
      adminUserId: adminId,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    })).rejects.toMatchObject({ code: 'MENU_ITEM_NO_FLAG' });
    const client = await pool.connect();
    try {
      expect((await planDismissal(client, { establishments: [cafe.id], reason: DELTA_FLAG.reason })).total)
        .toBe(0);
      expect(verdicts(await planReocr(client, { statuses: ['active'] }), { 'правлена партнёром': file }))
        .toEqual([['правлена партнёром', TOUCHED, 1, 0, 0, 1, 0]]);
    } finally {
      client.release(true);
    }
    const { rows: [journalled] } = await query(
      'SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_id = $1',
      [id],
    );
    expect(journalled.n).toBe(0);
  });
});
