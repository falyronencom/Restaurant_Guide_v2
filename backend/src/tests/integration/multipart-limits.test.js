/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Лимиты разбора multipart на всех четырёх загрузчиках (внешний обзор
 * 02.10.2026, S1).
 *
 * Загрузчики: аватар (POST /auth/avatar), временные загрузки кабинета и
 * регистрации (POST /partner/media/upload — доступен и роли user), медиа
 * карточки (POST /partner/establishments/:id/media), акции
 * (POST/PATCH /partner/promotions). До правки ни у одного не было лимита на
 * число полей, частей и вложенность имён полей: разбор такого запроса не
 * ограничен ничем, кроме размера файла.
 *
 * Что шлют клиенты (сверено по истории git приложения и по сайту на 06.10.2026):
 * один файл и не больше пяти простых текстовых полей без скобок в имени;
 * контроллер акций читает семь. Лимиты — с запасом над этим: при 10 полях,
 * 20 частях и нулевой вложенности легальный максимум (акция: 7 полей + картинка)
 * проходит — это закреплено последним тестом; граница частей — тестами 20/21.
 *
 * Сетевые вызовы SDK облака подменены: без лимитов запрос дошёл бы до загрузки
 * в облако, и тест падал бы на сети, а не на отсутствии лимита.
 */

import fs from 'fs';
import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';
import { clearAllData } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const JPEG = { filename: 'photo.jpg', contentType: 'image/jpeg' };

let upload;
let seq = 0;

const newAccount = async (role) => {
  seq += 1;
  const { user, accessToken } = await createUserAndGetTokens({
    email: `${role}-limits-${Date.now()}-${seq}@test.com`,
    password: 'User123!@#',
    name: 'Limits',
    role,
  });
  return { user, token: accessToken };
};

// Временный файл, записанный до срабатывания лимита, multer обязан убрать сам:
// до контроллера, который его удаляет, запрос не доходит.
const newEntriesSince = (before) => fs.readdirSync(TEMP_UPLOAD_DIR).filter((name) => !before.has(name));
const waitUntil = async (predicate, timeoutMs = 2000, stepMs = 20) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
};

// Одиннадцать лишних полей: больше лимита (10) при любом наборе полей маршрута —
// у аватара своих текстовых полей нет вовсе.
const withExtraFields = (req) => {
  for (let i = 0; i < 11; i += 1) req.field(`extra${i}`, 'x');
  return req;
};

beforeEach(async () => {
  await clearAllData();
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  upload = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => ({
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

describe('слишком много полей — 400 на каждом загрузчике, до облака запрос не доходит', () => {
  test('временные загрузки (роль user)', async () => {
    const { token } = await newAccount('user');
    const before = new Set(fs.readdirSync(TEMP_UPLOAD_DIR));

    const response = await withExtraFields(request(app)
      .post('/api/v1/partner/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-jpeg'), JPEG)
      .field('type', 'interior'));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Too many fields');
    expect(upload).not.toHaveBeenCalled();
    await waitUntil(() => newEntriesSince(before).length === 0);
    expect(newEntriesSince(before)).toEqual([]);
  });

  test('аватар', async () => {
    const { token } = await newAccount('user');

    const response = await withExtraFields(request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Too many fields');
    expect(upload).not.toHaveBeenCalled();
  });

  test('медиа карточки', async () => {
    const { user, token } = await newAccount('partner');
    const card = await createTestEstablishment(user.id);

    const response = await withExtraFields(request(app)
      .post(`/api/v1/partner/establishments/${card.id}/media`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-jpeg'), JPEG)
      .field('type', 'interior'));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Too many fields');
    expect(upload).not.toHaveBeenCalled();
  });

  test('акции', async () => {
    const { user, token } = await newAccount('partner');
    const card = await createTestEstablishment(user.id);

    const response = await withExtraFields(request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('fake-jpeg'), JPEG)
      .field('establishment_id', card.id)
      .field('title', 'Акция'));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Too many fields');
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('временные загрузки: вложенные имена и «пустые» части', () => {
  test('имя поля со скобками — 400, до облака не доходит', async () => {
    const { token } = await newAccount('user');

    const response = await request(app)
      .post('/api/v1/partner/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('type', 'interior')
      .field('meta[a]', 'x')
      .attach('file', Buffer.from('fake-jpeg'), JPEG);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Field name nesting too deep');
    expect(upload).not.toHaveBeenCalled();
  });

  // Части без Content-Disposition busboy пропускает, не считая ни полем, ни
  // файлом: лимиты fields и files их не видят, их ограничивает только parts —
  // «не больше 20 частей» (multer 2.4.0 передаёт busboy parts + 1). Граница
  // закреплена с обеих сторон: тип, файл и 18 таких частей — 20, проходит;
  // ещё одна — отказ.
  const withBareParts = (bareCount) => {
    const boundary = 'limitsBoundary7f3a';
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninterior\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\n`
        + 'Content-Type: image/jpeg\r\n\r\nfake-jpeg\r\n',
    ];
    for (let i = 0; i < bareCount; i += 1) parts.push(`--${boundary}\r\nContent-Type: text/plain\r\n\r\nx\r\n`);
    parts.push(`--${boundary}--\r\n`);
    return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.from(parts.join('')) };
  };

  test('20 частей вместе с частями без Content-Disposition — проходит', async () => {
    const { token } = await newAccount('user');
    const { contentType, body } = withBareParts(18);

    await request(app)
      .post('/api/v1/partner/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', contentType)
      .send(body)
      .expect(201);

    expect(upload).toHaveBeenCalledTimes(1);
  });

  test('21 часть — 400, до облака не доходит, файл убран', async () => {
    const { token } = await newAccount('user');
    const { contentType, body } = withBareParts(19);
    const before = new Set(fs.readdirSync(TEMP_UPLOAD_DIR));

    const response = await request(app)
      .post('/api/v1/partner/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', contentType)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Too many parts');
    expect(upload).not.toHaveBeenCalled();
    await waitUntil(() => newEntriesSince(before).length === 0);
    expect(newEntriesSince(before)).toEqual([]);
  });
});

describe('легальный максимум проходит', () => {
  test('акция: все семь полей, которые читает контроллер, и картинка — 201', async () => {
    const { user, token } = await newAccount('partner');
    const card = await createTestEstablishment(user.id);
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

    await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('establishment_id', card.id)
      .field('title', 'Акция')
      .field('description', 'Описание')
      .field('terms_and_conditions', 'Условия')
      .field('valid_from', day(0))
      .field('valid_until', day(60))
      .field('position', '0')
      .attach('image', Buffer.from('fake-jpeg'), JPEG)
      .expect(201);

    expect(upload).toHaveBeenCalledTimes(1);
  });
});
