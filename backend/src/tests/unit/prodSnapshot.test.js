/* eslint-env jest */
/**
 * Unit — снимок прода (scripts/prod-snapshot): разбор ссылок, классы, имена
 * файлов, признак оригинала, сопоставление ссылок с ассетами, проверки (б) и
 * (в), диф прогонов, формат gpg, ошибки pg_restore, список чтения Admin API.
 *
 * Зачем (30.09.2026, #6a обзора 23.09): снимок — единственная копия фото и
 * данных вне Railway и Cloudinary. Разбор ссылок, который молча промахнётся,
 * запишет «сирот» вместо файлов карточек, а проверка восстановления,
 * сравнивающая источник сам с собой, скажет «годен» про негодный архив.
 *
 * Ожидания — литералы. Ссылки для разбора — ЖИВОЙ вывод построителей проекта
 * (src/config/cloudinary.js): сменится форма ссылок — тест покраснеет раньше,
 * чем снимок начнёт терять файлы (память feedback_cloudinary_extensionless_urls).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  archiveFileName, checkPrimaryImages, classifyUrl, extractPublicIdFromUrl, originalStatus, parseCloudinaryUrl,
  scanMediaState,
} from '../../../scripts/prod-snapshot/media.js';
import {
  buildIndex, checkRefsHaveFiles, collectRefs, diffIndexes, fileRecord, planFiles, summarize,
} from '../../../scripts/prod-snapshot/manifest.js';
import { assertReadOnlyAdminCall } from '../../../scripts/prod-snapshot/cloudinaryReader.js';
import { describePacketFormat, readPacketHeaders } from '../../../scripts/prod-snapshot/archive.js';
import { compareCounts, parseRestoreErrors } from '../../../scripts/prod-snapshot/restore.js';
import { REPO_DIR, maskDatabaseUrl, pgEnvFromUrl } from '../../../scripts/prod-snapshot/env.js';
import { isPlaintextFile } from '../../../scripts/prod-snapshot/cleanup.js';
import { checkSnapshotRoot } from '../../../scripts/prod-snapshot/preflight.js';

let project;

beforeAll(async () => {
  // cloudinary.config() читает имя облака при импорте; в .env.test его может не быть.
  process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'testcloud';
  project = await import('../../config/cloudinary.js');
});

const PID = 'establishments/temp/0b6a1c2e-1111-4a4a-9999-123456789abc/interior/abc123xyz';
const PDF_PID = 'establishments/temp/0b6a1c2e-1111-4a4a-9999-123456789abc/menu_pdf/qwe456rty';

describe('разбор ссылок Cloudinary — на живом выводе построителей проекта', () => {
  test.each(['original', 'preview', 'thumbnail'])('фото, вариант %s: public_id извлекается и совпадает с разбором проекта', (variant) => {
    const url = project.generateImageUrl(PID, variant);
    expect(extractPublicIdFromUrl(url)).toBe(PID);
    expect(extractPublicIdFromUrl(url)).toBe(project.extractPublicIdFromUrl(url));
    expect(parseCloudinaryUrl(url)).toMatchObject({
      cloud: process.env.CLOUDINARY_CLOUD_NAME, resourceType: 'image', deliveryType: 'upload',
      publicId: PID, extension: '', transformed: true,
    });
  });

  test('превью и миниатюра PDF (pg_1, f_jpg, .jpg) ведут к public_id самого PDF', () => {
    for (const url of [project.generatePdfPreviewUrl(PDF_PID), project.generatePdfThumbnailUrl(PDF_PID)]) {
      expect(parseCloudinaryUrl(url)).toMatchObject({ publicId: PDF_PID, extension: 'jpg', transformed: true });
      expect(extractPublicIdFromUrl(url)).toBe(project.extractPublicIdFromUrl(url));
    }
  });

  test('secure_url загрузки PDF: версия и расширение разобраны, в public_id расширения нет', () => {
    expect(parseCloudinaryUrl('https://res.cloudinary.com/demo/image/upload/v1721634728/establishments/temp/u1/menu_pdf/qwerty.pdf'))
      .toEqual({
        cloud: 'demo', resourceType: 'image', deliveryType: 'upload',
        publicId: 'establishments/temp/u1/menu_pdf/qwerty', version: 1721634728, extension: 'pdf', transformed: false,
      });
  });

  test('raw: расширение — часть public_id; private-тип разбирается, а не отбрасывается', () => {
    expect(parseCloudinaryUrl('https://res.cloudinary.com/demo/raw/upload/v5/docs/menu.pdf'))
      .toMatchObject({ resourceType: 'raw', publicId: 'docs/menu.pdf', version: 5 });
    expect(parseCloudinaryUrl('https://res.cloudinary.com/demo/image/private/s--Ab1_x-9Z--/v7/secret/x.jpg'))
      .toMatchObject({ deliveryType: 'private', publicId: 'secret/x', version: 7 });
  });

  test('не Cloudinary и обрубки — null', () => {
    expect(parseCloudinaryUrl('https://example.com/demo/image/upload/v1/a.jpg')).toBeNull();
    expect(parseCloudinaryUrl('https://res.cloudinary.com/demo/image')).toBeNull();
    expect(parseCloudinaryUrl('не ссылка')).toBeNull();
  });
});

describe('класс ссылки', () => {
  const ctx = { cloudName: 'demo', legacyHosts: ['restaurantguidev2-production.up.railway.app'] };

  test('пусто, legacy-local, внешняя, чужое облако, pdf, фото, мусор', () => {
    expect(classifyUrl(null, ctx)).toEqual({ cls: 'empty' });
    expect(classifyUrl('   ', ctx)).toEqual({ cls: 'empty' });
    expect(classifyUrl('/uploads/avatars/1700000000-abc.jpg', ctx)).toEqual({ cls: 'legacy-local' });
    expect(classifyUrl('https://restaurantguidev2-production.up.railway.app/uploads/avatars/a.jpg', ctx))
      .toEqual({ cls: 'legacy-local', host: 'restaurantguidev2-production.up.railway.app' });
    expect(classifyUrl('https://lh3.googleusercontent.com/a/ACg8oc=s96-c', ctx)).toEqual({ cls: 'external', host: 'lh3.googleusercontent.com' });
    expect(classifyUrl('https://example.com/uploads/x.jpg', ctx)).toEqual({ cls: 'external', host: 'example.com' });
    expect(classifyUrl('https://res.cloudinary.com/other/image/upload/v1/a/b.jpg', ctx).cls).toBe('cloudinary-foreign');
    expect(classifyUrl('https://res.cloudinary.com/demo/image/upload/v1/a/b.pdf', ctx).cls).toBe('cloudinary-pdf');
    expect(classifyUrl('https://res.cloudinary.com/demo/image/upload/c_limit,w_1920/f_auto,q_auto/v1/a/b', ctx).cls).toBe('cloudinary-image');
    expect(classifyUrl('https://res.cloudinary.com/demo', ctx)).toEqual({ cls: 'unknown', host: 'res.cloudinary.com' });
    expect(classifyUrl('picsum', ctx)).toEqual({ cls: 'unknown' });
    expect(classifyUrl('ftp://files.example.com/a.jpg', ctx)).toEqual({ cls: 'unknown' });
  });
});

describe('имя файла в архиве', () => {
  test('слэши → __, формат расширением; запрещённое в Windows → _; зарезервированное имя экранируется', () => {
    expect(archiveFileName('establishments/temp/u1/interior/abc', 'jpg')).toBe('establishments__temp__u1__interior__abc.jpg');
    expect(archiveFileName('a/b:c*?', 'png')).toBe('a__b_c__.png');
    expect(archiveFileName('con', 'jpg')).toBe('_con.jpg');
    expect(archiveFileName('docs/menu.pdf', '')).toBe('docs__menu.pdf');
    expect(archiveFileName('x/trailing.', 'jpg')).toBe('x__trailing_.jpg');
  });
});

describe('настоящий ли оригинал в облаке', () => {
  const img = (created_at, width, height, extra = {}) => ({
    resource_type: 'image', format: 'jpg', public_id: 'establishments/temp/u/interior/x', created_at, width, height, ...extra,
  });

  test('до коммита 66b799d (22.07.2026 09:32:08Z) — сжат при загрузке, даже крупный', () => {
    expect(originalStatus(img('2026-07-20T10:00:00Z', 1920, 1080))).toBe('compressed-at-upload');
    expect(originalStatus(img('2026-07-22T09:32:07Z', 1920, 1440))).toBe('compressed-at-upload');
  });

  test('сутки после коммита: в рамке 1920×1080 — «возможно», крупнее — оригинал', () => {
    expect(originalStatus(img('2026-07-22T09:32:09Z', 1920, 1080))).toBe('possibly-compressed');
    expect(originalStatus(img('2026-07-23T09:32:07Z', 1080, 1080))).toBe('possibly-compressed');
    expect(originalStatus(img('2026-07-22T12:00:00Z', 3024, 4032))).toBe('original');
    expect(originalStatus(img('2026-07-22T12:00:00Z', 1920, 1081))).toBe('original');
  });

  test('после окна — оригинал; PDF — оригинал всегда; аватар — 256²', () => {
    expect(originalStatus(img('2026-07-23T09:32:09Z', 1920, 1080))).toBe('original');
    expect(originalStatus(img('2026-07-01T00:00:00Z', 800, 600, { format: 'pdf' }))).toBe('original');
    expect(originalStatus(img('2026-09-01T00:00:00Z', 256, 256, { public_id: 'avatars/u1/abc' }))).toBe('avatar-256');
  });
});

describe('реестр сида: public_id и ссылки из media_state', () => {
  test('обход по всем уровням; пустое и null — пусто', () => {
    const urlA = 'https://res.cloudinary.com/demo/image/upload/c_limit,w_1920/f_auto,q_auto/v1/establishments/e1/exterior/aaa';
    const urlB = 'https://res.cloudinary.com/demo/image/upload/v17/establishments/e1/menu_pdf/bbb.pdf';
    const state = {
      'ext/1.jpg': { public_id: 'establishments/e1/exterior/aaa', type: 'exterior', url: urlA, media_row_id: 'm1' },
      'menu/m.pdf': { public_id: 'establishments/e1/menu_pdf/bbb', url: urlB, file_type: 'pdf' },
    };
    expect(scanMediaState(state)).toEqual({
      publicIds: ['establishments/e1/exterior/aaa', 'establishments/e1/menu_pdf/bbb'],
      urls: [urlA, urlB],
    });
    expect(scanMediaState({})).toEqual({ publicIds: [], urls: [] });
    expect(scanMediaState(null)).toEqual({ publicIds: [], urls: [] });
  });
});

describe('сопоставление ссылок базы с ассетами', () => {
  const U = (pid, ext = '') => `https://res.cloudinary.com/demo/image/upload/v1/${pid}${ext}`;
  const T = (pid) => `https://res.cloudinary.com/demo/image/upload/c_limit,pg_1,w_1200/f_jpg,q_auto/v1/${pid}.jpg`;
  const asset = (public_id, format, created_at = '2026-09-01T00:00:00Z') => ({
    public_id, format, resource_type: 'image', type: 'upload', bytes: 100, width: 3000, height: 4000, created_at,
    secure_url: U(public_id, `.${format}`),
  });
  const inventory = {
    mediaRows: [
      { id: 'm1', establishment_id: 'e1', url: U('est/a'), preview_url: U('est/a'), thumbnail_url: U('est/a') },
      { id: 'm2', establishment_id: 'e1', url: U('est/d', '.pdf'), preview_url: T('est/d'), thumbnail_url: T('est/d') },
      { id: 'm3', establishment_id: 'e2', url: U('est/gone'), preview_url: null, thumbnail_url: null },
    ],
    promotions: [],
    avatars: [
      { id: 'u1', avatar_url: 'https://lh3.googleusercontent.com/a/x' },
      { id: 'u2', avatar_url: '/uploads/avatars/old.jpg' },
    ],
    establishments: [
      { id: 'e1', name: 'Бета', status: 'active', primary_image_url: U('est/a') },
      { id: 'e2', name: 'Альфа', status: 'draft', primary_image_url: null },
    ],
    partnerDocuments: [{ id: 'p1', establishment_id: 'e1', document_url: '' }],
    seedRegistry: [{ stable_id: 's1', establishment_id: 'e1', publicIds: ['est/b'], urls: [] }],
    secondaryUrls: [],
  };
  const assets = [asset('est/a', 'jpg', '2026-07-01T00:00:00Z'), asset('est/b', 'jpg'), asset('est/c', 'png'), asset('est/d', 'pdf')];
  const ctx = { cloudName: 'demo', legacyHosts: [] };

  test('статусы файлов, класс PDF по формату ассета, строки без файла с причиной', () => {
    const refs = collectRefs(inventory, ctx);
    const { files, rowsWithoutFile } = planFiles(refs, assets);
    const status = Object.fromEntries([...files.values()].map((f) => [f.asset.public_id, fileRecord(f).status]));
    expect(status).toEqual({ 'est/a': 'referenced', 'est/b': 'orphan-with-provenance', 'est/c': 'orphan', 'est/d': 'referenced' });

    expect(rowsWithoutFile.map((r) => `${r.table}.${r.column}:${r.id}:${r.cls}`).sort()).toEqual([
      'establishment_media.url:m3:cloudinary-image',
      'users.avatar_url:u1:external',
      'users.avatar_url:u2:legacy-local',
    ]);

    const summary = summarize({ refs, files, rowsWithoutFile, establishments: inventory.establishments, mediaRows: inventory.mediaRows });
    // 3 ссылки m2 (url .pdf + превью .jpg + миниатюра .jpg) — все pdf: класс решает формат ассета.
    expect(summary.refs.primary_by_class).toEqual({
      'cloudinary-image': 5, 'cloudinary-pdf': 3, empty: 4, external: 1, 'legacy-local': 1,
    });
    expect(summary.files.by_status).toEqual({ 'orphan-with-provenance': 1, orphan: 1, referenced: 2 });
    expect(summary.cards_without_true_original).toEqual([{ id: 'e1', name: 'Бета', status: 'active', compressed: 1, possibly: 0 }]);
  });

  test('(б): найден и sha256 совпал / промах объяснён / нет файла на диске / sha256 не совпал', () => {
    const refs = collectRefs(inventory, ctx);
    const manifestFiles = new Map([
      ['image/upload/est/a', { path: 'media/a.jpg', sha256: 'aaa' }],
      ['image/upload/est/d', { path: 'media/d.pdf', sha256: 'ddd' }],
    ]);
    const explained = [{ table: 'establishment_media', id: 'm3', column: 'url' }];

    expect(checkRefsHaveFiles(refs, manifestFiles, new Map([['media/a.jpg', 'aaa'], ['media/d.pdf', 'ddd']]), explained))
      .toEqual({ checked: 8, found: 7, explained: 1, failed: [] });

    const broken = checkRefsHaveFiles(refs, manifestFiles, new Map([['media/a.jpg', 'aaa'], ['media/d.pdf', 'XXX']]), []);
    expect(broken.found).toBe(4);
    expect(broken.failed.map((f) => `${f.id}.${f.column}:${f.why}`)).toEqual([
      'm2.url:sha256 не совпал', 'm2.preview_url:sha256 не совпал', 'm2.thumbnail_url:sha256 не совпал', 'm3.url:нет в манифесте',
    ]);

    const missing = checkRefsHaveFiles(refs, manifestFiles, new Map([['media/d.pdf', 'ddd']]), explained);
    expect(missing.failed.map((f) => `${f.table}.${f.id}:${f.why}`)).toEqual([
      'establishment_media.m1:нет файла на диске', 'establishment_media.m1:нет файла на диске',
      'establishment_media.m1:нет файла на диске', 'establishments.e1:нет файла на диске',
    ]);
  });
});

describe('(в) обложка карточки — из ЕЁ медиа', () => {
  test('совпадение со строкой медиа другой карточки не засчитывается', () => {
    const establishments = [
      { id: 'e1', primary_image_url: 'P1' },
      { id: 'e2', primary_image_url: null },
      { id: 'e3', primary_image_url: 'X' },
      { id: 'e4', primary_image_url: 'U4' },
    ];
    const mediaRows = [
      { establishment_id: 'e1', url: 'U1', preview_url: 'P1' },
      { establishment_id: 'e1', url: 'X', preview_url: null },
      { establishment_id: 'e3', url: 'U3', preview_url: 'P3' },
      { establishment_id: 'e4', url: 'U4', preview_url: 'P4' },
    ];
    expect(checkPrimaryImages(establishments, mediaRows)).toEqual({ checked: 3, withoutCover: 1, mismatched: ['e3'] });
  });
});

describe('диф к прошлому прогону', () => {
  const index = (establishments, mediaRows, files) => ({ run_id: 'r', counts: {}, establishments, media_rows: mediaRows, files });

  test('новые карточки со всеми файлами, пропавшие файлы, сменившийся sha256', () => {
    const prev = index(
      [{ id: 'e1', name: 'Один' }, { id: 'e9', name: 'Ушедшая' }],
      [{ id: 'm1', establishment_id: 'e1', keys: ['k1'] }],
      [{ key: 'k1', sha256: 'a' }, { key: 'k2', sha256: 'b' }, { key: 'k4', sha256: 'z' }],
    );
    prev.run_id = '2026-09-30_1800';
    prev.counts = { 'public.establishments': 2 };
    const cur = index(
      [{ id: 'e1', name: 'Один' }, { id: 'e2', name: 'Два' }, { id: 'e3', name: 'Три' }],
      [
        { id: 'm1', establishment_id: 'e1', keys: ['k1'] },
        { id: 'm2', establishment_id: 'e2', keys: ['k3'] },
        { id: 'm3', establishment_id: 'e2', keys: ['k5'] },
        { id: 'm4', establishment_id: 'e3', keys: [] },
      ],
      [{ key: 'k1', sha256: 'a' }, { key: 'k2', sha256: 'c' }, { key: 'k3', sha256: 'd' }, { key: 'k5', sha256: null }],
    );
    cur.counts = { 'public.establishments': 3 };

    expect(diffIndexes(prev, cur)).toEqual({
      previous_run_id: '2026-09-30_1800',
      establishments: { added: [{ id: 'e2', name: 'Два' }, { id: 'e3', name: 'Три' }], removed: [{ id: 'e9', name: 'Ушедшая' }] },
      files: { added: ['k3', 'k5'], missing: ['k4'], sha256_changed: ['k2'] },
      new_cards: [
        { id: 'e2', name: 'Два', media_rows: 2, rows_with_all_files: 1 },
        { id: 'e3', name: 'Три', media_rows: 1, rows_with_all_files: 0 },
      ],
      counts_changed: { 'public.establishments': { prev: 2, cur: 3 } },
    });
  });

  test('index.json связывает строку медиа с ключами её файлов и не несёт ссылок', () => {
    const rec = { key: 'image/upload/est/a', bytes: 5, sha256: 's', status: 'referenced', original: 'original', refs: [{ table: 'establishment_media', id: 'm1', column: 'url' }] };
    const out = buildIndex({
      runId: 'r1', snapshotTimeUtc: 't', cloudName: 'demo', counts: { x: 1 },
      establishments: [{ id: 'e1', name: 'Один', status: 'active', primary_image_url: 'https://secret' }],
      mediaRows: [{ id: 'm1', establishment_id: 'e1', url: 'https://secret' }, { id: 'm2', establishment_id: 'e1', url: 'https://x' }],
      fileRecords: [rec],
    });
    expect(out.media_rows).toEqual([{ id: 'm1', establishment_id: 'e1', keys: ['image/upload/est/a'] }, { id: 'm2', establishment_id: 'e1', keys: [] }]);
    expect(out.establishments).toEqual([{ id: 'e1', name: 'Один', status: 'active' }]);
    expect(out.files).toEqual([{ key: 'image/upload/est/a', bytes: 5, sha256: 's', status: 'referenced', original: 'original' }]);
    expect(JSON.stringify(out)).not.toMatch(/https?:/);
  });
});

describe('формат шифрования по заголовкам пакетов OpenPGP (без пароля)', () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'prod-snapshot-test-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const probe = async (bytes) => {
    const p = join(dir, `p${Math.random().toString(36).slice(2)}.gpg`);
    writeFileSync(p, Buffer.from(bytes));
    return describePacketFormat(await readPacketHeaders(p));
  };
  // SKESK v4: тег 3, длина 13: версия 4, AES256 (9), S2K iterated (3), SHA512 (10), соль 8 байт, счётчик.
  const skeskNew = [0xc3, 0x0d, 0x04, 0x09, 0x03, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 0xff];
  const skeskOld = [0x8c, 0x0d, 0x04, 0x09, 0x03, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 0xff];

  test('SKESK v4 + SEIPD v1 (частичная длина) — классический, годится', async () => {
    const f = await probe([...skeskNew, 0xd2, 0xe0, 0x01, 0xaa]);
    expect(f.ok).toBe(true);
    expect(f.text).toMatch(/^классический OpenPGP/);
    expect((await probe([...skeskOld, 0xd2, 0xe0, 0x01, 0xaa])).text).toMatch(/^классический OpenPGP/);
  });

  test('OCB LibrePGP и AEAD RFC 9580 опознаются; без MDC — не годится', async () => {
    expect((await probe([0xc3, 0x02, 0x05, 0x09, 0xd4, 0xe0, 0x01, 0x09])).text).toMatch(/^OCB LibrePGP/);
    expect((await probe([0xc3, 0x02, 0x06, 0x09, 0xd2, 0xe0, 0x02, 0x09])).text).toMatch(/^AEAD RFC 9580/);
    const noMdc = await probe([...skeskOld, 0xa4, 0x02, 0x00, 0x00]);
    expect(noMdc).toEqual({ ok: false, text: 'шифрование без MDC — небезопасно' });
  });
});

describe('ошибки pg_restore', () => {
  test('берётся только строка ERROR; значение в кавычках вымарано; DETAIL и CONTEXT не читаются', () => {
    const stderr = [
      'pg_restore: error: could not execute query: ERROR:  schema "topology" already exists',
      'Command was: CREATE SCHEMA topology;',
      'pg_restore: error: could not execute query: ERROR:  invalid input syntax for type uuid: "ivan@example.com"',
      'CONTEXT:  COPY users, line 1, column id: "ivan@example.com"',
      'DETAIL:  Key (email)=(ivan@example.com) already exists.',
      'pg_restore: error: connection to server failed',
      'pg_restore: warning: errors ignored on restore: 2',
    ].join('\n');
    const errors = parseRestoreErrors(stderr);
    expect(errors).toEqual([
      { text: 'schema "topology" already exists', expected: true },
      { text: 'invalid input syntax for type uuid: "…"', expected: false },
      { text: 'connection to server failed', expected: false },
    ]);
    expect(JSON.stringify(errors)).not.toMatch(/ivan/);
  });

  test('значение вымарано и посреди строки, и с незакрытой кавычкой; имена объектов остаются', () => {
    const stderr = [
      'pg_restore: error: could not execute query: ERROR:  value "80291234567" is out of range for type integer',
      'pg_restore: error: could not execute query: ERROR:  invalid input syntax for type json: "{\\"email\\": \\"ivan',
      'pg_restore: error: could not execute query: ERROR:  relation "public.users" does not exist',
    ].join('\n');
    expect(parseRestoreErrors(stderr).map((e) => e.text)).toEqual([
      'value "…" is out of range for type integer',
      'invalid input syntax for type json: "…"',
      'relation "public.users" does not exist',
    ]);
  });

  test('белый список — три схемы расширений и колонка topology.useslargeids, не «любое already exists»', () => {
    const stderr = [
      'schema "tiger" already exists', 'schema "tiger_data" already exists', 'schema "topology" already exists',
      'column "useslargeids" of relation "topology" does not exist',
      'schema "public" already exists', 'relation "users" already exists', 'schema "tiger_dataX" already exists',
      'column "useslargeids" of relation "users" does not exist', 'column "email" of relation "topology" does not exist',
    ].map((t) => `pg_restore: error: could not execute query: ERROR:  ${t}`).join('\n');
    expect(parseRestoreErrors(stderr).map((e) => e.expected)).toEqual([true, true, true, true, false, false, false, false, false]);
  });
});

describe('(а) счётчики восстановленной базы', () => {
  test('у исключённых таблиц ждём 0; расхождение и лишняя таблица видны', () => {
    const snapshot = { 'public.users': 5, 'public.refresh_tokens': 40, 'public.reviews': 3 };
    expect(compareCounts(snapshot, { 'public.users': 5, 'public.refresh_tokens': 0, 'public.reviews': 3 }, ['refresh_tokens']))
      .toEqual({ tables: 3, mismatches: [], extra_tables_in_restore: [] });
    expect(compareCounts(snapshot, { 'public.users': 4, 'public.refresh_tokens': 40, 'public.x': 1 }, ['refresh_tokens']))
      .toEqual({
        tables: 3,
        mismatches: [
          { table: 'public.users', expected: 5, got: 4 },
          { table: 'public.refresh_tokens', expected: 0, got: 40 },
          { table: 'public.reviews', expected: 3, got: null },
        ],
        extra_tables_in_restore: ['public.x'],
      });
  });
});

describe('секреты: маска адреса и переменные libpq', () => {
  test('пароль в маске не виден; неразборчивый адрес не печатается как есть; порт по умолчанию', () => {
    const masked = maskDatabaseUrl('postgresql://postgres:s3cr%40t@turntable.proxy.rlwy.net:44099/railway');
    expect(masked).toBe('postgresql://postgres:***@turntable.proxy.rlwy.net:44099/railway');
    expect(masked).not.toMatch(/s3cr/);
    expect(maskDatabaseUrl('postgres://u:p@h/db')).toBe('postgres://u:***@h:5432/db');
    expect(maskDatabaseUrl('garbage with p@ss')).toBe('(неразборчивый DATABASE_URL)');
  });

  test('PG* раскодированы из адреса; SSL обязателен', () => {
    expect(pgEnvFromUrl('postgresql://us%40er:p%40ss%3Aw@db.example:5433/rail%20way')).toEqual({
      PGHOST: 'db.example', PGPORT: '5433', PGUSER: 'us@er', PGPASSWORD: 'p@ss:w', PGDATABASE: 'rail way', PGSSLMODE: 'require',
    });
    expect(pgEnvFromUrl('postgres://u:p@h/db').PGPORT).toBe('5432');
  });
});

describe('открытые данные: место записи и что считается открытым', () => {
  let base;
  let savedOneDrive;
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'prod-snapshot-root-'));
    savedOneDrive = process.env.OneDrive;
  });
  afterAll(() => {
    if (savedOneDrive === undefined) delete process.env.OneDrive;
    else process.env.OneDrive = savedOneDrive;
    rmSync(base, { recursive: true, force: true });
  });

  test('tar до шифрования и его .part — открытые; .tar.gpg и json — нет', () => {
    expect(['s.tar', 's.tar.part', 's.tar.gpg', 'index.json', 'verify.json', 'tar'].map(isPlaintextFile))
      .toEqual([true, true, false, false, false, false]);
  });

  test('внутри репозитория — два отказа; во временной папке — годится; внутри OneDrive — отказ', async () => {
    const inRepo = await checkSnapshotRoot(join(REPO_DIR, 'snapshots-test-not-created'));
    expect(inRepo).toHaveLength(2);
    expect(inRepo[0]).toMatch(/внутри git-дерева/);
    expect(inRepo[1]).toMatch(/внутри репозитория проекта/);

    delete process.env.OneDrive;
    expect(await checkSnapshotRoot(join(base, 'NirivioSnapshots'))).toEqual([]);

    process.env.OneDrive = base;
    const inOneDrive = await checkSnapshotRoot(join(base, 'NirivioSnapshots'));
    expect(inOneDrive).toHaveLength(1);
    expect(inOneDrive[0]).toMatch(/внутри OneDrive/);
  });
});

describe('Admin API — только список чтения', () => {
  test('GET ping/usage/resources — можно; иной метод и иной путь — исключение до запроса', () => {
    expect(() => assertReadOnlyAdminCall('GET', 'ping')).not.toThrow();
    expect(() => assertReadOnlyAdminCall('GET', 'usage')).not.toThrow();
    expect(() => assertReadOnlyAdminCall('GET', 'resources/image')).not.toThrow();
    expect(() => assertReadOnlyAdminCall('GET', 'resources/raw/authenticated')).not.toThrow();
    expect(() => assertReadOnlyAdminCall('DELETE', 'resources/image/upload')).toThrow(/только GET/);
    expect(() => assertReadOnlyAdminCall('POST', 'resources/image/upload')).toThrow(/только GET/);
    expect(() => assertReadOnlyAdminCall('GET', 'resources/image/upload/destroy')).toThrow(/вне списка чтения/);
    expect(() => assertReadOnlyAdminCall('GET', 'resources/image/tags/x')).toThrow(/вне списка чтения/);
  });
});
