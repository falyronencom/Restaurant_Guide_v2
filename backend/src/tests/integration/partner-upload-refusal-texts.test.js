/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказы загрузки фото и PDF в мастере карточки — по-русски (решение
 * Координатора 13.10.2026, вариант В).
 *
 * POST /api/v1/partner/media/upload — единственное место вне самой карточки,
 * где приложение уже сейчас, во всех установленных сборках, показывает партнёру
 * текст сервера: «Ошибка при загрузке фото: Exception: <текст>». До правки текст
 * был английским, а при сбое облака наружу уходил внутренний текст ошибки
 * («Failed to upload image: <ответ облака>»).
 *
 * Ожидания — литералы утверждённых формулировок, не ссылки на модуль текстов:
 * тест должен краснеть, если текст в модуле поменяли без слова Координатора.
 * Коды отказов проверяются тоже — их не меняли, на них держатся клиенты.
 *
 * Запрос собирается так, как его шлёт приложение (media_service.dart): поле
 * `file` с именем файла, тип содержимого — по расширению имени, поле `type`.
 * Сетевые вызовы облака подменены.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

const URL = '/api/v1/partner/media/upload';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake\n');

let token;
let cloudUpload;

beforeAll(async () => {
  await clearAllData();
  const { accessToken } = await createUserAndGetTokens({
    email: `upload-texts-${Date.now()}@test.com`,
    password: 'Partner123!@#',
    name: 'Upload Texts',
    role: 'partner',
  });
  token = accessToken;
});

beforeEach(() => {
  cloudUpload = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => ({
    public_id: `${options.folder}/fresh0001`,
    secure_url: `https://res.cloudinary.com/test/image/upload/v1759700000/${options.folder}/fresh0001.jpg`,
    width: 800,
    height: 600,
    format: 'jpg',
    bytes: 2048,
    pages: 1,
  }));
});

afterEach(() => {
  cloudUpload.mockRestore();
});

afterAll(async () => {
  await clearAllData();
});

const post = () => request(app).post(URL).set('Authorization', `Bearer ${token}`);

describe('Загрузка в мастере: отказ партнёру — по-русски, код прежний', () => {
  test('файл не приложен — «Файл не выбран.»', async () => {
    const res = await post().field('type', 'interior');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_REQUIRED');
    expect(res.body.message).toBe('Файл не выбран.');
  });

  test('PDF не в разделе меню — «PDF можно добавить только в меню.»', async () => {
    const res = await post()
      .field('type', 'interior')
      .attach('file', PDF_BYTES, { filename: 'menu.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PDF_TYPE_MISMATCH');
    expect(res.body.message).toBe('PDF можно добавить только в меню.');
  });

  test('формат не тот: тип файла фото, расширение чужое', async () => {
    const res = await post()
      .field('type', 'interior')
      .attach('file', PNG_BYTES, { filename: 'photo.gif', contentType: 'image/png' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(res.body.message).toBe('Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.');
  });

  test('формат не тот: тип файла PDF, расширение не .pdf', async () => {
    const res = await post()
      .field('type', 'menu')
      .attach('file', PDF_BYTES, { filename: 'menu.ai', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(res.body.message).toBe('Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.');
  });

  test('формат не тот: файл, который не пропускает фильтр загрузчика (GIF)', async () => {
    const res = await post()
      .field('type', 'interior')
      .attach('file', PNG_BYTES, { filename: 'photo.gif', contentType: 'image/gif' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(res.body.message).toBe('Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.');
  });

  test('фото больше 10 МБ — «Фото больше 10 МБ. Выберите фото поменьше.»', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    const res = await post()
      .field('type', 'interior')
      .attach('file', big, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.message).toBe('Фото больше 10 МБ. Выберите фото поменьше.');
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('файл больше 60 МБ — порог загрузчика назван верно', async () => {
    const huge = Buffer.alloc(60 * 1024 * 1024 + 1, 0);
    const res = await post()
      .field('type', 'menu')
      .attach('file', huge, { filename: 'menu.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.message).toBe('Файл больше 60 МБ. Выберите файл поменьше.');
  });

  test('файл в чужом поле формы — «Не удалось загрузить файл. Попробуйте ещё раз.»', async () => {
    const res = await post()
      .field('type', 'interior')
      .attach('photo', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_UPLOAD_FIELD');
    expect(res.body.message).toBe('Не удалось загрузить файл. Попробуйте ещё раз.');
  });

  test('сбой облака — русская фраза, внутренний текст наружу не уходит', async () => {
    cloudUpload.mockImplementationOnce(async () => {
      throw new Error('Request Timeout (cloud internal detail)');
    });

    const res = await post()
      .field('type', 'interior')
      .attach('file', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe('Не удалось загрузить файл. Попробуйте ещё раз через минуту.');
    expect(JSON.stringify(res.body)).not.toContain('cloud internal detail');
  });

  test('успешная загрузка не изменилась (фикстура: облако отвечает)', async () => {
    const res = await post()
      .field('type', 'interior')
      .attach('file', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });
});
