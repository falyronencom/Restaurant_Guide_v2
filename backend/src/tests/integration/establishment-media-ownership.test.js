/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Ссылки медиа карточки принимаются при сохранении, только если это файлы,
 * загруженные самим партнёром (внешний обзор 02.10.2026, N3, вторая половина).
 *
 * До правки создание и правка карточки (POST и PUT /partner/establishments)
 * проверяли у ссылок только расширение файла, а обложку и превью PDF не
 * проверяли вовсе. Партнёр мог вписать в свою карточку чужое фото, PDF меню
 * чужой карточки или картинку с любого сайта — у активной карточки она сразу
 * видна в каталоге, модерация в правке не участвует. Обложку каталога
 * (primary_image_url) правка записывала прямо из запроса.
 *
 * Своё — это файлы в папках, куда их кладут наши маршруты загрузки:
 * establishments/temp/{id партнёра}/ (временные загрузки: приложение и сайт)
 * и establishments/{id карточки}/ (загрузка прямо в карточку), — и ссылка
 * показывает только этот файл: инструкции облака в ней лишь меняют размер,
 * обрезку и формат, как у ссылок, которые строит сервер (наложение чужого фото,
 * файла с другого сайта или текста делает картинку чужой — находка ревью до
 * коммита). При правке проверяются только добавленные ссылки: фото карточек,
 * переданных владельцу со служебного аккаунта, лежат в папке служебного
 * аккаунта, и правка таких карточек не должна ломаться.
 *
 * Здесь работает настоящий config/cloudinary.js; подменён только сетевой вызов
 * SDK — uploader.upload, через который маршрут временных загрузок кладёт файл
 * в облако. Ссылки — в формах, которые выдаёт сервер: каноническая ссылка
 * доставки без расширения, secure_url загрузки с версией и расширением, превью
 * PDF (pg_1, .jpg). Текст отказа — литерал: его читает партнёр (приложение
 * показывает сообщение сервера как есть).
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { testEstablishments } from '../fixtures/establishments.js';

const REFUSAL =
  'Одно из фото или файлов меню загружено не с этого аккаунта. Удалите его и загрузите заново.';
const REFUSAL_LOG = 'Media link refused: not among the partner\'s own uploads';

// Каноническая ссылка доставки, как её строит generateAllResolutions.
const deliveryUrl = (publicId) =>
  `https://res.cloudinary.com/test/image/upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/${publicId}?_a=BAMAMiRg0`;
// secure_url загрузки: версия и расширение (PDF меню, аватар).
const uploadedUrl = (publicId, ext) =>
  `https://res.cloudinary.com/test/image/upload/v1759600000/${publicId}.${ext}`;
// Превью первой страницы PDF, как их строят generatePdfThumbnailUrl / generatePdfPreviewUrl.
const pdfThumbUrl = (publicId) =>
  `https://res.cloudinary.com/test/image/upload/c_fill,h_300,pg_1,w_400/f_jpg,q_auto/v1/${publicId}.jpg?_a=BAMAMiRg0`;
const pdfPreviewUrl = (publicId) =>
  `https://res.cloudinary.com/test/image/upload/c_limit,pg_1,w_1200/f_jpg,q_auto/v1/${publicId}.jpg?_a=BAMAMiRg0`;

const PHOTO = { body: 'fake-jpeg', filename: 'photo.jpg', contentType: 'image/jpeg' };
const MENU_PDF = { body: '%PDF-1.4 fake menu', filename: 'menu.pdf', contentType: 'application/pdf' };

let uploadSeq = 0;

beforeEach(async () => {
  await clearAllData();
  // Маршрут временных загрузок кладёт файл в облако одним вызовом SDK; ответ —
  // как у Cloudinary: public_id в переданной папке, secure_url с расширением.
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => {
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

// Порядковый номер в адресе: два аккаунта, созданные в одну миллисекунду, не
// сталкиваются по email.
let accountSeq = 0;
const newPartner = async () => {
  accountSeq += 1;
  const { user, accessToken } = await createUserAndGetTokens({
    email: `media-owner-${Date.now()}-${accountSeq}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр Медиа',
    role: 'partner',
  });
  return { partner: user, token: accessToken };
};

const tempUpload = async (token, type, file) => {
  const response = await request(app)
    .post('/api/v1/partner/media/upload')
    .set('Authorization', `Bearer ${token}`)
    .field('type', type)
    .attach('file', Buffer.from(file.body), { filename: file.filename, contentType: file.contentType })
    .expect(201);
  return response.body.data;
};

const createCard = (token, media) => request(app)
  .post('/api/v1/partner/establishments')
  .set('Authorization', `Bearer ${token}`)
  .send({ ...testEstablishments[0], ...media });

const updateCard = (token, cardId, updates) => request(app)
  .put(`/api/v1/partner/establishments/${cardId}`)
  .set('Authorization', `Bearer ${token}`)
  .send(updates);

const insertMedia = async (establishmentId, url, { type = 'interior', fileType = 'image', position = 0 } = {}) => {
  const { rows } = await query(
    `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
     VALUES ($1, $2, $3, $4, $4, $4, $5, false) RETURNING id`,
    [establishmentId, type, fileType, url, position],
  );
  return rows[0].id;
};

const mediaOf = async (establishmentId) => (await query(
  `SELECT id, type, file_type, url, thumbnail_url, preview_url FROM establishment_media
   WHERE establishment_id = $1 ORDER BY type, position, url`,
  [establishmentId],
)).rows;

const cardRow = async (establishmentId) => (await query(
  'SELECT name, primary_image_url FROM establishments WHERE id = $1',
  [establishmentId],
)).rows[0];

const establishmentCount = async () =>
  Number((await query('SELECT COUNT(*) AS n FROM establishments')).rows[0].n);

// Текст — в поле message верхнего уровня: его приложение и показывает (код
// ошибки без подробностей, см. _extractErrorMessage в mobile api_client.dart).
const expectRefusal = (response) => {
  expect(response.status).toBe(422);
  expect(response.body.error.code).toBe('MEDIA_URL_NOT_OWNED');
  expect(response.body.message).toBe(REFUSAL);
};

// ============================================================================
// Создание карточки
// ============================================================================

describe('Создание: ссылки из своих загрузок принимаются', () => {
  test('ссылки, выданные маршрутом временных загрузок, сохраняются как есть во всех полях', async () => {
    const { partner, token } = await newPartner();
    const interior = await tempUpload(token, 'interior', PHOTO);
    const menuPhoto = await tempUpload(token, 'menu', PHOTO);
    const pdf = await tempUpload(token, 'menu', MENU_PDF);

    const response = await createCard(token, {
      interior_photos: [interior.url],
      menu_photos: [menuPhoto.url],
      menu_pdfs: [{
        url: pdf.url, thumbnail_url: pdf.thumbnail_url, preview_url: pdf.preview_url, file_name: 'menu.pdf',
      }],
      primary_photo: interior.url,
    }).expect(201);

    const cardId = response.body.data.establishment.id;
    // Загрузки легли в папку загрузок этого партнёра — то, что проверка зовёт «своим».
    expect(interior.public_id).toMatch(new RegExp(`^establishments/temp/${partner.id}/interior/`));
    expect(pdf.public_id).toMatch(new RegExp(`^establishments/temp/${partner.id}/menu_pdf/`));
    const media = await mediaOf(cardId);
    expect(media).toHaveLength(3);
    expect(media).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'interior', file_type: 'image', url: interior.url }),
      expect.objectContaining({ type: 'menu', file_type: 'image', url: menuPhoto.url }),
      expect.objectContaining({
        type: 'menu', file_type: 'pdf', url: pdf.url, thumbnail_url: pdf.thumbnail_url, preview_url: pdf.preview_url,
      }),
    ]));
    expect((await cardRow(cardId)).primary_image_url).toBe(interior.url);
  });

  test.each([
    ['обложки нет (null)', null],
    ['обложка — пустая строка', ''],
  ])('необязательную обложку можно не указывать: %s', async (_label, primary) => {
    const { partner, token } = await newPartner();
    const own = deliveryUrl(`establishments/temp/${partner.id}/interior/own0001`);

    await createCard(token, { interior_photos: [own], primary_photo: primary }).expect(201);

    expect(await establishmentCount()).toBe(1);
  });

  // Формы, которые сервер выдавал до 20.07.2026 (размеры с высотой, c_fit у
  // превью): такие ссылки уже лежат в карточках и могут прийти добавленными
  // снова — например, из вкладки со старым состоянием.
  test.each([
    ['оригинал до 20.07.2026', 'c_limit,h_1080,w_1920/f_auto,fl_progressive,q_auto'],
    ['превью до 20.07.2026', 'c_fit,h_600,w_800/f_auto,fl_progressive,q_auto'],
    ['миниатюра до 20.07.2026', 'c_fill,h_150,w_200/f_auto,fl_progressive,q_auto'],
  ])('ссылки прежних форм из своих загрузок принимаются: %s', async (_label, transformations) => {
    const { partner, token } = await newPartner();
    const own = `https://res.cloudinary.com/test/image/upload/${transformations}/v1/establishments/temp/${partner.id}/interior/own0001?_a=BAMAMiRg0`;

    await createCard(token, { interior_photos: [own] }).expect(201);
  });
});

describe('Создание: чужая ссылка в любом поле — отказ, карточка не создаётся', () => {
  // Каждое поле проверяется отдельно: остальные поля несут свои ссылки, и без
  // чужой ссылки такой запрос принимается (тест выше).
  const ownPdf = (self) => `establishments/temp/${self.id}/menu_pdf/own0002`;
  const ownMedia = (self) => ({
    interior_photos: [deliveryUrl(`establishments/temp/${self.id}/interior/own0001`)],
    menu_pdfs: [{
      url: uploadedUrl(ownPdf(self), 'pdf'),
      thumbnail_url: pdfThumbUrl(ownPdf(self)),
      preview_url: pdfPreviewUrl(ownPdf(self)),
      file_name: 'menu.pdf',
    }],
    primary_photo: deliveryUrl(`establishments/temp/${self.id}/interior/own0001`),
  });
  const victim = (other) => `establishments/temp/${other.id}/interior/victim0001`;
  const victimPdf = (other) => `establishments/temp/${other.id}/menu_pdf/victim0002`;

  test.each([
    ['фото интерьера', (self, other) => ({
      ...ownMedia(self), interior_photos: [deliveryUrl(victim(other))],
    })],
    ['фото меню', (self, other) => ({
      ...ownMedia(self), menu_photos: [deliveryUrl(victim(other))],
    })],
    ['ссылка на PDF меню', (self, other) => ({
      ...ownMedia(self),
      menu_pdfs: [{ ...ownMedia(self).menu_pdfs[0], url: uploadedUrl(victimPdf(other), 'pdf') }],
    })],
    ['превью PDF меню', (self, other) => ({
      ...ownMedia(self),
      menu_pdfs: [{ ...ownMedia(self).menu_pdfs[0], thumbnail_url: pdfThumbUrl(victimPdf(other)) }],
    })],
    ['картинка первой страницы PDF меню', (self, other) => ({
      ...ownMedia(self),
      menu_pdfs: [{ ...ownMedia(self).menu_pdfs[0], preview_url: pdfPreviewUrl(victimPdf(other)) }],
    })],
    ['обложка', (self, other) => ({
      ...ownMedia(self), primary_photo: deliveryUrl(victim(other)),
    })],
  ])('%s', async (_label, media) => {
    const { partner: self, token } = await newPartner();
    const { partner: other } = await newPartner();

    expectRefusal(await createCard(token, media(self, other)));

    expect(await establishmentCount()).toBe(0);
  });

  test.each([
    ['загрузка другого партнёра', (self, other) =>
      deliveryUrl(`establishments/temp/${other.id}/interior/victim0001`)],
    ['фото чужой карточки', (self, other, otherCard) =>
      deliveryUrl(`establishments/${otherCard.id}/interior/victim0002`)],
    ['сторонний сайт', () => 'https://images.example.org/victim0003.jpg'],
    ['своя папка в другом облаке', (self) =>
      `https://res.cloudinary.com/othercloud/image/upload/v1/establishments/temp/${self.id}/interior/own0001.jpg`],
    ['своя папка по http', (self) =>
      `http://res.cloudinary.com/test/image/upload/v1/establishments/temp/${self.id}/interior/own0001.jpg`],
    ['своя папка, тип ресурса raw', (self) =>
      `https://res.cloudinary.com/test/raw/upload/v1/establishments/temp/${self.id}/interior/own0001.jpg`],
    ['шаг назад из своей папки к чужой загрузке', (self, other) =>
      deliveryUrl(`establishments/temp/${self.id}/../${other.id}/interior/victim0004`)],
    ['свой аватар — не медиа карточки', (self) => uploadedUrl(`avatars/${self.id}/face0001`, 'jpg')],
    ['не строка', () => 12345],
  ])('фото интерьера: %s', async (_label, link) => {
    const { partner: self, token } = await newPartner();
    const { partner: other } = await newPartner();
    const otherCard = await createTestEstablishment(other.id);

    expectRefusal(await createCard(token, { interior_photos: [link(self, other, otherCard)] }));

    // Карточка другого партнёра не в счёт: новой карточки нет.
    expect(await establishmentCount()).toBe(1);
  });

  // Ссылка на своё фото может нести инструкции облака, которые рисуют в картинке
  // другое: чужое фото, файл с любого сайта, текст. Такая картинка — тоже чужая.
  // Своя загрузка — во всех случаях; меняется только то, что идёт перед ней.
  test.each([
    ['наложение чужого фото', (other) =>
      `l_establishments:temp:${other.id}:interior:victim0001,fl_relative,w_1,h_1,c_fill/f_auto,q_auto/v1`],
    ['подложка чужого фото', (other) =>
      `u_establishments:temp:${other.id}:interior:victim0001,w_1000/f_auto,q_auto/v1`],
    ['картинка со стороннего сайта поверх', () =>
      'l_fetch:aHR0cHM6Ly9pbWFnZXMuZXhhbXBsZS5vcmcvdmljdGltLnBuZw==,w_1000/f_auto,q_auto/v1'],
    ['текст поверх', () => 'l_text:Arial_80:victim,co_red/f_auto,q_auto/v1'],
    ['именованное преобразование', () => 't_victim,w_400/f_auto,q_auto/v1'],
    ['эффект', () => 'e_gen_replace:from_cat;to_victim,w_400/f_auto,q_auto/v1'],
    ['картинка по умолчанию — чужое фото', (other) =>
      `d_establishments:temp:${other.id}:interior:victim0001,w_400/f_auto,q_auto/v1`],
    ['наложение после номера версии', (other) =>
      `v1/l_establishments:temp:${other.id}:interior:victim0001,w_1`],
  ])('фото интерьера: своя загрузка, но %s', async (_label, beforeOwnFile) => {
    const { partner: self, token } = await newPartner();
    const { partner: other } = await newPartner();
    const link = `https://res.cloudinary.com/test/image/upload/${beforeOwnFile(other)}/establishments/temp/${self.id}/interior/own0001`;

    expectRefusal(await createCard(token, { interior_photos: [link] }));

    expect(await establishmentCount()).toBe(0);
  });

  test('в журнал уходит отказ с полем и причиной — без самой ссылки', async () => {
    const { partner: self, token } = await newPartner();
    const { partner: other } = await newPartner();
    const warn = jest.spyOn(logger, 'warn');

    expectRefusal(await createCard(token, { menu_photos: [deliveryUrl(`establishments/temp/${other.id}/menu/victim0005`)] }));
    expectRefusal(await createCard(token, { primary_photo: 'https://images.example.org/victim0006.jpg' }));
    expectRefusal(await createCard(token, {
      interior_photos: [`https://res.cloudinary.com/test/image/upload/l_establishments:temp:${other.id}:interior:victim0007,w_1/v1/establishments/temp/${self.id}/interior/own0001`],
    }));

    const refusals = warn.mock.calls.filter(([message]) => message === REFUSAL_LOG);
    expect(refusals).toEqual([
      [REFUSAL_LOG, { partnerId: self.id, bucket: 'menu', reason: 'outside_own_folders' }],
      [REFUSAL_LOG, { partnerId: self.id, bucket: 'primary', reason: 'not_our_cloud' }],
      [REFUSAL_LOG, { partnerId: self.id, bucket: 'interior', reason: 'transformation_not_allowed' }],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/victim|example\.org/);
  });
});

// ============================================================================
// Правка карточки
// ============================================================================

describe('Правка: добавленные свои ссылки принимаются', () => {
  test('загрузки через маршрут временных загрузок — фото и PDF меню', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const photo = await tempUpload(token, 'interior', PHOTO);
    const pdf = await tempUpload(token, 'menu', MENU_PDF);

    await updateCard(token, card.id, { interior_photos: [photo.url], menu_photos: [pdf.url] }).expect(200);

    expect(await mediaOf(card.id)).toEqual([
      expect.objectContaining({ type: 'interior', file_type: 'image', url: photo.url }),
      expect.objectContaining({ type: 'menu', file_type: 'pdf', url: pdf.url }),
    ]);
  });

  test('PDF из папки самой карточки (загрузка прямо в карточку)', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const cardPdf = uploadedUrl(`establishments/${card.id}/menu_pdf/menu0001`, 'pdf');

    await updateCard(token, card.id, { menu_photos: [cardPdf] }).expect(200);

    expect(await mediaOf(card.id)).toEqual([
      expect.objectContaining({ type: 'menu', file_type: 'pdf', url: cardPdf }),
    ]);
  });
});

describe('Правка карточки, переданной со служебного аккаунта: её фото лежат в чужой папке', () => {
  let partner;
  let token;
  let service;
  let card;
  let seeded;

  beforeEach(async () => {
    ({ partner, token } = await newPartner());
    ({ partner: service } = await newPartner());
    card = await createTestEstablishment(partner.id);
    seeded = {
      photo1: deliveryUrl(`establishments/temp/${service.id}/interior/seed0001`),
      photo2: deliveryUrl(`establishments/temp/${service.id}/interior/seed0002`),
      pdf: uploadedUrl(`establishments/temp/${service.id}/menu_pdf/seed0003`, 'pdf'),
    };
    await insertMedia(card.id, seeded.photo1, { position: 0 });
    await insertMedia(card.id, seeded.photo2, { position: 1 });
    await insertMedia(card.id, seeded.pdf, { type: 'menu', fileType: 'pdf' });
  });

  test('прежние ссылки, присланные без изменений, принимаются — строки те же', async () => {
    const before = await mediaOf(card.id);

    await updateCard(token, card.id, {
      name: 'Новое имя',
      interior_photos: [seeded.photo1, seeded.photo2],
      menu_photos: [seeded.pdf],
      primary_photo: seeded.photo1,
    }).expect(200);

    expect(await mediaOf(card.id)).toEqual(before);
    expect((await cardRow(card.id)).name).toBe('Новое имя');
  });

  test('своё новое фото добавляется, удалённое уходит, прежние на месте', async () => {
    const before = await mediaOf(card.id);
    const own = deliveryUrl(`establishments/temp/${partner.id}/interior/own0001`);

    await updateCard(token, card.id, {
      interior_photos: [seeded.photo1, own],
      menu_photos: [seeded.pdf],
    }).expect(200);

    const after = await mediaOf(card.id);
    expect(after.map((m) => m.url)).toEqual([seeded.photo1, own, seeded.pdf]);
    // Прежние строки не пересозданы.
    expect(after.find((m) => m.url === seeded.photo1).id).toBe(before.find((m) => m.url === seeded.photo1).id);
    expect(after.find((m) => m.url === seeded.pdf).id).toBe(before.find((m) => m.url === seeded.pdf).id);
  });

  test('вкладка со старым состоянием возвращает удалённое фото служебного аккаунта — отказ, остальное на месте', async () => {
    // Другая вкладка уже убрала photo2 из карточки.
    await query('DELETE FROM establishment_media WHERE establishment_id = $1 AND url = $2', [card.id, seeded.photo2]);
    const before = await mediaOf(card.id);

    expectRefusal(await updateCard(token, card.id, {
      name: 'Новое имя',
      interior_photos: [seeded.photo1, seeded.photo2],
    }));

    expect(await mediaOf(card.id)).toEqual(before);
    expect((await cardRow(card.id)).name).toBe('Test Restaurant');
  });
});

describe('Правка: добавленная чужая ссылка — отказ, ничего не сохраняется', () => {
  let self;
  let token;
  let other;
  let otherCard;
  let card;
  let kept;
  let removed;

  beforeEach(async () => {
    ({ partner: self, token } = await newPartner());
    ({ partner: other } = await newPartner());
    otherCard = await createTestEstablishment(other.id);
    card = await createTestEstablishment(self.id);
    kept = deliveryUrl(`establishments/temp/${self.id}/interior/own0001`);
    removed = deliveryUrl(`establishments/temp/${self.id}/interior/own0002`);
    await insertMedia(card.id, kept, { position: 0 });
    await insertMedia(card.id, removed, { position: 1 });
  });

  test.each([
    ['загрузка другого партнёра', () => deliveryUrl(`establishments/temp/${other.id}/interior/victim0001`)],
    ['фото чужой карточки', () => deliveryUrl(`establishments/${otherCard.id}/interior/victim0002`)],
    ['сторонний сайт', () => 'https://images.example.org/victim0003.jpg'],
    ['своя папка в другом облаке', () =>
      `https://res.cloudinary.com/othercloud/image/upload/v1/establishments/${card.id}/interior/own0003.jpg`],
    ['своя папка по http', () =>
      `http://res.cloudinary.com/test/image/upload/v1/establishments/${card.id}/interior/own0003.jpg`],
    ['папка карточки, тип ресурса raw', () =>
      `https://res.cloudinary.com/test/raw/upload/v1/establishments/${card.id}/interior/own0003.jpg`],
    ['шаг назад из папки карточки к чужой', () =>
      deliveryUrl(`establishments/${card.id}/../${otherCard.id}/interior/victim0004`)],
    ['своё фото с наложением чужого', () =>
      `https://res.cloudinary.com/test/image/upload/l_establishments:temp:${other.id}:interior:victim0009,w_1,h_1,c_fill/f_auto,q_auto/v1/establishments/temp/${self.id}/interior/own0003`],
  ])('фото интерьера: %s — карточка и имя прежние', async (_label, foreign) => {
    const before = await mediaOf(card.id);

    // Запрос убирает одно фото, добавляет чужое и меняет имя: ни одно из трёх не применяется.
    expectRefusal(await updateCard(token, card.id, {
      name: 'Новое имя',
      interior_photos: [kept, foreign()],
    }));

    expect(await mediaOf(card.id)).toEqual(before);
    expect((await cardRow(card.id)).name).toBe('Test Restaurant');
  });

  test.each([
    ['PDF меню чужой карточки', () => uploadedUrl(`establishments/${otherCard.id}/menu_pdf/victim0005`, 'pdf')],
    ['PDF меню из загрузок другого партнёра', () =>
      uploadedUrl(`establishments/temp/${other.id}/menu_pdf/victim0006`, 'pdf')],
    ['фото меню со стороннего сайта', () => 'https://images.example.org/menu.jpg'],
  ])('меню: %s', async (_label, foreign) => {
    const before = await mediaOf(card.id);

    expectRefusal(await updateCard(token, card.id, { menu_photos: [foreign()] }));

    expect(await mediaOf(card.id)).toEqual(before);
  });

  test('PDF из папки другой своей карточки — тоже отказ: своё для правки — эта карточка и свои загрузки', async () => {
    const mySecondCard = await createTestEstablishment(self.id);

    expectRefusal(await updateCard(token, card.id, {
      menu_photos: [uploadedUrl(`establishments/${mySecondCard.id}/menu_pdf/menu0007`, 'pdf')],
    }));
  });

  test('в журнал уходит отказ с карточкой, полем и причиной — без самой ссылки', async () => {
    const warn = jest.spyOn(logger, 'warn');

    expectRefusal(await updateCard(token, card.id, {
      interior_photos: [kept, deliveryUrl(`establishments/temp/${other.id}/interior/victim0008`)],
    }));

    expect(warn.mock.calls.filter(([message]) => message === REFUSAL_LOG)).toEqual([
      [REFUSAL_LOG, {
        partnerId: self.id, establishmentId: card.id, bucket: 'interior', reason: 'outside_own_folders',
      }],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/victim/);
  });
});

describe('Правка: обложку каталога из запроса не записывают', () => {
  test('primary_image_url в теле правки игнорируется, остальное сохраняется', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const warn = jest.spyOn(logger, 'warn');

    await updateCard(token, card.id, {
      name: 'Новое имя',
      primary_image_url: 'https://images.example.org/cover.jpg',
    }).expect(200);

    expect(await cardRow(card.id)).toEqual({ name: 'Новое имя', primary_image_url: null });
    expect(warn).toHaveBeenCalledWith(
      'Partner attempted to set primary_image_url directly — ignored',
      { establishmentId: card.id, partnerId: partner.id },
    );
  });

  test('обложка по-прежнему ставится из фото карточки, а не из присланного адреса', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const own = deliveryUrl(`establishments/temp/${partner.id}/interior/own0001`);

    await updateCard(token, card.id, {
      interior_photos: [own],
      primary_photo: own,
      primary_image_url: 'https://images.example.org/cover.jpg',
    }).expect(200);

    expect((await cardRow(card.id)).primary_image_url).toBe(own);
  });
});
