/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сбой сервера через настоящий маршрут: наружу — «Сбой на сервере. Попробуйте
 * ещё раз через минуту.», внутренний текст — нет (решение Координатора
 * 13.10.2026; правило — middleware/errorHandler.js, подробно —
 * unit/errorHandlerServerFailure.test.js).
 *
 * Маршрут — создание акции с картинкой: сбой облака доходит до обработчика
 * ошибок сырой ошибкой «Failed to upload image: <ответ облака>», как и на
 * любом другом пути, где ошибку никто не перехватил. Сетевой вызов облака
 * подменён.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import { clearAllData } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let token;
let establishmentId;

beforeAll(async () => {
  await clearAllData();
  const { user, accessToken } = await createUserAndGetTokens({
    email: `server-failure-${Date.now()}@test.com`,
    password: 'Partner123!@#',
    name: 'Server Failure',
    role: 'partner',
  });
  token = accessToken;
  establishmentId = (await createTestEstablishment(user.id)).id;
});

afterAll(async () => {
  jest.restoreAllMocks();
  await clearAllData();
});

test('сбой облака при создании акции — 500 с общей русской фразой, код прежний', async () => {
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async () => {
    throw new Error('Request Timeout (cloud internal detail)');
  });

  const res = await request(app)
    .post('/api/v1/partner/promotions')
    .set('Authorization', `Bearer ${token}`)
    .field('establishment_id', establishmentId)
    .field('title', 'Акция со сбоем облака')
    .attach('image', PNG_BYTES, { filename: 'promo.jpg', contentType: 'image/jpeg' });

  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('INTERNAL_ERROR');
  expect(res.body.message).toBe('Сбой на сервере. Попробуйте ещё раз через минуту.');
  // `stack` ответ несёт только вне продакшена — это отладка, не текст клиенту.
  const { stack: _devStack, ...visible } = res.body;
  expect(JSON.stringify(visible)).not.toContain('cloud internal detail');
});
