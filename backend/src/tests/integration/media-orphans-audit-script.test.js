/* eslint-env jest */
/**
 * Файлы облака без ссылок из базы (scripts/media-orphans-audit.js) — скрипт
 * как есть, на базе теста (процесс наследует DB_*), облако — листингом из
 * файла (сеть не нужна).
 *
 * Что проверяется:
 *   - ссылка — это public_id целым токеном пути где угодно в базе: в ссылках
 *     всех форм, которые строит проект (размеры, версия, превью PDF, страница
 *     PDF для распознавания, ссылка загрузки с расширением), в ссылке, как её
 *     читает браузер (обратные косые, «..»), голым public_id в JSON реестра,
 *     в массиве и в таблице вне схемы public;
 *   - верхняя папка с именем облака не прячет файл за собой;
 *   - место решает смысл: живые колонки (медиа карточек, обложка, акции,
 *     аватар, реестр незавершённой загрузки), история (журнал действий, реестр
 *     завершённой загрузки, ошибки распознавания) и неизвестное место — оно
 *     занимает файл, но называется в отчёте;
 *   - папки: загрузки мастера по учёткам (служебная, партнёр, учётки нет),
 *     папки карточек (есть / удалена), аватары, прочее;
 *   - возраст корзинами на дату --as-of, границы суток, 7 / 30 / 90 дней;
 *   - живые ссылки на файлы, которых в облаке нет (ссылки из истории — не битые);
 *   - пары источников: прод — только с живым облаком, локальная база — с
 *     листингом; неизвестный аргумент — отказ;
 *   - манифест снимка: облако и момент базы из его полей, сверка счётчиков
 *     строк (кроме таблиц, чьих данных в снимке нет), загруженное после
 *     момента базы не судится, сверка со статусами самого снимка;
 *   - отказ, если листинг и база из разных облаков (обе ветви сторожа);
 *   - чтение базы не может писать — это отвергает сама база;
 *   - в выводе нет ни одного public_id, id учётки или карточки и имени чужого облака.
 *
 * Ссылки в строках базы строятся ЖИВЫМИ построителями проекта
 * (src/config/cloudinary.js) — форма ссылок та, что пишет прод. Ожидаемые
 * значения — литералы этого файла, не вывод кода.
 */

import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { clearAllData, query } from '../utils/database.js';
import {
  generateAllResolutions,
  generatePdfPageImageUrl,
  generatePdfPreviewUrl,
  generatePdfThumbnailUrl,
} from '../../config/cloudinary.js';
import { DELIVERY_URL_REGEX_SOURCE, tokenRegexSource } from '../../../scripts/lib/mediaOrphans.js';
import { readDatabase } from '../../../scripts/lib/mediaOrphansDb.js';
import { fileRecord } from '../../../scripts/prod-snapshot/manifest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(resolve(HERE, '../../../scripts'), 'media-orphans-audit.js');

const AS_OF = '2026-10-17T00:00:00Z';
// Облако теста: setup-env.js ставит CLOUDINARY_CLOUD_NAME='test', построители пишут его в ссылки.
const CLOUD = 'test';

const MISSING_USER = 'deadbeef-0000-4000-8000-000000000001';
const MISSING_AVATAR_USER = 'deadbeef-0000-4000-8000-000000000002';
const DELETED_CARD = 'deadbeef-0000-4000-8000-000000000003';

const temp = (userId, kind, id) => `establishments/temp/${userId}/${kind}/${id}`;
const card = (cardId, kind, id) => `establishments/${cardId}/${kind}/${id}`;
/** secure_url загрузки: версия и расширение — так их возвращает Cloudinary. */
const secureUrl = (publicId, ext) => `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/${publicId}.${ext}`;

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env }, encoding: 'utf8' });

const addUser = async ({ role = 'user', service = false, avatarUrl = null }) => {
  const id = randomUUID();
  await query(
    `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, is_active,
                        is_service_account, avatar_url, created_at, updated_at)
     VALUES ($1, $2, NULL, 'Проверка', $3, 'email', true, true, $4, $5, NOW(), NOW())`,
    [id, `orphans-${id}@example.com`, role, service, avatarUrl],
  );
  return id;
};

const addCard = async ({ id = randomUUID(), partnerId, status, cover = null, description = 'Проверка' }) => {
  await query(
    `INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude,
                                 categories, cuisines, working_hours, status, primary_image_url, created_at, updated_at)
     VALUES ($1, $2, 'Карточка', $6, $3, 'Минск', 'ул. Проверки 1', 53.9, 27.5,
             ARRAY['Ресторан'], ARRAY['Европейская'], '{}'::jsonb, $4, $5, NOW(), NOW())`,
    [id, partnerId, description, status, cover, `orphans-${id}`],
  );
  return id;
};

const addMedia = async (establishmentId, { type, fileType = 'image', url, previewUrl = null, thumbnailUrl = null }) => {
  const { rows } = await query(
    `INSERT INTO establishment_media (establishment_id, type, file_type, url, preview_url, thumbnail_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [establishmentId, type, fileType, url, previewUrl, thumbnailUrl],
  );
  return rows[0].id;
};

const photo = (publicId) => {
  const urls = generateAllResolutions(publicId);
  return { url: urls.url, previewUrl: urls.preview_url, thumbnailUrl: urls.thumbnail_url };
};

const asset = (publicId, bytes, createdAt, format = 'jpg') => ({
  public_id: publicId, resource_type: 'image', type: 'upload', format, bytes, created_at: createdAt,
});

/** Счётчики строк нескольких таблиц базы теста — для манифеста «того же снимка». */
const countsOf = async (tables) => {
  const out = {};
  for (const t of tables) out[`public.${t}`] = Number((await query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
  return out;
};

describe('scripts/media-orphans-audit.js', () => {
  let ids;
  let files;
  let dir;
  const paths = {};

  beforeAll(async () => {
    await clearAllData();
    await query('DROP SCHEMA IF EXISTS orphans_fixture CASCADE');
    const service = await addUser({ role: 'partner', service: true });
    const partner = await addUser({ role: 'partner' });
    const avatarUser = await addUser({ role: 'user' });
    const cardA = randomUUID();
    const cardB = randomUUID();

    files = {
      s1: temp(service, 'interior', 'zqs1'),
      s2: temp(service, 'menu_pdf', 'zqs2'),
      s3: temp(service, 'interior', 'zqs3'),
      s4: temp(service, 'interior', 'zqs4'),
      s5: temp(service, 'interior', 'zqs5'),
      s6: temp(service, 'dishes', 'zqs6'),
      s7: temp(service, 'menu_pdf', 'zqs7'),
      bs1: temp(service, 'interior', 'zqbs1'),
      dot1: temp(service, 'interior', 'zqdot1'),
      gone1: temp(service, 'interior', 'zqgone1'),
      hist2: temp(service, 'interior', 'zqhist2'),
      weird: `establishments/temp/${service}/interior/zq weird name`,
      p1: temp(partner, 'interior', 'zqp1'),
      p2: temp(partner, 'interior', 'zqp2'),
      fresh: temp(partner, 'interior', 'zqfresh'),
      m1: temp(MISSING_USER, 'interior', 'zqm1'),
      pr1: card(cardA, 'promotions', 'zqpr1'),
      c2: card(cardA, 'interior', 'zqc2'),
      arr1: card(cardA, 'interior', 'zqarr1'),
      reg1: card(cardB, 'interior', 'zqreg1'),
      d1: card(DELETED_CARD, 'interior', 'zqd1'),
      av1: `avatars/${avatarUser}/zqav1`,
      av2: `avatars/${MISSING_AVATAR_USER}/zqav2`,
    };

    // Карточка A — опубликована, у служебной учётки. Обложка — превью фото s1.
    // В описании — ссылка на файл c2 (неизвестное место) и ссылка на чужое облако.
    const s1 = photo(files.s1);
    await addCard({
      id: cardA,
      partnerId: service,
      status: 'active',
      cover: s1.previewUrl,
      description: `Наш зал: ${secureUrl(files.c2, 'jpg')} и чужой снимок https://res.cloudinary.com/other-cloud/image/upload/v1/establishments/x/y/zz.jpg`,
    });
    // Карточка B — черновик партнёра. В описании путь файла s5 внутри слова — это не ссылка.
    await addCard({
      id: cardB,
      partnerId: partner,
      status: 'draft',
      description: `Слово, а не ссылка: preestablishments/temp/${service}/interior/zqs5`,
    });

    await addMedia(cardA, { type: 'interior', ...s1 });
    const s2Row = await addMedia(cardA, {
      type: 'menu',
      fileType: 'pdf',
      url: secureUrl(files.s2, 'pdf'),
      previewUrl: generatePdfPreviewUrl(files.s2),
      thumbnailUrl: generatePdfThumbnailUrl(files.s2),
    });
    await addMedia(cardB, { type: 'interior', ...photo(files.p1) });
    // Живая ссылка на файл, которого в облаке нет.
    await addMedia(cardA, { type: 'interior', ...photo(files.gone1) });
    // Старые ссылки, написанные иначе: браузер читает обратные косые как прямые и убирает «..».
    await addMedia(cardA, { type: 'interior', url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000\\${files.bs1.split('/').join('\\')}.jpg` });
    await addMedia(cardA, { type: 'interior', url: secureUrl(files.dot1.replace(/zqdot1$/, 'zzz/../zqdot1'), 'jpg') });

    const pr1 = generateAllResolutions(files.pr1);
    await query(
      `INSERT INTO promotions (establishment_id, title, image_url, preview_url, thumbnail_url)
       VALUES ($1, 'Акция', $2, $3, $4)`,
      [cardA, pr1.url, pr1.preview_url, pr1.thumbnail_url],
    );
    await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [avatarUser, secureUrl(files.av1, 'jpg')]);

    // История: старое фото в журнале, удалённый файл в журнале (не битая ссылка),
    // голый public_id в реестре завершённой загрузки, страница PDF (pg_2) в ошибке распознавания.
    await query(
      `INSERT INTO audit_log (action, entity_type, old_data, new_data)
       VALUES ('media_deleted', 'establishment', $1::jsonb, $2::jsonb)`,
      [JSON.stringify({ url: generateAllResolutions(files.s3).url }), JSON.stringify({ url: secureUrl(files.hist2, 'jpg') })],
    );
    await query(
      `INSERT INTO seed_import_registry (stable_id, establishment_id, batch_id, content_hash, phase, media_state)
       VALUES ('orphans-audit-done', $1, 'batch-1', 'hash-1', 'activated', $2::jsonb)`,
      [cardA, JSON.stringify({ 'interior/01.jpg': { public_id: files.s4, media_row_id: null } })],
    );
    // Незавершённая загрузка: возобновление прикрепит этот файл — ссылка живая.
    await query(
      `INSERT INTO seed_import_registry (stable_id, establishment_id, batch_id, content_hash, phase, media_state)
       VALUES ('orphans-audit-open', $1, 'batch-1', 'hash-2', 'created', $2::jsonb)`,
      [cardB, JSON.stringify({ 'interior/01.jpg': { public_id: files.reg1 } })],
    );
    await query(
      `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, error_message)
       VALUES ($1, $2, 'failed', 3, $3)`,
      [cardA, s2Row, `Страница не загрузилась: ${generatePdfPageImageUrl(secureUrl(files.s7, 'pdf'), 2)} HTTP 404`],
    );
    // Таблица вне схемы public, ссылка — элементом массива: неизвестное место.
    await query('CREATE SCHEMA orphans_fixture');
    await query('CREATE TABLE orphans_fixture.extra (id serial PRIMARY KEY, links text[])');
    await query('INSERT INTO orphans_fixture.extra (links) VALUES ($1)', [['примечание', secureUrl(files.arr1, 'jpg')]]);

    const resources = [
      asset(files.s1, 1000, '2026-09-20T10:00:00Z'),
      asset(files.s2, 2000, '2026-09-20T10:00:00Z', 'pdf'),
      asset(files.s3, 3000, '2026-08-01T10:00:00Z'),
      asset(files.s4, 4000, '2026-08-01T10:00:00Z'),
      asset(files.s5, 5000, '2026-06-01T10:00:00Z'), // 137 дней
      asset(files.s6, 6000, '2026-08-20T10:00:00Z'), // 57 дней
      asset(files.s7, 7000, '2026-09-01T10:00:00Z', 'pdf'),
      asset(files.bs1, 18000, '2026-09-21T10:00:00Z'),
      asset(files.dot1, 19000, '2026-09-21T10:00:00Z'),
      asset(files.weird, 11000, '2026-09-01T10:00:00Z'),
      asset(files.p1, 8000, '2026-10-05T10:00:00Z'),
      asset(files.p2, 9000, '2026-10-14T10:00:00Z'), // 2 дня
      asset(files.fresh, 20000, '2026-10-16T21:00:00Z'), // 3 часа
      asset(files.m1, 10000, '2026-10-01T10:00:00Z'), // 15 дней
      asset(files.pr1, 12000, '2026-09-25T10:00:00Z'),
      asset(files.c2, 13000, '2026-09-25T10:00:00Z'),
      asset(files.arr1, 21000, '2026-09-25T10:00:00Z'),
      asset(files.reg1, 22000, '2026-10-02T10:00:00Z'),
      asset(files.d1, 14000, '2026-07-01T10:00:00Z'), // 107 дней
      asset(files.av1, 15000, '2026-10-01T10:00:00Z'),
      asset(files.av2, 16000, '2026-10-10T00:00:00Z'), // ровно 7 дней
      asset('zqsample', 17000, '2026-05-01T10:00:00Z'), // корень облака
      // Верхняя папка с именем облака: в ссылке без запятых жадный токен начнётся с неё.
      asset(`${CLOUD}/zqtop1`, 23000, '2026-09-01T10:00:00Z'),
    ];
    ids = { service, partner, avatarUser, cardA, cardB };

    // Манифест «того же снимка»: момент базы 15.10, счётчики строк базы теста, вердикты по файлам.
    const verdict = {
      [files.s1]: 'referenced', [files.s2]: 'referenced', [files.bs1]: 'referenced', [files.dot1]: 'referenced',
      [files.p1]: 'referenced', [files.pr1]: 'referenced', [files.c2]: 'referenced', [files.arr1]: 'referenced',
      [files.reg1]: 'referenced', [files.av1]: 'referenced',
      [files.s3]: 'orphan-with-provenance', [files.s4]: 'orphan-with-provenance', [files.s7]: 'orphan-with-provenance',
    };
    const manifestFiles = (overrides = {}) => resources.map((a) => {
      const status = overrides[a.public_id] || verdict[a.public_id] || 'orphan';
      const pointer = { table: 't', id: 'x', column: 'c' };
      return fileRecord({
        asset: a,
        refs: status === 'referenced' ? [pointer] : [],
        secondaryRefs: status === 'orphan-with-provenance' ? [pointer] : [],
        viaFallback: false,
      }, null);
    });
    const counts = await countsOf(['establishments', 'establishment_media', 'promotions', 'users']);
    const manifest = (over = {}) => ({
      format: 'nirivio-prod-snapshot-manifest/1',
      snapshot: { time_utc: '2026-10-15T00:00:00Z', exported_snapshot_id: 'x' },
      target: { database: 'postgresql://u:***@h:1/db', cloud_name: CLOUD },
      // Данных четырёх таблиц в снимке нет: их счётчик сверять не с чем.
      counts: { snapshot: { ...counts, 'public.refresh_tokens': 99, ...over.counts }, excluded_data_tables: ['refresh_tokens'] },
      files: manifestFiles(over.verdicts),
    });

    dir = mkdtempSync(join(tmpdir(), 'media-orphans-'));
    const write = (name, json) => {
      paths[name] = join(dir, `${name}.json`);
      writeFileSync(paths[name], JSON.stringify(json));
    };
    write('listing', { cloud_name: CLOUD, resources });
    write('elsewhere', { cloud_name: 'elsewhere', resources });
    write('otherCloud', { cloud_name: 'other-cloud', resources });
    write('manifest', manifest());
    write('manifestCounts', manifest({ counts: { 'public.establishments': counts['public.establishments'] + 1 } }));
    write('manifestDisagrees', manifest({ verdicts: { [files.s5]: 'referenced' } }));
  });

  afterAll(async () => {
    await query('DROP SCHEMA IF EXISTS orphans_fixture CASCADE');
    await clearAllData();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const report = (name = 'listing', extra = [`--as-of=${AS_OF}`]) => {
    const result = run([`--listing=${paths[name]}`, ...extra, '--json']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  };

  const bucket = (files, bytes) => expect.objectContaining({ files, bytes });

  test('загрузки мастера: со ссылкой 5, только в истории 3, без единой ссылки 5 — по владельцам и возрасту', () => {
    const g = report().groups.temp;
    expect(g.files).toBe(14);
    expect(g.bytes).toBe(123000);
    expect(g.folders).toBe(3);
    expect(g.status.live).toEqual(bucket(5, 48000));
    expect(g.status.history).toEqual(bucket(3, 14000));
    expect(g.status.other).toEqual(bucket(0, 0));
    expect(g.status.unchecked).toEqual(bucket(1, 11000));
    expect(g.uncheckedWhy).toEqual({ shape: 1, afterDb: 0 });
    expect(g.status.none).toEqual({
      files: 5,
      bytes: 50000,
      age: { under1: 1, upTo7: 1, upTo30: 1, upTo90: 1, older: 1, unknown: 0 },
      oldest: '2026-06-01',
      newest: '2026-10-16',
    });
    expect(g.liveByCard).toEqual({ active: 4, notActive: 1, notCard: 0 });
    expect(g.noneByOwner).toEqual({ missing: 1, partner: 2, service: 2 });
    expect(g.noneByKind).toEqual({ dishes: 1, interior: 4 });
    expect(g.noneByFormat).toEqual({ pdf: 0, image: 5 });
  });

  test('папки карточек: акция и незавершённая загрузка живые, описание и массив — неизвестное место, удалённая карточка — без ссылки', () => {
    const g = report().groups.cards;
    expect(g.files).toBe(5);
    expect(g.folders).toBe(3);
    expect(g.status.live).toEqual(bucket(2, 34000));
    expect(g.status.other).toEqual(bucket(2, 34000));
    expect(g.status.history).toEqual(bucket(0, 0));
    expect(g.status.none).toEqual(expect.objectContaining({
      files: 1, bytes: 14000, age: { under1: 0, upTo7: 0, upTo30: 0, upTo90: 0, older: 1, unknown: 0 },
    }));
    expect(g.liveByCard).toEqual({ active: 1, notActive: 0, notCard: 1 });
    expect(g.noneByOwner).toEqual({ missing: 1 });
  });

  test('аватары и прочее: аватар без учётки — без ссылки (ровно 7 дней), корень — не проверен, папка с именем облака — без ссылки', () => {
    const r = report();
    expect(r.groups.avatars.status.live).toEqual(bucket(1, 15000));
    expect(r.groups.avatars.liveByCard).toEqual({ active: 0, notActive: 0, notCard: 1 });
    expect(r.groups.avatars.status.none).toEqual(expect.objectContaining({
      files: 1, bytes: 16000, age: { under1: 0, upTo7: 1, upTo30: 0, upTo90: 0, older: 0, unknown: 0 },
    }));
    expect(r.groups.avatars.noneByOwner).toEqual({ missing: 1 });
    expect(r.groups.other.status.unchecked).toEqual(bucket(1, 17000));
    expect(r.groups.other.status.none).toEqual(bucket(1, 23000));
    expect(r.totals.files).toBe(23);
    expect(r.totals.bytes).toBe(276000);
    expect(r.totals.status.none).toEqual(bucket(8, 103000));
  });

  test('где нашлись ссылки — каждая колонка со своей ролью; битая живая ссылка одна; ссылки по облакам — числами', () => {
    const r = report();
    const columns = [...r.columns].sort((a, b) => (a.column < b.column ? -1 : 1));
    expect(columns).toEqual([
      { column: 'orphans_fixture.extra.links', role: 'other', files: 1 },
      { column: 'public.audit_log.old_data', role: 'history', files: 1 },
      { column: 'public.establishment_media.preview_url', role: 'live', files: 3 },
      { column: 'public.establishment_media.thumbnail_url', role: 'live', files: 3 },
      { column: 'public.establishment_media.url', role: 'live', files: 5 },
      { column: 'public.establishments.description', role: 'other', files: 1 },
      { column: 'public.establishments.primary_image_url', role: 'live', files: 1 },
      { column: 'public.ocr_jobs.error_message', role: 'history', files: 1 },
      { column: 'public.promotions.image_url', role: 'live', files: 1 },
      { column: 'public.promotions.preview_url', role: 'live', files: 1 },
      { column: 'public.promotions.thumbnail_url', role: 'live', files: 1 },
      { column: 'public.seed_import_registry.media_state', role: 'history', files: 2 },
      { column: 'public.seed_import_registry.media_state (незавершённая загрузка)', role: 'live', files: 1 },
      { column: 'public.users.avatar_url', role: 'live', files: 1 },
    ]);
    expect(r.brokenLinks).toBe(1);
    expect(r.clouds).toEqual({ ours: 24, others: 1, otherClouds: 1 });
    expect(r.cardStatusesRead).toBe(true);
    expect(r.countsCheck).toBeNull();
    expect(r.snapshotComparison).toBeNull();
    expect(r.scanned.tables).toBeGreaterThan(10);
    expect(r.target.cloud).toEqual({ name: CLOUD, source: { kind: 'listing', file: 'listing.json', manifest: false } });
  });

  test('манифест того же снимка: облако и момент базы из его полей, загруженное позже не судится, вердикты совпали', () => {
    const r = report('manifest', []);
    expect(r.dbMoment).toBe('2026-10-15T00:00:00Z');
    expect(r.asOf).toBe('2026-10-15T00:00:00.000Z');
    expect(r.countsCheck).toEqual({ checked: 4, mismatched: 0 });
    expect(r.groups.temp.uncheckedWhy).toEqual({ shape: 1, afterDb: 1 });
    expect(r.groups.temp.status.none.files).toBe(4);
    expect(r.snapshotComparison.files).toBe(23);
    expect(r.snapshotComparison.referencedButNone).toBe(0);
    expect(r.target.cloud).toEqual({ name: CLOUD, source: { kind: 'listing', file: 'manifest.json', manifest: true } });
  });

  test('манифест другого снимка (счётчик строк разошёлся) — отказ кодом 2; файл, занятый по снимку, вышел сиротой — код 3', () => {
    const counts = run([`--listing=${paths.manifestCounts}`, '--json']);
    expect(counts.status).toBe(2);
    expect(counts.stdout).toBe('');
    expect(counts.stderr).toContain('не тот снимок');

    const disagrees = run([`--listing=${paths.manifestDisagrees}`, '--json']);
    expect(disagrees.status).toBe(3);
    expect(JSON.parse(disagrees.stdout).snapshotComparison.referencedButNone).toBe(1);
  });

  test('листинг другого облака — отказ кодом 2 в обеих ветвях сторожа: ноль ссылок и больше чужих, чем своих', () => {
    for (const name of ['elsewhere', 'otherCloud']) {
      const result = run([`--listing=${paths[name]}`, `--as-of=${AS_OF}`, '--json']);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Сопоставлять нечего');
    }
  });

  test('пары источников и аргументы: отказ до подключения', () => {
    const refusal = (args, text) => {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(text);
    };
    refusal(['--json'], 'ровно один источник облака');
    refusal(['--cloud', `--listing=${paths.listing}`], 'ровно один источник облака');
    refusal(['--cloud'], '--cloud — только вместе с --production');
    refusal(['--production', `--listing=${paths.listing}`], '--production — только вместе с --cloud');
    refusal([`--listing=${paths.listing}`, '--prodution'], 'Неизвестный аргумент: --prodution');
  });

  test('чтение базы не может писать: запись внутри его транзакции отвергает сама база', async () => {
    const client = new pg.Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    await client.connect();
    try {
      // Обёртка подкладывает запись сразу после начала транзакции — как сделал бы дефект.
      const probe = {
        query: async (sql, params) => {
          const result = await client.query(sql, params);
          if (sql.startsWith('SET LOCAL statement_timeout')) {
            await client.query("INSERT INTO audit_log (action, entity_type) VALUES ('orphans-probe', 'probe')");
          }
          return result;
        },
      };
      await expect(readDatabase(probe, {
        tokenRegex: tokenRegexSource(['establishments']),
        urlRegex: DELIVERY_URL_REGEX_SOURCE,
        ownerIds: { users: [], cards: [] },
      })).rejects.toThrow('read-only transaction');
    } finally {
      await client.end();
    }
    const { rows } = await query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'orphans-probe'");
    expect(rows[0].n).toBe(0);
  });

  test('печать для людей и JSON: итоги есть, ни одного public_id, id учётки или карточки, имени чужого облака', () => {
    const text = run([`--listing=${paths.listing}`, `--as-of=${AS_OF}`]);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('БЕЗ ЕДИНОЙ ССЫЛКИ: 5');
    expect(text.stdout).toContain('Живых ссылок на файлы, которых в облаке нет: 1');
    expect(text.stdout).toContain('orphans_fixture.extra.links');
    expect(text.stdout).toContain('Базе не видны несохранённый черновик мастера');
    const json = run([`--listing=${paths.listing}`, `--as-of=${AS_OF}`, '--json']);
    for (const out of [text.stdout, json.stdout]) {
      // Имена файлов фикстуры начинаются с «zq», id учёток и карточек — UUID.
      expect(out).not.toContain('zq');
      expect(out).not.toContain('other-cloud');
      for (const id of [...Object.values(ids), MISSING_USER, MISSING_AVATAR_USER, DELETED_CARD]) {
        expect(out).not.toContain(id);
      }
      expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});
