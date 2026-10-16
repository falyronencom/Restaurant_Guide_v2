/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сбой сервера через настоящий маршрут: наружу — общий код INTERNAL_ERROR,
 * подлинный код ошибки — только в журнале.
 *
 * До правки errorHandler клал в ответ `err.code` как есть: у сырой ошибки базы
 * это её код (SQLSTATE), и всякий код вне трёх переводов (23505, 23503, 22P02)
 * уходил клиенту — проба стенда 16.10.2026 на прежнем коде: 22003, 2201W,
 * 2201X, 22021 в теле 500. Временная загрузка (мастер, кабинет) так же
 * отдавала код ошибки облака или диска. Текст сбоя закрыт раньше
 * («Сбой на сервере…», server-failure-text.test.js); правило —
 * middleware/errorHandler.js, подробно — unit/errorHandlerServerFailure.
 *
 * Ошибка базы — настоящая: запрос маршрута подменён на запрос, на котором
 * Postgres сам отвечает 22003 («integer out of range»).
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

const SERVER_FAILURE = 'Сбой на сервере. Попробуйте ещё раз через минуту.';
const UPLOAD_FAILED = 'Не удалось загрузить файл. Попробуйте ещё раз через минуту.';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let token;
let errorSpy;

beforeAll(async () => {
  await clearAllData();
  ({ accessToken: token } = await createUserAndGetTokens({
    email: `server-failure-code-${Date.now()}@test.com`,
    password: 'Partner123!@#',
    name: 'Server Failure Code',
    role: 'partner',
  }));
});

afterAll(async () => {
  await clearAllData();
});

beforeEach(() => {
  errorSpy = jest.spyOn(logger, 'error');
});

afterEach(() => {
  jest.restoreAllMocks();
});

function loggedServerErrors() {
  return errorSpy.mock.calls.filter(([message]) => message === 'Server error occurred').map(([, context]) => context);
}

test('сырая ошибка базы с кодом вне переводов — наружу INTERNAL_ERROR, в журнале 22003', async () => {
  const realQuery = pool.query.bind(pool);
  jest.spyOn(pool, 'query').mockImplementation((text, params) => (
    typeof text === 'string' && text.includes('is_read = FALSE')
      ? realQuery('SELECT (2147483647 + $1::int)::int AS overflow', [1])
      : realQuery(text, params)
  ));

  const res = await request(app)
    .get('/api/v1/notifications/unread-count')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('INTERNAL_ERROR');
  expect(res.body.message).toBe(SERVER_FAILURE);
  const { stack: _devStack, ...visible } = res.body;
  expect(JSON.stringify(visible)).not.toContain('22003');

  const logged = loggedServerErrors();
  expect(logged).toHaveLength(1);
  expect(logged[0]).toEqual(expect.objectContaining({ errorCode: '22003', statusCode: 500 }));
});

test('временная загрузка: сбой с кодом после облака — наружу INTERNAL_ERROR и русская фраза', async () => {
  // Маршрут заворачивает любой сбой в AppError с русской фразой, а код брал у
  // пойманной ошибки — у ошибки Node (ERR_*) он есть. Сбой облака сам кода не
  // несёт: config/cloudinary.js заворачивает его в Error без кода; поэтому
  // ошибка с кодом — из шага после загрузки (ссылки на размеры фото).
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => ({
    public_id: `${options.folder}/code0001`,
    secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/code0001.png`,
  }));
  jest.spyOn(cloudinarySdk, 'url').mockImplementation(() => {
    throw Object.assign(new TypeError('The "path" argument must be of type string'), { code: 'ERR_INVALID_ARG_TYPE' });
  });

  const res = await request(app)
    .post('/api/v1/partner/media/upload')
    .set('Authorization', `Bearer ${token}`)
    .field('type', 'interior')
    .attach('file', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' });

  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('INTERNAL_ERROR');
  expect(res.body.message).toBe(UPLOAD_FAILED);
  const { stack: _devStack, ...visible } = res.body;
  expect(JSON.stringify(visible)).not.toContain('ERR_INVALID_ARG_TYPE');

  // Подлинный код — в журнале маршрута: общий журнал сбоя пишет уже код
  // AppError (INTERNAL_ERROR).
  expect(errorSpy).toHaveBeenCalledWith(
    'Error uploading temporary media',
    expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
  );
});
