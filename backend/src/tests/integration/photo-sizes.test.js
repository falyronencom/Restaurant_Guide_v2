/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Три размера фото и ужатый оригинал (нитка «Нагрузка и расходы поставщиков»,
 * директива D2; решение Координатора 21.10.2026, меры А и Б).
 *
 * А. Мастер карточки (создание) и синхронизация медиа при правке писали одну
 *    ссылку 1920 px во все три поля фото — url, preview_url, thumbnail_url, — и
 *    обложку каталога из неё же: ленты тянули полный размер (на проде 250 фото
 *    из 437). Теперь превью и миниатюра — те же размеры, что выдаёт загрузка
 *    (generateAllResolutions), а url остаётся присланным: по нему синхронизация
 *    сверяет строки.
 * Б. Облако хранило оригинал как прислан (сайт шлёт сырой файл до 10 МБ).
 *    Теперь загрузка фото несёт входное преобразование: фото меню — ширина
 *    1920 без предела высоты (ровно то, что читает распознавание: media.url,
 *    вариант 'original'), остальные фото — длинная сторона 2560. PDF — без
 *    преобразования.
 * Скрипт scripts/photo-sizes — пересчёт старых строк: сухой прогон, файл
 *    отката, запись с числом, откат.
 *
 * Работает настоящий config/cloudinary.js; подменён только сетевой вызов SDK
 * uploader.upload. Ожидаемые ссылки — литералы в формах, которые выдаёт сервер
 * (облако test из setup-env.js).
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import { pool } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { sdkAnalyticsQuery } from '../utils/cloudinaryAnalytics.js';
import { testEstablishments } from '../fixtures/establishments.js';
import {
  applyPlan,
  applyRollback,
  buildBackup,
  buildPlan,
  planRollback,
} from '../../../scripts/photo-sizes/plan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../../../scripts/photo-sizes/index.js');

// Ссылки доставки, как их строит generateImageUrl (облако test, SDK 2.x);
// хвост ?_a= — от SDK этого процесса: он зависит от версии Node.
const delivery = (publicId, size) =>
  `https://res.cloudinary.com/test/image/upload/${size}/f_auto,fl_progressive,q_auto/v1/${publicId}${sdkAnalyticsQuery()}`;
const ORIGINAL = 'c_limit,w_1920';
const PREVIEW = 'c_limit,w_1200';
const THUMBNAIL = 'c_fill,h_300,w_400';

const PHOTO = { body: 'fake-jpeg', filename: 'photo.jpg', contentType: 'image/jpeg' };
const MENU_PDF = { body: '%PDF-1.4 fake menu', filename: 'menu.pdf', contentType: 'application/pdf' };

let uploadSeq = 0;
let uploadSpy;

beforeEach(async () => {
  await clearAllData();
  uploadSpy = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => {
    uploadSeq += 1;
    const publicId = `${options.folder}/up${String(uploadSeq).padStart(4, '0')}`;
    const ext = options.folder.endsWith('/menu_pdf') ? 'pdf' : 'jpg';
    return {
      public_id: publicId,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1759700000/${publicId}.${ext}`,
      width: 800,
      height: 600,
      format: ext,
      bytes: 2048,
      pages: 1,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

let accountSeq = 0;
const newPartner = async () => {
  accountSeq += 1;
  const { user, accessToken } = await createUserAndGetTokens({
    email: `photo-sizes-${Date.now()}-${accountSeq}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр Фото',
    role: 'partner',
  });
  return { partner: user, token: accessToken };
};

const tempUpload = async (token, type, file) => (await request(app)
  .post('/api/v1/partner/media/upload')
  .set('Authorization', `Bearer ${token}`)
  .field('type', type)
  .attach('file', Buffer.from(file.body), { filename: file.filename, contentType: file.contentType })
  .expect(201)).body.data;

const mediaOf = async (establishmentId) => (await query(
  `SELECT id, type, file_type, url, thumbnail_url, preview_url, is_primary FROM establishment_media
   WHERE establishment_id = $1 ORDER BY type, position, url`,
  [establishmentId],
)).rows;

const coverOf = async (establishmentId) =>
  (await query('SELECT primary_image_url FROM establishments WHERE id = $1', [establishmentId])).rows[0].primary_image_url;

/** Строка фото с тремя размерами одного файла: url присланный, превью и миниатюра — литералы. */
const threeSizes = (upload) => ({
  url: upload.url,
  preview_url: delivery(upload.public_id, PREVIEW),
  thumbnail_url: delivery(upload.public_id, THUMBNAIL),
});

// ============================================================================
// А. Сохранение карточки
// ============================================================================

describe('А. Сохранение карточки пишет три размера фото', () => {
  test('создание из мастера: фото интерьера и меню — три разных адреса, PDF и url — как прежде, обложка — превью', async () => {
    const { token } = await newPartner();
    const first = await tempUpload(token, 'interior', PHOTO);
    const second = await tempUpload(token, 'interior', PHOTO);
    const menuPhoto = await tempUpload(token, 'menu', PHOTO);
    const pdf = await tempUpload(token, 'menu', MENU_PDF);

    const response = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...testEstablishments[0],
        interior_photos: [first.url, second.url],
        menu_photos: [menuPhoto.url],
        menu_pdfs: [{ url: pdf.url, thumbnail_url: pdf.thumbnail_url, preview_url: pdf.preview_url, file_name: 'menu.pdf' }],
        primary_photo: second.url,
      })
      .expect(201);
    const cardId = response.body.data.establishment.id;

    // Загрузка выдала url в размере 'original' — его и присылает мастер.
    expect(first.url).toBe(delivery(first.public_id, ORIGINAL));
    const media = await mediaOf(cardId);
    expect(media).toEqual([
      expect.objectContaining({ type: 'interior', file_type: 'image', ...threeSizes(first), is_primary: false }),
      expect.objectContaining({ type: 'interior', file_type: 'image', ...threeSizes(second), is_primary: true }),
      expect.objectContaining({ type: 'menu', file_type: 'image', ...threeSizes(menuPhoto) }),
      expect.objectContaining({
        type: 'menu', file_type: 'pdf', url: pdf.url, thumbnail_url: pdf.thumbnail_url, preview_url: pdf.preview_url,
      }),
    ]);
    // Те же адреса, что загрузка выдала мастеру (и что пишет POST /:id/media).
    expect(media[0]).toEqual(expect.objectContaining({ preview_url: first.preview_url, thumbnail_url: first.thumbnail_url }));
    expect(await coverOf(cardId)).toBe(delivery(second.public_id, PREVIEW));
  });

  test('правка (синхронизация медиа): добавленные фото — три адреса, обложка — превью; повторное сохранение не пересоздаёт строки', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const photo = await tempUpload(token, 'interior', PHOTO);
    const menuPhoto = await tempUpload(token, 'menu', PHOTO);
    const save = () => request(app)
      .put(`/api/v1/partner/establishments/${card.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ interior_photos: [photo.url], menu_photos: [menuPhoto.url], primary_photo: photo.url })
      .expect(200);

    await save();
    const media = await mediaOf(card.id);
    expect(media).toEqual([
      expect.objectContaining({ type: 'interior', file_type: 'image', ...threeSizes(photo), is_primary: true }),
      expect.objectContaining({ type: 'menu', file_type: 'image', ...threeSizes(menuPhoto) }),
    ]);
    expect(await coverOf(card.id)).toBe(delivery(photo.public_id, PREVIEW));

    // Клиент присылает те же url — строки те же (сверка по url не сломана).
    await save();
    expect((await mediaOf(card.id)).map((row) => row.id)).toEqual(media.map((row) => row.id));
  });
});

describe('А. Ссылка не в той форме, что выдаёт сервер, остаётся одной во всех полях', () => {
  // Своя загрузка, но другая обрезка: превью из чистого public_id показало бы в
  // лентах и обложке другую картинку, чем полный размер (ревью, линза, 1).
  // Фото из папки PDF без расширения облако отдаёт самим PDF (линза, 2).
  test.each([
    ['другая обрезка', (pid) => `https://res.cloudinary.com/test/image/upload/c_fill,h_2000,w_10/f_auto,fl_progressive,q_auto/v1/establishments/temp/${pid}/interior/own0001?_a=BAMAMiRg0`],
    ['файл из папки PDF', (pid) => `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${pid}/menu_pdf/own0002.jpg`],
  ])('%s', async (_label, linkOf) => {
    const { partner, token } = await newPartner();
    const link = linkOf(partner.id);

    const response = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...testEstablishments[0], interior_photos: [link], primary_photo: link })
      .expect(201);
    const cardId = response.body.data.establishment.id;

    expect(await mediaOf(cardId)).toEqual([
      expect.objectContaining({ type: 'interior', url: link, preview_url: link, thumbnail_url: link }),
    ]);
    expect(await coverOf(cardId)).toBe(link);
  });

  test('ссылки, которые выдавал сервер: прежняя форма до 20.07.2026 и secure_url загрузки — три размера', async () => {
    const { partner, token } = await newPartner();
    const before = `establishments/temp/${partner.id}/interior/old0001`;
    const plain = `establishments/temp/${partner.id}/interior/old0002`;
    const links = [
      `https://res.cloudinary.com/test/image/upload/c_limit,h_1080,w_1920/f_auto,fl_progressive,q_auto/v1/${before}?_a=BAMAMiRg0`,
      `https://res.cloudinary.com/test/image/upload/v1759600000/${plain}.jpg`,
    ];

    const response = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...testEstablishments[0], interior_photos: links })
      .expect(201);

    expect(await mediaOf(response.body.data.establishment.id)).toEqual([
      expect.objectContaining({ url: links[0], preview_url: delivery(before, PREVIEW), thumbnail_url: delivery(before, THUMBNAIL) }),
      expect.objectContaining({ url: links[1], preview_url: delivery(plain, PREVIEW), thumbnail_url: delivery(plain, THUMBNAIL) }),
    ]);
  });
});

// ============================================================================
// Б. Загрузка
// ============================================================================

const MENU_INCOMING = [{ width: 1920, crop: 'limit', quality: 'auto:best' }];
const PHOTO_INCOMING = [{ width: 2560, height: 2560, crop: 'limit', quality: 'auto:good' }];

describe('Б. Облако хранит ужатый оригинал фото', () => {
  test.each([
    ['фото интерьера', 'interior', PHOTO_INCOMING],
    ['фото меню', 'menu', MENU_INCOMING],
  ])('временная загрузка (мастер): %s', async (_label, type, expected) => {
    const { token } = await newPartner();
    await tempUpload(token, type, PHOTO);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy.mock.calls[0][1].transformation).toEqual(expected);
  });

  test('загрузка прямо в карточку (POST /:id/media)', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    await request(app)
      .post(`/api/v1/partner/establishments/${card.id}/media`)
      .set('Authorization', `Bearer ${token}`)
      .field('type', 'menu')
      .attach('file', Buffer.from(PHOTO.body), { filename: PHOTO.filename, contentType: PHOTO.contentType })
      .expect(201);
    expect(uploadSpy.mock.calls[0][1].transformation).toEqual(MENU_INCOMING);
  });

  test('PDF меню — без преобразования', async () => {
    const { token } = await newPartner();
    await tempUpload(token, 'menu', MENU_PDF);
    expect(uploadSpy.mock.calls[0][1]).not.toHaveProperty('transformation');
  });

  test('SDK отправляет в облако параметр преобразования; фото меню — ширина варианта, который читает распознавание', () => {
    const wire = (transformation) =>
      cloudinarySdk.utils.build_upload_params({ folder: 'f', resource_type: 'image', transformation }).transformation;
    expect(wire(PHOTO_INCOMING)).toBe('c_limit,h_2560,q_auto:good,w_2560');
    expect(wire(MENU_INCOMING)).toBe('c_limit,q_auto:best,w_1920');
    expect(ORIGINAL).toBe('c_limit,w_1920');
  });
});

// ============================================================================
// Скрипт пересчёта старых строк
// ============================================================================

describe('Скрипт photo-sizes: пересчёт старых строк', () => {
  let card;
  let otherCard;
  let ids;
  let db;
  const pidOf = (name) => `establishments/temp/${card.partner_id}/interior/${name}`;

  const insertMedia = async (establishmentId, { type = 'interior', fileType = 'image', url, thumbnail = url, preview = url, position = 0 }) =>
    (await query(
      `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false) RETURNING id`,
      [establishmentId, type, fileType, url, thumbnail, preview, position],
    )).rows[0].id;

  const rowOf = async (id) =>
    (await query('SELECT url, thumbnail_url, preview_url FROM establishment_media WHERE id = $1', [id])).rows[0];

  const snapshot = async () => (await query(
    `SELECT id, url, thumbnail_url, preview_url FROM establishment_media ORDER BY id`,
  )).rows.concat((await query('SELECT id, primary_image_url FROM establishments ORDER BY id')).rows);

  afterEach(() => db.release());

  beforeEach(async () => {
    db = await pool.connect();
    const { partner } = await newPartner();
    card = await createTestEstablishment(partner.id);
    otherCard = await createTestEstablishment(partner.id);
    ids = {
      // одна ссылка во всех полях, наше облако — к пересчёту
      interior: await insertMedia(card.id, { url: delivery(pidOf('old0001'), ORIGINAL) }),
      menu: await insertMedia(card.id, { type: 'menu', url: delivery(pidOf('old0002'), ORIGINAL), position: 1 }),
      // одна ссылка, но не наше облако — пропуск
      foreign: await insertMedia(card.id, { url: 'https://images.example.org/photo.jpg', position: 2 }),
      // уже три размера — не трогается
      done: await insertMedia(card.id, {
        url: delivery(pidOf('new0003'), ORIGINAL),
        thumbnail: delivery(pidOf('new0003'), THUMBNAIL),
        preview: delivery(pidOf('new0003'), PREVIEW),
        position: 3,
      }),
      // PDF с одинаковыми полями — не фото, не трогается
      pdf: await insertMedia(card.id, {
        type: 'menu', fileType: 'pdf', url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/x/menu_pdf/m.pdf', position: 4,
      }),
      // PDF, записанный до 20.07.2026 как фото, — пропуск: его чинит backfill-media-fix.js
      pdfAsImage: await insertMedia(card.id, {
        type: 'menu', url: `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${card.partner_id}/menu_pdf/old.pdf`, position: 5,
      }),
      // Своё облако, но не та форма, что выдаёт сервер: другая обрезка и
      // сегмент, который разбор принимает за часть public_id, — пропуск.
      cropped: await insertMedia(card.id, {
        url: `https://res.cloudinary.com/test/image/upload/c_fill,h_2000,w_10/f_auto,fl_progressive,q_auto/v1/${pidOf('old0006')}?_a=BAMAMiRg0`, position: 6,
      }),
      junk: await insertMedia(card.id, {
        url: `https://res.cloudinary.com/test/image/upload/e_blur:300/v1/${pidOf('old0007')}`, position: 7,
      }),
    };
    await query('UPDATE establishments SET primary_image_url = $1 WHERE id = $2', [delivery(pidOf('old0001'), ORIGINAL), card.id]);
    // У другой карточки тоже фото к пересчёту, но обложка — не ссылка её фото
    // (ссылка фото первой карточки): обложка не трогается.
    ids.other = await insertMedia(otherCard.id, { url: delivery(pidOf('old0004'), ORIGINAL) });
    await query('UPDATE establishments SET primary_image_url = $1 WHERE id = $2', [delivery(pidOf('old0001'), ORIGINAL), otherCard.id]);
  });

  test('сухой прогон считает фото, пропуски и обложки и ничего не пишет', async () => {
    const before = await snapshot();
    const plan = await buildPlan(db);
    expect(plan.found).toBe(7);
    expect(plan.changes.map((change) => change.id).sort()).toEqual([ids.interior, ids.menu, ids.other].sort());
    expect(plan.skipped).toEqual([
      expect.objectContaining({ id: ids.foreign, reason: 'not_our_cloud' }),
      expect.objectContaining({ id: ids.cropped, reason: 'not_issued_form' }),
      expect.objectContaining({ id: ids.junk, reason: 'not_issued_form' }),
      expect.objectContaining({ id: ids.pdfAsImage, reason: 'pdf_link' }),
    ]);
    expect(plan.covers).toEqual([{
      id: card.id, old: delivery(pidOf('old0001'), ORIGINAL), next: delivery(pidOf('old0001'), PREVIEW),
    }]);
    expect(await snapshot()).toEqual(before);
  });

  test('запись: превью и миниатюра из public_id, url и остальное — как были; повтор находит ноль', async () => {
    const plan = await buildPlan(db);
    expect(await applyPlan(db, plan)).toEqual({ media: 3, covers: 1 });

    expect(await rowOf(ids.interior)).toEqual({
      url: delivery(pidOf('old0001'), ORIGINAL),
      preview_url: delivery(pidOf('old0001'), PREVIEW),
      thumbnail_url: delivery(pidOf('old0001'), THUMBNAIL),
    });
    expect(await rowOf(ids.menu)).toEqual({
      url: delivery(pidOf('old0002'), ORIGINAL),
      preview_url: delivery(pidOf('old0002'), PREVIEW),
      thumbnail_url: delivery(pidOf('old0002'), THUMBNAIL),
    });
    expect((await rowOf(ids.foreign)).preview_url).toBe('https://images.example.org/photo.jpg');
    expect((await rowOf(ids.pdf)).preview_url).toBe('https://res.cloudinary.com/test/image/upload/v1/establishments/x/menu_pdf/m.pdf');
    expect((await rowOf(ids.pdfAsImage)).preview_url).toBe(
      `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${card.partner_id}/menu_pdf/old.pdf`,
    );
    expect((await rowOf(ids.done)).preview_url).toBe(delivery(pidOf('new0003'), PREVIEW));
    expect(await coverOf(card.id)).toBe(delivery(pidOf('old0001'), PREVIEW));
    expect(await coverOf(otherCard.id)).toBe(delivery(pidOf('old0001'), ORIGINAL));

    const again = await buildPlan(db);
    expect(again.changes).toHaveLength(0);
    expect(again.covers).toHaveLength(0);
  });

  test('строку и обложку, изменённые после сухого прогона, запись не перезаписывает', async () => {
    const plan = await buildPlan(db);
    await query('UPDATE establishment_media SET preview_url = $1 WHERE id = $2', ['https://partner-saved.example/p', ids.menu]);
    await query('UPDATE establishments SET primary_image_url = $1 WHERE id = $2', ['https://partner-saved.example/c', card.id]);

    expect(await applyPlan(db, plan)).toEqual({ media: 2, covers: 0 });
    expect((await rowOf(ids.menu)).preview_url).toBe('https://partner-saved.example/p');
    expect(await coverOf(card.id)).toBe('https://partner-saved.example/c');
  });

  test('откат возвращает старые значения, кроме изменённых после записи', async () => {
    const plan = await buildPlan(db);
    const before = await snapshot();
    await applyPlan(db, plan);
    const backup = JSON.parse(JSON.stringify(buildBackup({ target: 'test', ...plan })));

    const untouched = await planRollback(db, backup, 'test');
    expect(untouched.media).toHaveLength(3);
    expect(untouched.changedSince).toBe(0);

    await query('UPDATE establishment_media SET thumbnail_url = $1 WHERE id = $2', ['https://partner-saved.example/t', ids.menu]);
    const rollback = await planRollback(db, backup, 'test');
    expect(rollback.changedSince).toBe(1);
    expect(await applyRollback(db, rollback)).toEqual({ media: 2, covers: 1 });

    const after = await snapshot();
    const menuNow = after.find((row) => row.id === ids.menu);
    expect(menuNow.thumbnail_url).toBe('https://partner-saved.example/t');
    expect(after.filter((row) => row.id !== ids.menu)).toEqual(before.filter((row) => row.id !== ids.menu));
  });

  test('откат не верит файлу: другая база, изменённые фото или обложка — отказ до записи', async () => {
    const plan = await buildPlan(db);
    await applyPlan(db, plan);
    const afterApply = await snapshot();
    const backupOf = () => JSON.parse(JSON.stringify(buildBackup({ target: 'test', ...plan })));

    await expect(planRollback(db, backupOf(), 'prod')).rejects.toMatchObject({ code: 'BACKUP_OTHER_TARGET' });

    const forgedPhoto = backupOf();
    forgedPhoto.media[0].old.preview_url = 'https://images.example.org/victim.jpg';
    await expect(planRollback(db, forgedPhoto, 'test')).rejects.toMatchObject({ code: 'BACKUP_UNREADABLE' });

    const forgedNext = backupOf();
    forgedNext.media[0].next.thumbnail_url = 'https://images.example.org/other.jpg';
    await expect(planRollback(db, forgedNext, 'test')).rejects.toMatchObject({ code: 'BACKUP_UNREADABLE' });

    const forgedCover = backupOf();
    forgedCover.covers[0].old = 'https://images.example.org/cover.jpg';
    await expect(planRollback(db, forgedCover, 'test')).rejects.toMatchObject({ code: 'BACKUP_UNREADABLE' });

    expect(await snapshot()).toEqual(afterApply);
  });

  describe('запуск index.js (локальная база)', () => {
    let backupDir;
    beforeEach(() => { backupDir = mkdtempSync(join(tmpdir(), 'photo-sizes-')); });
    afterEach(() => { rmSync(backupDir, { recursive: true, force: true }); });

    const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: process.env, encoding: 'utf8' });

    test('ошибки в команде — код 2, база не тронута', async () => {
      const before = await snapshot();
      expect(run('--apply').status).toBe(2);
      expect(run('--aply').status).toBe(2);
      expect(run('--expect=x', '--apply').status).toBe(2);
      expect(await snapshot()).toEqual(before);
    });

    test('сухой прогон, отказ при другом числе, запись с файлом отката, откат', async () => {
      const before = await snapshot();

      const dry = run();
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain('к пересчёту: 3 (interior 2, menu 1), карточек 2');
      expect(dry.stdout).toContain('пропущено: ссылка не нашего облака 1, не в форме, что выдаёт сервер, 2, ссылка на PDF 1');
      expect(dry.stdout).toContain('--expect=3 --apply');
      expect(await snapshot()).toEqual(before);

      expect(run('--expect=4', '--apply', `--backup-dir=${backupDir}`).status).toBe(1);
      expect(await snapshot()).toEqual(before);
      expect(readdirSync(backupDir)).toHaveLength(0);

      const applied = run('--expect=3', '--apply', `--backup-dir=${backupDir}`);
      expect(applied.status).toBe(0);
      expect(applied.stdout).toContain('Записано: фото 3 из 3, обложек 1 из 1');
      expect((await rowOf(ids.interior)).preview_url).toBe(delivery(pidOf('old0001'), PREVIEW));
      const [backupName] = readdirSync(backupDir);
      const backupPath = join(backupDir, backupName);
      expect(existsSync(backupPath)).toBe(true);
      expect(JSON.parse(readFileSync(backupPath, 'utf8')).media).toHaveLength(3);

      const afterApply = await snapshot();
      expect(run(`--rollback=${backupPath}`).status).toBe(0);
      expect(await snapshot()).toEqual(afterApply);

      const rolledBack = run(`--rollback=${backupPath}`, '--apply');
      expect(rolledBack.status).toBe(0);
      expect(rolledBack.stdout).toContain('Возвращено: фото 3, обложек 1');
      expect(await snapshot()).toEqual(before);
    });
  });
});
