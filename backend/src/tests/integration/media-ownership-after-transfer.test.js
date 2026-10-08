/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Файлы карточки принадлежат карточке, а не папке загрузившего (пакет 1
 * находок критиков, пункт 0 — Claude-2А A-1 и Codex-2А IL-5, 08.10.2026).
 *
 * Мастер приложения и сайта кладёт фото и PDF меню в личную папку загрузок
 * партнёра (establishments/temp/{id партнёра}/). Передача карточки админом
 * меняет только владельца в базе — файлы остаются в папке прежнего владельца.
 * До правки право уничтожить файл в облаке определялось папкой: прежний
 * владелец, оставшись партнёром, мог вписать ту же ссылку в свою карточку
 * (она в его папке) и удалить её там — файл под переданной карточкой исчезал
 * безвозвратно; новый владелец, напротив, уничтожить эти файлы не мог.
 *
 * Правило теперь: файл уничтожается только владельцем карточки, из папки,
 * которую карточка держит (своя папка, загрузки вызывающего, а у переданной
 * карточки — и папка, где файл лежит), и только если на него больше никто не
 * ссылается — ни строка медиа другой карточки, ни обложка другой карточки,
 * ни картинка акции.
 *
 * Здесь работает настоящий config/cloudinary.js; подменены только сетевые
 * вызовы SDK — uploader.upload и uploader.destroy. Передача — настоящим
 * маршрутом админа. Ожидаемые public_id — литералы.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';

// Каноническая ссылка доставки, как её строит generateAllResolutions.
const deliveryUrl = (publicId) =>
  `https://res.cloudinary.com/test/image/upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/${publicId}?_a=BAMAMiRg0`;
// secure_url загрузки: версия и расширение (PDF меню).
const uploadedUrl = (publicId, ext) =>
  `https://res.cloudinary.com/test/image/upload/v1759600000/${publicId}.${ext}`;
// Превью первой страницы PDF, как их строят generatePdfThumbnailUrl / generatePdfPreviewUrl.
const pdfThumbUrl = (publicId) =>
  `https://res.cloudinary.com/test/image/upload/c_fill,h_300,pg_1,w_400/f_jpg,q_auto/v1/${publicId}.jpg?_a=BAMAMiRg0`;

let destroy;
let adminToken;

beforeEach(async () => {
  await clearAllData();
  ({ accessToken: adminToken } = await createAdminAndGetToken());
  destroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => ({
    public_id: `${options.folder}/fresh0001`,
    secure_url: `https://res.cloudinary.com/test/image/upload/v1759700000/${options.folder}/fresh0001.jpg`,
    width: 800,
    height: 600,
    format: 'jpg',
    bytes: 2048,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

let seq = 0;
const newPartner = async () => {
  seq += 1;
  const { user, accessToken } = await createUserAndGetTokens({
    email: `transfer-${Date.now()}-${seq}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр Передачи',
    role: 'partner',
  });
  return { partner: user, token: accessToken };
};

const insertMedia = async (establishmentId, url, { type = 'interior', fileType = 'image' } = {}) => {
  const thumb = fileType === 'pdf' ? pdfThumbUrl(url.replace(/^.*\/v\d+\//, '').replace(/\.pdf$/, '')) : url;
  const { rows } = await query(
    `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
     VALUES ($1, $2, $3, $4, $5, $5, 0, false) RETURNING id`,
    [establishmentId, type, fileType, url, thumb],
  );
  return rows[0].id;
};

const mediaUrlsOf = async (establishmentId) => (await query(
  'SELECT url FROM establishment_media WHERE establishment_id = $1 ORDER BY position',
  [establishmentId],
)).rows.map((row) => row.url);

const transfer = (cardId, toUserId) => request(app)
  .post(`/api/v1/admin/establishments/${cardId}/claim`)
  .set('Authorization', `Bearer ${adminToken}`)
  .send({ user_id: toUserId })
  .expect(200);

const deleteMedia = (token, cardId, mediaId) => request(app)
  .delete(`/api/v1/partner/establishments/${cardId}/media/${mediaId}`)
  .set('Authorization', `Bearer ${token}`);

const updateCard = (token, cardId, updates) => request(app)
  .put(`/api/v1/partner/establishments/${cardId}`)
  .set('Authorization', `Bearer ${token}`)
  .send(updates);

// ============================================================================
// (в) До передачи — как прежде
// ============================================================================

describe('до передачи владелец уничтожает свою загрузку из своей карточки', () => {
  test('фото из папки загрузок владельца уничтожается по точному public_id', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const publicId = `establishments/temp/${partner.id}/interior/photo0001`;
    const mediaId = await insertMedia(card.id, deliveryUrl(publicId));

    await deleteMedia(token, card.id, mediaId).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(publicId);
    expect(await mediaUrlsOf(card.id)).toEqual([]);
  });
});

// ============================================================================
// (а) После передачи прежний владелец теряет власть над файлами карточки
// ============================================================================

describe('после передачи прежний владелец не уничтожает файлы переданной карточки', () => {
  test('та же ссылка в своей карточке: строка снимается, файл цел, переданная карточка цела', async () => {
    const { partner: previous, token: previousToken } = await newPartner();
    const { partner: next } = await newPartner();
    const transferred = await createTestEstablishment(previous.id);
    const publicId = `establishments/temp/${previous.id}/interior/photo0002`;
    const photo = deliveryUrl(publicId);
    await insertMedia(transferred.id, photo);

    await transfer(transferred.id, next.id);

    // Ссылка лежит в папке загрузок прежнего владельца — входные ворота его
    // карточки её принимают. Это и есть путь находки.
    const own = await createTestEstablishment(previous.id);
    await updateCard(previousToken, own.id, { interior_photos: [photo] }).expect(200);
    const { rows: [ownRow] } = await query(
      'SELECT id FROM establishment_media WHERE establishment_id = $1',
      [own.id],
    );

    await deleteMedia(previousToken, own.id, ownRow.id).expect(200);

    expect(destroy).not.toHaveBeenCalled();
    expect(await mediaUrlsOf(own.id)).toEqual([]);
    expect(await mediaUrlsOf(transferred.id)).toEqual([photo]);
  });

  test('переданная карточка больше не его: удаление её медиа отвергается', async () => {
    const { partner: previous, token: previousToken } = await newPartner();
    const { partner: next } = await newPartner();
    const transferred = await createTestEstablishment(previous.id);
    const photo = deliveryUrl(`establishments/temp/${previous.id}/interior/photo0003`);
    const mediaId = await insertMedia(transferred.id, photo);

    await transfer(transferred.id, next.id);

    const response = await deleteMedia(previousToken, transferred.id, mediaId).expect(404);

    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    expect(destroy).not.toHaveBeenCalled();
    expect(await mediaUrlsOf(transferred.id)).toEqual([photo]);
  });
});

// ============================================================================
// (б) Новый владелец управляет файлами как своими
// ============================================================================

describe('после передачи новый владелец уничтожает и заменяет файлы карточки', () => {
  test.each([
    ['фото из папки загрузок прежнего владельца',
      (previousId) => `establishments/temp/${previousId}/interior/photo0004`,
      (publicId) => deliveryUrl(publicId), {}],
    ['PDF меню из папки загрузок прежнего владельца',
      (previousId) => `establishments/temp/${previousId}/menu_pdf/menu0001`,
      (publicId) => uploadedUrl(publicId, 'pdf'), { type: 'menu', fileType: 'pdf' }],
  ])('уничтожается по точному public_id: %s', async (_label, publicIdOf, urlOf, kind) => {
    const { partner: previous } = await newPartner();
    const { partner: next, token: nextToken } = await newPartner();
    const transferred = await createTestEstablishment(previous.id);
    const publicId = publicIdOf(previous.id);
    const mediaId = await insertMedia(transferred.id, urlOf(publicId), kind);

    await transfer(transferred.id, next.id);

    await deleteMedia(nextToken, transferred.id, mediaId).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(publicId);
    expect(await mediaUrlsOf(transferred.id)).toEqual([]);
  });

  test('замена: новое фото ложится в папку карточки, прежнее уничтожается', async () => {
    const { partner: previous } = await newPartner();
    const { partner: next, token: nextToken } = await newPartner();
    const transferred = await createTestEstablishment(previous.id);
    const oldPublicId = `establishments/temp/${previous.id}/interior/photo0005`;
    const oldMediaId = await insertMedia(transferred.id, deliveryUrl(oldPublicId));

    await transfer(transferred.id, next.id);

    const uploaded = await request(app)
      .post(`/api/v1/partner/establishments/${transferred.id}/media`)
      .set('Authorization', `Bearer ${nextToken}`)
      .field('type', 'interior')
      .attach('file', Buffer.from('fake-jpeg'), { filename: 'new.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(uploaded.body.data.url).toContain(`establishments/${transferred.id}/interior/fresh0001`);

    await deleteMedia(nextToken, transferred.id, oldMediaId).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(oldPublicId);
    expect(await mediaUrlsOf(transferred.id)).toEqual([uploaded.body.data.url]);
  });
});

// ============================================================================
// Границы правила
// ============================================================================

describe('границы: папка чужих загрузок открывается только передачей, файл держат чужие ссылки', () => {
  test('карточку не передавали: ссылка в чужую папку загрузок снимается, файл не трогается', async () => {
    const { partner, token } = await newPartner();
    const { partner: stranger } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const mediaId = await insertMedia(card.id, deliveryUrl(`establishments/temp/${stranger.id}/interior/victim0001`));

    await deleteMedia(token, card.id, mediaId).expect(200);

    expect(destroy).not.toHaveBeenCalled();
    expect(await mediaUrlsOf(card.id)).toEqual([]);
  });

  test.each([
    ['строкой медиа другой карточки', async (otherCard, url) => { await insertMedia(otherCard.id, url); }],
    ['обложкой другой карточки', async (otherCard, url) => {
      await query('UPDATE establishments SET primary_image_url = $1 WHERE id = $2', [url, otherCard.id]);
    }],
    ['картинкой акции', async (otherCard, url) => {
      await query(
        `INSERT INTO promotions (establishment_id, title, image_url, thumbnail_url, preview_url, valid_from, status)
         VALUES ($1, 'Акция', $2, $2, $2, CURRENT_DATE, 'active')`,
        [otherCard.id, url],
      );
    }],
  ])('своя загрузка, на которую ссылаются ещё %s: строка снимается, файл цел', async (_label, holdElsewhere) => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const otherCard = await createTestEstablishment(partner.id);
    const url = deliveryUrl(`establishments/temp/${partner.id}/interior/shared0001`);
    const mediaId = await insertMedia(card.id, url);
    await holdElsewhere(otherCard, url);

    await deleteMedia(token, card.id, mediaId).expect(200);

    expect(destroy).not.toHaveBeenCalled();
    expect(await mediaUrlsOf(card.id)).toEqual([]);
  });

  test('обложка своей карточки держит файл, если строка уже не главное фото', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const url = deliveryUrl(`establishments/temp/${partner.id}/interior/cover0001`);
    const mediaId = await insertMedia(card.id, url);
    await query('UPDATE establishments SET primary_image_url = $1 WHERE id = $2', [url, card.id]);
    // Флаг снят через PUT is_primary:false — обложка при этом не сбрасывается.
    await request(app)
      .put(`/api/v1/partner/establishments/${card.id}/media/${mediaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_primary: false })
      .expect(200);

    await deleteMedia(token, card.id, mediaId).expect(200);

    expect(destroy).not.toHaveBeenCalled();
    expect(await mediaUrlsOf(card.id)).toEqual([]);
  });

  test('главное фото: своя обложка не держит файл — она сбрасывается вместе со строкой', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const publicId = `establishments/temp/${partner.id}/interior/cover0002`;
    const url = deliveryUrl(publicId);
    const { rows: [{ id: mediaId }] } = await query(
      `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
       VALUES ($1, 'interior', 'image', $2, $2, $2, 0, true) RETURNING id`,
      [card.id, url],
    );
    await query('UPDATE establishments SET primary_image_url = $1 WHERE id = $2', [url, card.id]);

    await deleteMedia(token, card.id, mediaId).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(publicId);
    const { rows: [{ primary_image_url: cover }] } = await query(
      'SELECT primary_image_url FROM establishments WHERE id = $1', [card.id],
    );
    expect(cover).toBeNull();
  });

  test('последняя ссылка уничтожает файл: одно фото в двух карточках одного владельца', async () => {
    const { partner, token } = await newPartner();
    const first = await createTestEstablishment(partner.id);
    const second = await createTestEstablishment(partner.id);
    const publicId = `establishments/temp/${partner.id}/interior/shared0002`;
    const firstMediaId = await insertMedia(first.id, deliveryUrl(publicId));
    const secondMediaId = await insertMedia(second.id, deliveryUrl(publicId));

    await deleteMedia(token, first.id, firstMediaId).expect(200);
    expect(destroy).not.toHaveBeenCalled();
    expect(await mediaUrlsOf(second.id)).toEqual([deliveryUrl(publicId)]);

    await deleteMedia(token, second.id, secondMediaId).expect(200);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(publicId);
  });

  test('похожий public_id с тем же началом не держит файл', async () => {
    const { partner, token } = await newPartner();
    const card = await createTestEstablishment(partner.id);
    const otherCard = await createTestEstablishment(partner.id);
    const publicId = `establishments/temp/${partner.id}/interior/photo01`;
    const mediaId = await insertMedia(card.id, deliveryUrl(publicId));
    await insertMedia(otherCard.id, deliveryUrl(`${publicId}0`));

    await deleteMedia(token, card.id, mediaId).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(publicId);
  });
});
