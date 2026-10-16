/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: пагинация броней партнёра и уведомлений — отказ 422 у адреса,
 * а не ошибка базы.
 *
 * До правки оба адреса передавали `limit`, `offset` и `page` в SQL без нижней
 * границы, а брони — и `limit` без верхней (проба стенда 16.10.2026 на прежнем
 * коде): `limit` выше bigint → 500 с кодом базы 22003, отрицательный `limit` →
 * 500 / 2201W, отрицательное смещение и нулевая или отрицательная страница →
 * 500 / 2201X, нечисло → 400 INVALID_FORMAT через перевод 22P02 с записью
 * «Server error occurred» в журнале; `limit=0` и `limit` сверх 50 у
 * уведомлений проходили (пустая страница, «страниц» null; молча 50).
 *
 * Правило — то же, что у отзывов и избранного (validators/*Validation.js):
 * страница — целое ≥ 1, размер — целое 1–50, смещение — целое ≥ 0; верхняя
 * граница страницы и смещения — у фильтра на входе (request-guard.test.js).
 * Ожидаемые тексты — литералы правила; границы — парой N / N+1. Что шлют
 * клиенты: приложение — уведомления `page` ≥ 1 и `limit=20` во всех версиях,
 * брони — без параметров; сайт и админка эти адреса не зовут.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import { clearAllData, query } from '../utils/database.js';
import { createStandardTestUsers, createTestEstablishment, utcTimestamp } from '../utils/auth.js';

const PAGE = 'Page must be a positive integer';
const LIMIT = 'Limit must be between 1 and 50';
const OFFSET = 'Offset must be a non-negative integer';
const BEYOND_BIGINT = '100000000000000000000';

let users;
let establishment;
let errorSpy;

beforeAll(async () => {
  await clearAllData();
  users = await createStandardTestUsers();
  establishment = await createTestEstablishment(users.partner.user.id);

  // Две брони и две записи уведомлений — чтобы граница «проходит» была видна
  // по числу строк, а не только по статусу.
  for (const hoursAgo of [2, 1]) {
    await query(
      `INSERT INTO bookings (establishment_id, user_id, booking_date, booking_time, guest_count,
                             contact_phone, status, expires_at, created_at)
       VALUES ($1, $2, CURRENT_DATE + 1, '19:00', 2, '+375291111111', 'confirmed', $3, $4)`,
      [
        establishment.id,
        users.regular.user.id,
        utcTimestamp(new Date(Date.now() + 86400000)),
        utcTimestamp(new Date(Date.now() - hoursAgo * 3600000)),
      ],
    );
    await query(
      `INSERT INTO notifications (user_id, type, title, message, created_at)
       VALUES ($1, 'establishment_approved', 'Заголовок', 'Текст', $2)`,
      [users.regular.user.id, utcTimestamp(new Date(Date.now() - hoursAgo * 3600000))],
    );
  }
});

afterAll(async () => {
  await clearAllData();
});

beforeEach(() => {
  errorSpy = jest.spyOn(logger, 'error');
});

afterEach(() => {
  errorSpy.mockRestore();
});

const bookingsUrl = (qs) => `/api/v1/partner/bookings/${establishment.id}${qs}`;
const getBookings = (qs) => request(app).get(bookingsUrl(qs)).set('Authorization', `Bearer ${users.partner.accessToken}`);
const getNotifications = (qs) => request(app).get(`/api/v1/notifications${qs}`).set('Authorization', `Bearer ${users.regular.accessToken}`);

function expectNoServerErrorLogged() {
  const serverErrors = errorSpy.mock.calls.filter(([message]) => message === 'Server error occurred');
  expect(serverErrors).toEqual([]);
}

/** Отказ validate(): 422, своё поле и свой текст — одна жалоба, не код базы. */
function expectFieldRefused(res, field, message) {
  expect(res.status).toBe(422);
  expect(res.body.success).toBe(false);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(res.body.error.details).toEqual([expect.objectContaining({ field, message })]);
  expectNoServerErrorLogged();
}

describe('брони партнёра: размер страницы 1–50, смещение ≥ 0', () => {
  test.each([
    ['limit выше bigint (до правки 500, наружу 22003)', `?limit=${BEYOND_BIGINT}`, 'limit', LIMIT],
    ['limit = −1 (до правки 500, наружу 2201W)', '?limit=-1', 'limit', LIMIT],
    ['limit = 0 (до правки — пустая страница)', '?limit=0', 'limit', LIMIT],
    ['limit = 51 (до правки — без верхней границы)', '?limit=51', 'limit', LIMIT],
    ['limit = abc (до правки 400 с записью ошибки сервера)', '?limit=abc', 'limit', LIMIT],
    ['offset = −1 (до правки 500, наружу 2201X)', '?offset=-1', 'offset', OFFSET],
    ['offset = abc (до правки 400 с записью ошибки сервера)', '?offset=abc', 'offset', OFFSET],
    ['limit — объект без текстовой формы (до правки 500)', '?limit%5BtoString%5D=x', 'limit', LIMIT],
  ])('%s → 422', async (_label, qs, field, message) => {
    expectFieldRefused(await getBookings(qs), field, message);
  });

  test('границы проходят: limit 1 и 50, offset 0 и 1', async () => {
    const one = await getBookings('?limit=1');
    expect(one.status).toBe(200);
    expect(one.body.data.items).toHaveLength(1);
    expect(one.body.data.total).toBe(2);

    const fifty = await getBookings('?limit=50&offset=0');
    expect(fifty.status).toBe(200);
    expect(fifty.body.data.items).toHaveLength(2);

    const second = await getBookings('?limit=1&offset=1');
    expect(second.status).toBe(200);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].id).not.toBe(one.body.data.items[0].id);

    expectNoServerErrorLogged();
  });

  test('запрос приложения — без параметров — как прежде', async () => {
    const res = await getBookings('');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });
});

describe('уведомления: страница ≥ 1, размер 1–50', () => {
  test.each([
    ['page = −1 (до правки 500, наружу 2201X)', '?page=-1', 'page', PAGE],
    ['page = 0 (до правки 500, наружу 2201X)', '?page=0', 'page', PAGE],
    ['page = abc (до правки 400 с записью ошибки сервера)', '?page=abc', 'page', PAGE],
    ['limit = abc (до правки 400 с записью ошибки сервера)', '?limit=abc', 'limit', LIMIT],
    ['limit = −5 (до правки 500, наружу 2201W)', '?limit=-5', 'limit', LIMIT],
    ['limit = 0 (до правки — пустая страница, «страниц» null)', '?limit=0', 'limit', LIMIT],
    ['limit = 51 (до правки — молча 50)', '?limit=51', 'limit', LIMIT],
    ['limit — объект без текстовой формы (до правки 500)', '?limit%5BtoString%5D=x', 'limit', LIMIT],
  ])('%s → 422', async (_label, qs, field, message) => {
    expectFieldRefused(await getNotifications(qs), field, message);
  });

  test('границы проходят: page 1, limit 1 и 50', async () => {
    const one = await getNotifications('?page=1&limit=1');
    expect(one.status).toBe(200);
    expect(one.body.data.items).toHaveLength(1);
    expect(one.body.data.pagination).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });

    const fifty = await getNotifications('?limit=50');
    expect(fifty.status).toBe(200);
    expect(fifty.body.data.items).toHaveLength(2);
    expect(fifty.body.data.pagination.limit).toBe(50);

    expectNoServerErrorLogged();
  });

  test('запрос приложения — page=1&limit=20 — как прежде', async () => {
    const res = await getNotifications('?page=1&limit=20');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 20, total: 2, pages: 1 });
  });
});
