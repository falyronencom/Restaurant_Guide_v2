/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Чужие файлы в облаке не уничтожаются ни одним маршрутом (внешний обзор
 * 02.10.2026, N1).
 *
 * Находка: любой зарегистрированный удалял чужие фото карточек, PDF меню и
 * аватары двумя запросами.
 *  - Путь A: PUT /auth/profile сохранял любой avatar_url, а POST /auth/avatar
 *    после загрузки нового аватара уничтожал «прежний» по public_id из этой
 *    ссылки.
 *  - Путь B: партнёр (им становится любой, создавший черновик) клал чужую
 *    ссылку в медиа своей карточки, затем удалял это медиа — и вместе со
 *    строкой уничтожался чужой файл.
 * Замена картинки акции уничтожает прежнюю тем же способом — третья точка.
 *
 * Здесь работает настоящий config/cloudinary.js: разбор ссылки и проверка
 * «свой ассет» те же, что на проде. Подменены только сетевые вызовы SDK —
 * uploader.upload и uploader.destroy общего экземпляра `cloudinary` v2.
 * media.test.js и promotions.test.js мокают модуль целиком и потому проверку
 * внутри него не видят.
 *
 * Ожидаемые public_id — литералы. Входные ссылки — в форме, которую хранит
 * база: каноническая ссылка доставки без расширения (generateAllResolutions),
 * secure_url загрузки с версией и расширением (аватар, PDF).
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

// Каноническая ссылка доставки, как её строит generateAllResolutions для public_id.
const deliveryUrl = (publicId) =>
  `https://res.cloudinary.com/test/image/upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/${publicId}?_a=BAMAMiRg0`;
// secure_url загрузки: версия и расширение (аватары, PDF меню).
const uploadedUrl = (publicId, ext) =>
  `https://res.cloudinary.com/test/image/upload/v1759600000/${publicId}.${ext}`;

const JPEG = { filename: 'face.jpg', contentType: 'image/jpeg' };

let destroy;

beforeEach(async () => {
  await clearAllData();
  destroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => ({
    public_id: `${options.folder}/fresh0001`,
    secure_url: `https://res.cloudinary.com/test/image/upload/v1759700000/${options.folder}/fresh0001.jpg`,
    width: 256,
    height: 256,
    format: 'jpg',
    bytes: 2048,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Порядковый номер в адресе: два аккаунта, созданные в одну миллисекунду, не
// сталкиваются по email (createPartnerAndGetToken строит его из Date.now()).
let seq = 0;
const newAccount = async (role) => {
  seq += 1;
  const { user, accessToken } = await createUserAndGetTokens({
    email: `${role}-${Date.now()}-${seq}@test.com`,
    password: 'User123!@#',
    name: 'Исходное Имя',
    role,
  });
  return { user, token: accessToken };
};
const newUser = () => newAccount('user');
const newPartner = async () => {
  const { user, token } = await newAccount('partner');
  return { partner: user, token };
};

const setAvatar = (userId, url) => query('UPDATE users SET avatar_url = $1 WHERE id = $2', [url, userId]);
const storedUser = async (userId) =>
  (await query('SELECT name, avatar_url FROM users WHERE id = $1', [userId])).rows[0];

const insertMedia = async (establishmentId, url, { type = 'interior', fileType = 'image' } = {}) => {
  const { rows } = await query(
    `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
     VALUES ($1, $2, $3, $4, $4, $4, 0, false) RETURNING id`,
    [establishmentId, type, fileType, url],
  );
  return rows[0].id;
};

// ============================================================================
// Путь A — аватар
// ============================================================================

describe('Путь A: POST /auth/avatar уничтожает прежний аватар только из своей папки', () => {
  test('прежний аватар в своей папке уничтожается по точному public_id', async () => {
    const { user, token } = await newUser();
    await setAvatar(user.id, uploadedUrl(`avatars/${user.id}/oldface0001`, 'jpg'));

    await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
      .expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(`avatars/${user.id}/oldface0001`);
    expect((await storedUser(user.id)).avatar_url)
      .toBe(`https://res.cloudinary.com/test/image/upload/v1759700000/avatars/${user.id}/fresh0001.jpg`);
  });

  test.each([
    ['фото чужой карточки из папки загрузок партнёра', (other) => deliveryUrl(`establishments/temp/${other.id}/interior/victim0001`)],
    ['PDF меню чужой карточки', (_other, cardId) => uploadedUrl(`establishments/${cardId}/menu_pdf/menu0001`, 'pdf')],
    ['аватар другого пользователя', (other) => uploadedUrl(`avatars/${other.id}/face0001`, 'jpg')],
    ['шаг назад из своей папки к чужому фото', (other, _cardId, self) =>
      uploadedUrl(`avatars/${self.id}/../../establishments/temp/${other.id}/interior/victim0002`, 'jpg')],
    ['ссылка в другое облако', (_other, _cardId, self) =>
      `https://res.cloudinary.com/othercloud/image/upload/v1/avatars/${self.id}/face0002.jpg`],
  ])('ссылка на чужой ассет в прежнем аватаре — файл не уничтожается, аватар заменяется: %s', async (_label, foreignUrl) => {
    const { user, token } = await newUser();
    const { partner: other } = await newPartner();
    const card = await createTestEstablishment(other.id);
    await setAvatar(user.id, foreignUrl(other, card.id, user));

    await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
      .expect(200);

    expect(destroy).not.toHaveBeenCalled();
    expect((await storedUser(user.id)).avatar_url)
      .toBe(`https://res.cloudinary.com/test/image/upload/v1759700000/avatars/${user.id}/fresh0001.jpg`);
  });
});

describe('Путь A: PUT /auth/profile принимает в avatar_url только удаление или ссылку в свою папку', () => {
  test.each([
    ['фото чужой карточки', (other) => deliveryUrl(`establishments/temp/${other.id}/interior/victim0001`)],
    ['аватар другого пользователя', (other) => uploadedUrl(`avatars/${other.id}/face0001`, 'jpg')],
    ['сторонний сайт', () => 'https://images.example.org/face.png'],
    ['своя папка, но другое облако', (_other, self) =>
      `https://res.cloudinary.com/othercloud/image/upload/v1/avatars/${self.id}/face0002.jpg`],
    ['шаг назад из своей папки', (other, self) =>
      uploadedUrl(`avatars/${self.id}/../${other.id}/face0001`, 'jpg')],
    ['не строка', () => 12345],
  ])('чужое значение игнорируется, имя меняется: %s', async (_label, foreignValue) => {
    const { user, token } = await newUser();
    const { partner: other } = await newPartner();
    const ownAvatar = uploadedUrl(`avatars/${user.id}/face0003`, 'jpg');
    await setAvatar(user.id, ownAvatar);

    const response = await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Новое Имя', avatar_url: foreignValue(other, user) })
      .expect(200);

    expect(await storedUser(user.id)).toEqual({ name: 'Новое Имя', avatar_url: ownAvatar });
    expect(response.body.data.user.avatarUrl).toBe(ownAvatar);
  });

  test('запрос только с чужой ссылкой — 200, профиль не меняется', async () => {
    const { user, token } = await newUser();
    const { partner: other } = await newPartner();

    await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: deliveryUrl(`establishments/temp/${other.id}/interior/victim0001`) })
      .expect(200);

    expect(await storedUser(user.id)).toEqual({ name: 'Исходное Имя', avatar_url: null });
  });

  test.each([
    ['другой ассет в своей папке', (self) => uploadedUrl(`avatars/${self.id}/face0004`, 'jpg'),
      (self) => uploadedUrl(`avatars/${self.id}/face0004`, 'jpg')],
    ['null — удалить аватар', () => null, () => null],
    ['пустая строка — удалить аватар', () => '', () => null],
  ])('принимается: %s', async (_label, value, expected) => {
    const { user, token } = await newUser();
    await setAvatar(user.id, uploadedUrl(`avatars/${user.id}/face0003`, 'jpg'));

    await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: value(user) })
      .expect(200);

    expect((await storedUser(user.id)).avatar_url).toBe(expected(user));
  });
});

describe('Путь A целиком: два запроса из находки', () => {
  test('PUT с чужой ссылкой, затем POST /auth/avatar — чужой файл не уничтожается', async () => {
    const { token } = await newUser();
    const { partner: other } = await newPartner();

    await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: deliveryUrl(`establishments/temp/${other.id}/interior/victim0001`) })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
      .expect(200);

    expect(destroy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Путь B — медиа карточки
// ============================================================================

describe('Путь B: DELETE медиа уничтожает файл только из папки карточки или своих загрузок', () => {
  let partner;
  let token;
  let card;
  let otherPartner;
  let otherCard;

  beforeEach(async () => {
    ({ partner, token } = await newPartner());
    card = await createTestEstablishment(partner.id);
    ({ partner: otherPartner } = await newPartner());
    otherCard = await createTestEstablishment(otherPartner.id);
  });

  const deleteMediaRequest = (mediaId) => request(app)
    .delete(`/api/v1/partner/establishments/${card.id}/media/${mediaId}`)
    .set('Authorization', `Bearer ${token}`);

  const mediaRowExists = async (mediaId) =>
    (await query('SELECT 1 FROM establishment_media WHERE id = $1', [mediaId])).rows.length === 1;

  test.each([
    ['фото из своей папки загрузок',
      () => deliveryUrl(`establishments/temp/${partner.id}/interior/ownphoto0001`), {},
      () => `establishments/temp/${partner.id}/interior/ownphoto0001`],
    ['фото в папке карточки',
      () => deliveryUrl(`establishments/${card.id}/interior/cardphoto0001`), {},
      () => `establishments/${card.id}/interior/cardphoto0001`],
    ['PDF меню в папке карточки',
      () => uploadedUrl(`establishments/${card.id}/menu_pdf/menu0001`, 'pdf'), { type: 'menu', fileType: 'pdf' },
      () => `establishments/${card.id}/menu_pdf/menu0001`],
  ])('свой ассет уничтожается по точному public_id: %s', async (_label, url, kind, expectedPublicId) => {
    const mediaId = await insertMedia(card.id, url(), kind);

    await deleteMediaRequest(mediaId).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(expectedPublicId());
    expect(await mediaRowExists(mediaId)).toBe(false);
  });

  test.each([
    ['фото из чужой папки загрузок', () => deliveryUrl(`establishments/temp/${otherPartner.id}/interior/victim0001`), {}],
    ['фото чужой карточки', () => deliveryUrl(`establishments/${otherCard.id}/interior/victim0002`), {}],
    ['PDF меню чужой карточки', () => uploadedUrl(`establishments/${otherCard.id}/menu_pdf/menu0002`, 'pdf'),
      { type: 'menu', fileType: 'pdf' }],
    ['аватар пользователя', () => uploadedUrl(`avatars/${otherPartner.id}/face0001`, 'jpg'), {}],
    ['шаг назад из своей папки загрузок',
      () => deliveryUrl(`establishments/temp/${partner.id}/../${otherPartner.id}/interior/victim0003`), {}],
  ])('строка с чужим ассетом снимается с карточки, файл не уничтожается: %s', async (_label, url, kind) => {
    const mediaId = await insertMedia(card.id, url(), kind);

    await deleteMediaRequest(mediaId).expect(200);

    expect(destroy).not.toHaveBeenCalled();
    expect(await mediaRowExists(mediaId)).toBe(false);
  });

  // Первый шаг пути из находки закрыт и на входе (N3, вторая половина): чужую
  // ссылку в карточку больше не положить. Строки, попавшие в карточку раньше,
  // проверяет тест выше — их удаление чужой файл тоже не трогает.
  test('сквозной путь из находки: чужая ссылка через PUT карточки не сохраняется — удалять нечего', async () => {
    const foreignUrl = deliveryUrl(`establishments/temp/${otherPartner.id}/interior/victim0001`);

    const response = await request(app)
      .put(`/api/v1/partner/establishments/${card.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ interior_photos: [foreignUrl] })
      .expect(422);
    expect(response.body.error.code).toBe('MEDIA_URL_NOT_OWNED');

    const { rows } = await query(
      'SELECT id FROM establishment_media WHERE establishment_id = $1',
      [card.id],
    );
    expect(rows).toHaveLength(0);
    expect(destroy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Акции — третья точка уничтожения
// ============================================================================

describe('Акции: PATCH с новой картинкой уничтожает прежнюю только из папки карточки', () => {
  let partner;
  let token;
  let card;

  beforeEach(async () => {
    ({ partner, token } = await newPartner());
    card = await createTestEstablishment(partner.id);
  });

  const insertPromotion = async (imageUrl) => {
    const { rows } = await query(
      `INSERT INTO promotions (establishment_id, title, image_url, thumbnail_url, preview_url, valid_from, status)
       VALUES ($1, 'Акция', $2, $2, $2, CURRENT_DATE, 'active') RETURNING id`,
      [card.id, imageUrl],
    );
    return rows[0].id;
  };

  const replaceImage = (promotionId) => request(app)
    .patch(`/api/v1/partner/promotions/${promotionId}`)
    .set('Authorization', `Bearer ${token}`)
    .attach('image', Buffer.from('fake-jpeg'), { filename: 'promo.jpg', contentType: 'image/jpeg' });

  test('прежняя картинка в папке карточки уничтожается по точному public_id', async () => {
    const promotionId = await insertPromotion(deliveryUrl(`establishments/${card.id}/promotions/promo0001`));

    await replaceImage(promotionId).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(`establishments/${card.id}/promotions/promo0001`);
  });

  test('прежняя картинка, указывающая на чужой ассет, не уничтожается', async () => {
    const { partner: otherPartner } = await newPartner();
    const promotionId = await insertPromotion(
      deliveryUrl(`establishments/temp/${otherPartner.id}/interior/victim0004`),
    );

    await replaceImage(promotionId).expect(200);

    expect(destroy).not.toHaveBeenCalled();
  });
});
