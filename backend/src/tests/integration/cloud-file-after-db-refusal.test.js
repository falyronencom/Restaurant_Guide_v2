/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Файл в облаке не остаётся без записи, когда база отказала после загрузки
 * (бриф «500 вместо отказа», п. 9; решение Координатора 17.10.2026 по §3 п. 3
 * брифа — удалять только что загруженный файл).
 *
 * До правки картинка акции (создание и правка) и медиа карточки (фото и PDF
 * меню) уходили в облако раньше записи в базу и при отказе базы оставались
 * там: партнёр видел ошибку, а файл, на который не ссылается ни одна строка,
 * лежал в платном облаке. Теперь удаляется ровно файл, загруженный этим
 * запросом, — не прежняя картинка акции и не файл, на который строка уже
 * записана, — а ответ тот же, что был до правки.
 *
 * Отказ базы — её собственный ответ на запрос: тогда строки нет наверняка.
 * Оборванная связь — не отказ: сервер мог записать строку и потерять только
 * ответ, и файл остаётся, а журнал называет его (ревью Phase 3.5 18.10.2026).
 *
 * С 19.10.2026 то же правило — у аватара (находка Н3, тот же PR сессии Б).
 *
 * Облако — настоящий config/cloudinary.js; подменены только сетевые вызовы
 * SDK: uploader.upload отвечает public_id в папке, которую назвал сервис,
 * uploader.destroy записывается. Так проверяется и папка, которую сервис
 * называет своей: deleteImage удаляет только внутри неё. База — настоящая:
 * отказ — ответ сервера на подменённый запрос, обрыв — ошибка pg без ответа
 * сервера, до или после того, как запрос выполнен.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { ownedFolders } from '../../config/cloudinary.js';
import { discardUnrecordedUpload } from '../../services/unrecordedUpload.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const SERVER_FAILURE = 'Сбой на сервере. Попробуйте ещё раз через минуту.';
const NOT_FOUND = 'Акция не найдена — возможно, её уже удалили. Обновите список акций.';
const JPEG = { filename: 'photo.jpg', contentType: 'image/jpeg' };
const PDF = { filename: 'menu.pdf', contentType: 'application/pdf' };
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake\n');

// Каноническая ссылка доставки, как её строит generateAllResolutions для public_id.
const deliveryUrl = (publicId) =>
  `https://res.cloudinary.com/test/image/upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/${publicId}?_a=BAMAMiRg0`;

/** Ошибка, которой pg отвечает на оборванное соединение: ответа сервера нет. */
const connectionLost = () => new Error('Connection terminated unexpectedly');

/** Запрос, который сервер базы отвергает сам (22012, деление на ноль). */
const REFUSED_SQL = 'SELECT 1/0';

/** Запрос, который отвергает внешний ключ (23503): карточки с таким id нет. */
const FOREIGN_KEY_REFUSED_SQL =
  "INSERT INTO promotions (establishment_id, title) VALUES ('00000000-0000-0000-0000-000000000000', 'x')";

let destroy;
/** public_id каждого файла, который «облако» приняло в этом тесте, по порядку. */
let uploaded;

beforeEach(async () => {
  await clearAllData();
  uploaded = [];
  destroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => {
    const publicId = `${options.folder}/fresh${String(uploaded.length + 1).padStart(4, '0')}`;
    uploaded.push(publicId);
    return {
      public_id: publicId,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1759700000/${publicId}.jpg`,
      width: 640,
      height: 480,
      format: 'jpg',
      bytes: 2048,
      pages: 1,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

const statementSpy = (pattern, onMatch) => {
  const original = pool.query.bind(pool);
  return jest.spyOn(pool, 'query').mockImplementation((text, ...rest) => (
    typeof text === 'string' && pattern.test(text) ? onMatch(original, text, rest) : original(text, ...rest)
  ));
};

/**
 * База отвечает отказом на запрос, совпавший с `pattern`: вместо него идёт
 * `refusingSql`, и отказ — настоящий ответ сервера (DatabaseError).
 */
const refuseStatement = (pattern, refusingSql = REFUSED_SQL) =>
  statementSpy(pattern, (original) => original(refusingSql));

/**
 * Связь с базой обрывается на запросе, совпавшем с `pattern`: после того как
 * сервер его выполнил (`committed`: строка записана, потерян только ответ)
 * или до.
 */
const loseConnectionOn = (pattern, { committed }) =>
  statementSpy(pattern, async (original, text, rest) => {
    if (committed) await original(text, ...rest);
    throw connectionLost();
  });

/** Записи журнала с этим public_id: [сообщение, …]. */
const warnedAbout = (warn, publicId) =>
  warn.mock.calls.filter(([, context]) => context?.publicId === publicId).map(([message]) => message);

let seq = 0;
const newPartner = async () => {
  seq += 1;
  const { user, accessToken } = await createUserAndGetTokens({
    email: `cloud-rollback-${Date.now()}-${seq}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр',
    role: 'partner',
  });
  return { partner: user, token: accessToken, card: await createTestEstablishment(user.id) };
};

describe('картинка акции', () => {
  const createWithImage = (token, cardId) => request(app)
    .post('/api/v1/partner/promotions')
    .set('Authorization', `Bearer ${token}`)
    .field('establishment_id', cardId)
    .field('title', 'Акция с картинкой')
    .attach('image', Buffer.from('fake-jpeg'), JPEG);

  const replaceImage = (token, promotionId) => request(app)
    .patch(`/api/v1/partner/promotions/${promotionId}`)
    .set('Authorization', `Bearer ${token}`)
    .field('title', 'Новое название')
    .attach('image', Buffer.from('fake-jpeg'), JPEG);

  const insertPromotion = async (cardId, imageUrl) => {
    const { rows } = await query(
      `INSERT INTO promotions (establishment_id, title, image_url, thumbnail_url, preview_url, valid_from, status)
       VALUES ($1, 'Прежнее название', $2, $2, $2, CURRENT_DATE, 'active') RETURNING id`,
      [cardId, imageUrl],
    );
    return rows[0].id;
  };

  const promotionsOf = async (cardId) => (
    await query('SELECT image_url FROM promotions WHERE establishment_id = $1', [cardId])).rows;

  const rowOf = async (promotionId) => (
    await query('SELECT title, image_url FROM promotions WHERE id = $1', [promotionId])).rows[0];

  test('создание: база отказала после загрузки — файл удалён, ответ прежний (500)', async () => {
    const { token, card } = await newPartner();
    refuseStatement(/INSERT INTO promotions/);

    const res = await createWithImage(token, card.id);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe(SERVER_FAILURE);
    expect(uploaded).toEqual([`establishments/${card.id}/promotions/fresh0001`]);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/promotions/fresh0001`]]);
    expect(await promotionsOf(card.id)).toEqual([]);
  });

  test('создание: отказ по внешнему ключу — файл удалён, ответ прежний (400)', async () => {
    const { token, card } = await newPartner();
    refuseStatement(/INSERT INTO promotions/, FOREIGN_KEY_REFUSED_SQL);

    const res = await createWithImage(token, card.id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REFERENCE');
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/promotions/fresh0001`]]);
  });

  test('создание: связь оборвалась после записи — файл цел, строка на него ссылается, журнал его называет', async () => {
    const { token, card } = await newPartner();
    loseConnectionOn(/INSERT INTO promotions/, { committed: true });
    const warn = jest.spyOn(logger, 'warn');

    const res = await createWithImage(token, card.id);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe(SERVER_FAILURE);
    expect(destroy).not.toHaveBeenCalled();
    const rows = await promotionsOf(card.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].image_url).toContain(`establishments/${card.id}/promotions/fresh0001`);
    expect(warnedAbout(warn, `establishments/${card.id}/promotions/fresh0001`))
      .toEqual(['Uploaded file kept: the database may have recorded it']);
  });

  // Обрыв до записи от обрыва после записи по ошибке не отличить: файл
  // остаётся и тут — лишний файл дешевле картинки, которой нет у строки.
  test('создание: связь оборвалась до записи — файл тоже цел и назван в журнале', async () => {
    const { token, card } = await newPartner();
    loseConnectionOn(/INSERT INTO promotions/, { committed: false });
    const warn = jest.spyOn(logger, 'warn');

    const res = await createWithImage(token, card.id);

    expect(res.status).toBe(500);
    expect(destroy).not.toHaveBeenCalled();
    expect(await promotionsOf(card.id)).toEqual([]);
    expect(warnedAbout(warn, `establishments/${card.id}/promotions/fresh0001`))
      .toEqual(['Uploaded file kept: the database may have recorded it']);
  });

  // Ответ сервера уровня FATAL — сервер обрывает сеанс; строка могла быть
  // записана до того. Не отказ запроса: файл остаётся, как при обрыве.
  test('создание: сервер оборвал сеанс (FATAL) — файл цел и назван в журнале', async () => {
    const { token, card } = await newPartner();
    refuseStatement(/INSERT INTO promotions/, 'SELECT pg_terminate_backend(pg_backend_pid())');
    const warn = jest.spyOn(logger, 'warn');

    const res = await createWithImage(token, card.id);

    expect(res.status).toBe(500);
    expect(destroy).not.toHaveBeenCalled();
    expect(warnedAbout(warn, `establishments/${card.id}/promotions/fresh0001`))
      .toEqual(['Uploaded file kept: the database may have recorded it']);
  });

  test('правка: база отказала после загрузки новой — удалена новая, прежняя цела и в акции', async () => {
    const { token, card } = await newPartner();
    const oldUrl = deliveryUrl(`establishments/${card.id}/promotions/old0001`);
    const promotionId = await insertPromotion(card.id, oldUrl);
    refuseStatement(/UPDATE promotions\s+SET/);

    const res = await replaceImage(token, promotionId);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe(SERVER_FAILURE);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/promotions/fresh0001`]]);
    expect(await rowOf(promotionId)).toEqual({ title: 'Прежнее название', image_url: oldUrl });
  });

  test('правка: связь оборвалась после записи — новая картинка цела и в акции, прежнюю не трогают', async () => {
    const { token, card } = await newPartner();
    const promotionId = await insertPromotion(card.id, deliveryUrl(`establishments/${card.id}/promotions/old0002`));
    loseConnectionOn(/UPDATE promotions\s+SET/, { committed: true });

    const res = await replaceImage(token, promotionId);

    expect(res.status).toBe(500);
    expect(destroy).not.toHaveBeenCalled();
    const row = await rowOf(promotionId);
    expect(row.title).toBe('Новое название');
    expect(row.image_url).toContain(`establishments/${card.id}/promotions/fresh0001`);
  });

  // Акция уходит вместе с карточкой (ON DELETE CASCADE): между чтением акции
  // и записью карточку удалили. До правки — 200 без данных, новая картинка
  // оставалась в облаке без строки.
  test('правка: акцию удалили между чтением и записью — «не найдена», новая картинка удалена', async () => {
    const { token, card } = await newPartner();
    const promotionId = await insertPromotion(card.id, deliveryUrl(`establishments/${card.id}/promotions/old0003`));
    statementSpy(/UPDATE promotions\s+SET/, async (original, text, rest) => {
      await original('DELETE FROM promotions WHERE id = $1', [promotionId]);
      return original(text, ...rest);
    });

    const res = await replaceImage(token, promotionId);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROMOTION_NOT_FOUND');
    expect(res.body.message).toBe(NOT_FOUND);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/promotions/fresh0001`]]);
  });

  test('облако не удалило файл — ответ по-прежнему от базы, файл назван в журнале', async () => {
    const { token, card } = await newPartner();
    // Отказ с кодом: ответ на него (400) отличается от ответа на сбой облака
    // (500), так что подмена ошибки базы ошибкой удаления видна по ответу.
    refuseStatement(/INSERT INTO promotions/, FOREIGN_KEY_REFUSED_SQL);
    destroy.mockRejectedValue(new Error('cloud is down'));
    const warn = jest.spyOn(logger, 'warn');

    const res = await createWithImage(token, card.id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REFERENCE');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(warnedAbout(warn, `establishments/${card.id}/promotions/fresh0001`))
      .toEqual(['Failed to delete an uploaded file the database did not record']);
  });

  // id карточки прописными база принимает, а папку с прописными deleteImage
  // своей не признаёт: до 19.10.2026 картинка оставалась в облаке. Теперь
  // акция берёт только канонический id — отказ до облака (находка Н6, сессия
  // Б); отказанное удаление в журнале держит тест медиа карточки ниже.
  test('id карточки прописными: отказ до облака — в облако ничего не ушло', async () => {
    const { token, card } = await newPartner();

    const res = await createWithImage(token, card.id.toUpperCase());

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Не выбрано заведение.');
    expect(uploaded).toEqual([]);
    expect(await promotionsOf(card.id)).toEqual([]);
  });

  test('без отказа базы: при создании ничего не удаляется', async () => {
    const { token, card } = await newPartner();

    const res = await createWithImage(token, card.id);

    expect(res.status).toBe(201);
    expect(uploaded).toHaveLength(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  test('без отказа базы: при правке удаляется только прежняя картинка', async () => {
    const { token, card } = await newPartner();
    const promotionId = await insertPromotion(card.id, deliveryUrl(`establishments/${card.id}/promotions/old0004`));

    const res = await replaceImage(token, promotionId);

    expect(res.status).toBe(200);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/promotions/old0004`]]);
  });
});

describe('медиа карточки', () => {
  const uploadMedia = (token, cardId, { type = 'interior', file = JPEG, bytes = Buffer.from('fake-jpeg'), isPrimary } = {}) => {
    const req = request(app)
      .post(`/api/v1/partner/establishments/${cardId}/media`)
      .set('Authorization', `Bearer ${token}`)
      .field('type', type);
    if (isPrimary !== undefined) req.field('is_primary', String(isPrimary));
    return req.attach('file', bytes, file);
  };

  const mediaOf = async (cardId) => (
    await query('SELECT url FROM establishment_media WHERE establishment_id = $1', [cardId])).rows;

  // Ответ на сбой загрузки медиа до правки: 500, код MEDIA_UPLOAD_FAILED,
  // общая фраза вместо английского «Failed to upload media».
  const expectUploadFailed = (res) => {
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('MEDIA_UPLOAD_FAILED');
    expect(res.body.message).toBe(SERVER_FAILURE);
  };

  const NEXT_POSITION = /COALESCE\(MAX\(position\), -1\) \+ 1/;

  // До 20.10.2026 маршрут медиа карточки принимал id прописными (isUUID), и
  // файл ложился в папку с прописными, которую deleteImage своей не признаёт:
  // удаление после отказа базы отказывалось, файл оставался. Теперь — только
  // канонический id, отказ до облака (находка Н9, сессия Г).
  test('id карточки прописными: отказ до облака — в облако ничего не ушло', async () => {
    const { token, card } = await newPartner();
    refuseStatement(/INSERT INTO establishment_media/);

    const res = await uploadMedia(token, card.id.toUpperCase());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    expect(uploaded).toEqual([]);
    expect(await mediaOf(card.id)).toEqual([]);
  });

  // Ни один загрузчик теперь не кладёт файл в чужую папку, но правило
  // удаления держит и такой файл: удаление отказано — файл остаётся, журнал
  // его называет (прежняя проверка через маршрут, теперь — прямо).
  test('файл вне папок карточки: удаление отказано — файл назван в журнале', async () => {
    const { card } = await newPartner();
    const outside = `establishments/${card.id.toUpperCase()}/interior/fresh0001`;
    const warn = jest.spyOn(logger, 'warn');

    await discardUnrecordedUpload(outside, [ownedFolders.establishment(card.id)], null);

    expect(destroy).not.toHaveBeenCalled();
    expect(warnedAbout(warn, outside))
      .toEqual(['Uploaded file the database did not record is left in the cloud']);
  });

  test('фото: база отказала на записи строки — файл удалён, ответ прежний', async () => {
    const { token, card } = await newPartner();
    refuseStatement(/INSERT INTO establishment_media/);

    const res = await uploadMedia(token, card.id);

    expectUploadFailed(res);
    expect(uploaded).toEqual([`establishments/${card.id}/interior/fresh0001`]);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/interior/fresh0001`]]);
    expect(await mediaOf(card.id)).toEqual([]);
  });

  // Номер позиции — чтение: строка ещё не отправлена, и файл удаляется при
  // любом сбое, обрыв связи тоже.
  test('фото: связь оборвалась на чтении номера позиции — файл удалён, ответ прежний', async () => {
    const { token, card } = await newPartner();
    loseConnectionOn(NEXT_POSITION, { committed: false });

    const res = await uploadMedia(token, card.id);

    expectUploadFailed(res);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/interior/fresh0001`]]);
    expect(await mediaOf(card.id)).toEqual([]);
  });

  test('фото: связь оборвалась после записи строки — файл цел, строка на него ссылается', async () => {
    const { token, card } = await newPartner();
    loseConnectionOn(/INSERT INTO establishment_media/, { committed: true });
    const warn = jest.spyOn(logger, 'warn');

    const res = await uploadMedia(token, card.id);

    expectUploadFailed(res);
    expect(destroy).not.toHaveBeenCalled();
    const media = await mediaOf(card.id);
    expect(media).toHaveLength(1);
    expect(media[0].url).toContain(`establishments/${card.id}/interior/fresh0001`);
    expect(warnedAbout(warn, `establishments/${card.id}/interior/fresh0001`))
      .toEqual(['Uploaded file kept: the database may have recorded it']);
  });

  test('PDF меню: база отказала на записи строки — файл удалён, ответ прежний', async () => {
    const { token, card } = await newPartner();
    refuseStatement(/INSERT INTO establishment_media/);

    const res = await uploadMedia(token, card.id, { type: 'menu', file: PDF, bytes: PDF_BYTES });

    expectUploadFailed(res);
    expect(uploaded).toEqual([`establishments/${card.id}/menu_pdf/fresh0001`]);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/menu_pdf/fresh0001`]]);
    expect(await mediaOf(card.id)).toEqual([]);
  });

  test('PDF меню: связь оборвалась на чтении номера позиции — файл удалён', async () => {
    const { token, card } = await newPartner();
    loseConnectionOn(NEXT_POSITION, { committed: false });

    const res = await uploadMedia(token, card.id, { type: 'menu', file: PDF, bytes: PDF_BYTES });

    expectUploadFailed(res);
    expect(destroy.mock.calls).toEqual([[`establishments/${card.id}/menu_pdf/fresh0001`]]);
  });

  test('фото главным: строка записана, отказ позже — файл не трогается, на него ссылается строка', async () => {
    const { token, card } = await newPartner();
    // setPrimaryPhoto берёт соединение из пула сам (транзакция); запросы
    // pool.query берут его через тот же connect, но с колбэком.
    const connect = pool.connect.bind(pool);
    jest.spyOn(pool, 'connect').mockImplementation((...args) => (
      args.length === 0 ? Promise.reject(connectionLost()) : connect(...args)
    ));

    const res = await uploadMedia(token, card.id, { isPrimary: true });

    expectUploadFailed(res);
    expect(destroy).not.toHaveBeenCalled();
    const media = await mediaOf(card.id);
    expect(media).toHaveLength(1);
    expect(media[0].url).toContain(`establishments/${card.id}/interior/fresh0001`);
  });
});

// Аватар (находка Н3 ревью PR #86; слово Координатора 19.10.2026 — тем же
// правилом): новый файл уходит в облако раньше записи avatar_url. До правки
// при сбое записи он оставался в avatars/<id> без ссылки.
describe('аватар', () => {
  const AVATAR_UPDATE = /UPDATE users\s+SET[\s\S]*avatar_url/;

  const newUser = async () => {
    seq += 1;
    return createUserAndGetTokens({
      email: `cloud-rollback-avatar-${Date.now()}-${seq}@test.com`,
      password: 'User123!@#',
      name: 'Гость',
      role: 'user',
    });
  };

  const uploadAvatar = (token) => request(app)
    .post('/api/v1/auth/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', Buffer.from('fake-jpeg'), JPEG);

  const avatarOf = async (userId) => (
    await query('SELECT avatar_url FROM users WHERE id = $1', [userId])).rows[0].avatar_url;

  test('база отказала после загрузки — файл удалён, ответ прежний (500)', async () => {
    const { user, accessToken } = await newUser();
    refuseStatement(AVATAR_UPDATE);

    const res = await uploadAvatar(accessToken);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe(SERVER_FAILURE);
    expect(uploaded).toEqual([`avatars/${user.id}/fresh0001`]);
    expect(destroy.mock.calls).toEqual([[`avatars/${user.id}/fresh0001`]]);
    expect(await avatarOf(user.id)).toBeNull();
  });

  // Прежний аватар удаляется только после успешной записи (ревью по линзе,
  // круг 2): откат нового его не трогает, учётка остаётся с ним.
  test('база отказала — прежний аватар цел и остаётся у учётки, удалён только новый', async () => {
    const { user, accessToken } = await newUser();
    const oldUrl = deliveryUrl(`avatars/${user.id}/old0007`);
    await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [oldUrl, user.id]);
    refuseStatement(AVATAR_UPDATE);

    const res = await uploadAvatar(accessToken);

    expect(res.status).toBe(500);
    expect(destroy.mock.calls).toEqual([[`avatars/${user.id}/fresh0001`]]);
    expect(await avatarOf(user.id)).toBe(oldUrl);
  });

  test('запись не нашла учётку (её отключили в это время) — файл удалён', async () => {
    const { user, accessToken } = await newUser();
    statementSpy(AVATAR_UPDATE, async () => ({ rows: [], rowCount: 0 }));

    const res = await uploadAvatar(accessToken);

    expect(res.status).toBe(500);
    expect(destroy.mock.calls).toEqual([[`avatars/${user.id}/fresh0001`]]);
  });

  test('связь оборвалась после записи — файл цел, учётка на него ссылается, журнал его называет', async () => {
    const { user, accessToken } = await newUser();
    loseConnectionOn(AVATAR_UPDATE, { committed: true });
    const warn = jest.spyOn(logger, 'warn');

    const res = await uploadAvatar(accessToken);

    expect(res.status).toBe(500);
    expect(destroy).not.toHaveBeenCalled();
    expect(await avatarOf(user.id)).toContain(`avatars/${user.id}/fresh0001`);
    expect(warnedAbout(warn, `avatars/${user.id}/fresh0001`))
      .toEqual(['Uploaded file kept: the database may have recorded it']);
  });

  test('запись прошла — ничего не удаляется', async () => {
    const { user, accessToken } = await newUser();

    const res = await uploadAvatar(accessToken);

    expect(res.status).toBe(200);
    expect(destroy).not.toHaveBeenCalled();
    expect(await avatarOf(user.id)).toContain(`avatars/${user.id}/fresh0001`);
  });
});
