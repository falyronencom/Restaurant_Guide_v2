/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказ предела (429) через errorHandler — суточный предел загрузок
 * (DailyUploadLimitError, services/uploadAllowance.js, 17.10.2026): медиа
 * карточки, картинка акции и аватар бросают его из сервиса, и подробности
 * (пределы, когда обновятся) и заголовок Retry-After доходят до клиента только
 * через errorHandler. До правки он отдавал подробности лишь у 400 и 422.
 *
 * Прочие ответы правка не трогает: 429 без подробностей и срока, подробности
 * у других статусов, ошибки не-AppError. (Квота отзывов с 19.10.2026 несёт
 * подробности и срок, как предел загрузок: reviewService.js.)
 */

import { jest } from '@jest/globals';
import logger from '../../utils/logger.js';
import { AppError, errorHandler } from '../../middleware/errorHandler.js';

const DETAILS = {
  files_limit: 100,
  bytes_limit: 300 * 1024 * 1024,
  retry_after: 43200,
  reset_at: '2026-10-17T21:00:00.000Z',
};

const respond = (err) => {
  const res = { status: jest.fn(), json: jest.fn(), set: jest.fn() };
  res.status.mockReturnValue(res);
  errorHandler(err, { path: '/x', method: 'POST', ip: '127.0.0.1' }, res, () => {});
  return {
    status: res.status.mock.calls[0][0],
    body: res.json.mock.calls[0][0],
    headers: Object.fromEntries(res.set.mock.calls),
  };
};

/** Отказ предела, как его бросает сервис: AppError 429 с подробностями и сроком. */
const limitRefusal = ({ details = DETAILS, retryAfter = 43200 } = {}) =>
  Object.assign(new AppError('Лимит загрузок на сегодня исчерпан. Продолжите завтра.', 429, 'RATE_LIMIT_EXCEEDED', details), { retryAfter });

beforeEach(() => {
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('429 предела: подробности и Retry-After', () => {
  test('подробности — в теле, срок — в заголовке Retry-After', () => {
    const { status, body, headers } = respond(limitRefusal());

    expect(status).toBe(429);
    expect(body.message).toBe('Лимит загрузок на сегодня исчерпан. Продолжите завтра.');
    expect(body.error).toEqual({ code: 'RATE_LIMIT_EXCEEDED', details: DETAILS });
    expect(headers).toEqual({ 'Retry-After': '43200' });
  });

  test('429 без подробностей и срока — как прежде: ни подробностей, ни заголовка', () => {
    const { status, body, headers } = respond(
      new AppError('Too many attempts', 429, 'RATE_LIMIT_EXCEEDED'),
    );

    expect(status).toBe(429);
    expect(body.error).toEqual({ code: 'RATE_LIMIT_EXCEEDED' });
    expect(headers).toEqual({});
  });

  test('срок не целое положительное число — заголовка нет', () => {
    for (const retryAfter of [0, -5, 1.5, '60', null]) {
      expect(respond(limitRefusal({ retryAfter })).headers).toEqual({});
    }
    const withoutTerm = new AppError('Лимит загрузок на сегодня исчерпан. Продолжите завтра.', 429, 'RATE_LIMIT_EXCEEDED', DETAILS);
    expect(respond(withoutTerm).headers).toEqual({});
  });

  test('подробности у других статусов (403, 409) не отдаются — как прежде', () => {
    expect(respond(new AppError('Нет доступа.', 403, 'FORBIDDEN', DETAILS)).body.error).toEqual({ code: 'FORBIDDEN' });
    expect(respond(new AppError('Конфликт.', 409, 'CONFLICT', DETAILS)).body.error).toEqual({ code: 'CONFLICT' });
  });

  test('ошибка не-AppError со статусом 429 — ни подробностей, ни заголовка', () => {
    const foreign = Object.assign(new Error('Too Many Requests'), { statusCode: 429, details: DETAILS, retryAfter: 60 });

    const { status, body, headers } = respond(foreign);

    expect(status).toBe(429);
    expect(body.error.details).toBeUndefined();
    expect(headers).toEqual({});
  });
});
