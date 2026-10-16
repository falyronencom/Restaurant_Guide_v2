/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сбой сервера (5xx) — наружу одной русской фразой (решение Координатора
 * 13.10.2026, общий текст для всех разделов).
 *
 * До правки errorHandler отдавал клиенту текст ошибки как есть: внутренний
 * текст библиотеки или базы («Failed to upload image: <ответ облака>») и
 * английские тексты сервисов. Его показывают как есть форма брони гостя,
 * загрузка фото в мастере и админка. Правило: 5xx уходит наружу, только если
 * это фраза для человека — AppError с русским текстом; всё прочее заменяется
 * фразой «Сбой на сервере. Попробуйте ещё раз через минуту.», подлинник
 * остаётся в журнале. Ответы 4xx правка не трогает.
 *
 * Ожидаемые тексты — литералы.
 */

import { jest } from '@jest/globals';
import multer from 'multer';
import logger from '../../utils/logger.js';
import { AppError, errorHandler } from '../../middleware/errorHandler.js';

const SERVER_FAILURE = 'Сбой на сервере. Попробуйте ещё раз через минуту.';

const respond = (err) => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  errorHandler(err, { path: '/x', method: 'POST', ip: '127.0.0.1' }, res, () => {});
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

let logError;
beforeEach(() => {
  logError = jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('5xx: наружу — только фраза для человека', () => {
  test('внутренняя ошибка библиотеки — общая фраза, подлинник в журнале', () => {
    const { status, body } = respond(new Error('Failed to upload image: Request Timeout'));

    expect(status).toBe(500);
    expect(body.message).toBe(SERVER_FAILURE);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // `stack` ответ несёт только вне продакшена — это отладка, не текст клиенту.
    const { stack: _devStack, ...visible } = body;
    expect(JSON.stringify(visible)).not.toContain('Request Timeout');
    expect(logError).toHaveBeenCalledWith(
      'Server error occurred',
      expect.objectContaining({ message: 'Failed to upload image: Request Timeout' }),
    );
  });

  test('английский AppError 500 сервиса — общая фраза, код прежний', () => {
    const { status, body } = respond(new AppError('Failed to upload media', 500, 'MEDIA_UPLOAD_FAILED'));

    expect(status).toBe(500);
    expect(body.message).toBe(SERVER_FAILURE);
    expect(body.error.code).toBe('MEDIA_UPLOAD_FAILED');
  });

  test('английский AppError 503 (проверка аккаунта недоступна) — общая фраза', () => {
    const { status, body } = respond(
      new AppError('Account check is temporarily unavailable. Please retry.', 503, 'AUTH_CHECK_UNAVAILABLE'),
    );

    expect(status).toBe(503);
    expect(body.message).toBe(SERVER_FAILURE);
    expect(body.error.code).toBe('AUTH_CHECK_UNAVAILABLE');
  });

  test('внутренняя ошибка с кириллицей — тоже общая фраза: это не фраза для человека', () => {
    const { body } = respond(new Error('Ошибка драйвера: соединение разорвано'));

    expect(body.message).toBe(SERVER_FAILURE);
  });

  test('русский AppError 500 — уходит как написан', () => {
    const { status, body } = respond(
      new AppError('Не удалось загрузить файл. Попробуйте ещё раз через минуту.', 500, 'INTERNAL_ERROR'),
    );

    expect(status).toBe(500);
    expect(body.message).toBe('Не удалось загрузить файл. Попробуйте ещё раз через минуту.');
  });
});

describe('5xx: наружу — общий код, подлинный — в журнале (16.10.2026)', () => {
  // До правки код ответа брался из err.code как есть: у сырой ошибки базы это
  // SQLSTATE (проба стенда — 22003, 2201W, 2201X, 22021 в теле 500), у ошибки
  // диска или сети — код Node. Свой код несёт только AppError: его пишет
  // сервер, и клиенты его знают.
  test.each([
    ['ошибка базы: значение вне диапазона', '22003', 'value "100000000000000000000" is out of range for type bigint'],
    ['ошибка базы: отрицательный OFFSET', '2201X', 'OFFSET must not be negative'],
    ['ошибка базы: NUL в тексте', '22021', 'invalid byte sequence for encoding "UTF8": 0x00'],
    ['ошибка диска', 'ENOENT', 'ENOENT: no such file or directory'],
  ])('%s → INTERNAL_ERROR, в журнале %s', (_label, innerCode, innerMessage) => {
    const { status, body } = respond(Object.assign(new Error(innerMessage), { code: innerCode }));

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    const { stack: _devStack, ...visible } = body;
    expect(JSON.stringify(visible)).not.toContain(innerCode);
    expect(logError).toHaveBeenCalledWith(
      'Server error occurred',
      expect.objectContaining({ errorCode: innerCode, statusCode: 500, message: innerMessage }),
    );
  });

  test('чужая ошибка со своим 5xx-статусом — тоже общий код', () => {
    const { status, body } = respond(Object.assign(new Error('Bad gateway'), { statusCode: 502, code: 'ERR_BAD_RESPONSE' }));

    expect(status).toBe(502);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  test('AppError 5xx — свой код уходит как написан', () => {
    const { body } = respond(new AppError('Не удалось загрузить файл. Попробуйте ещё раз через минуту.', 500, 'MEDIA_UPLOAD_FAILED'));

    expect(body.error.code).toBe('MEDIA_UPLOAD_FAILED');
  });
});

describe('4xx правка не трогает', () => {
  test('английский AppError 404 — как был', () => {
    const { status, body } = respond(new AppError('Promotion not found', 404, 'PROMOTION_NOT_FOUND'));

    expect(status).toBe(404);
    expect(body.message).toBe('Promotion not found');
  });

  test('нарушение уникальности базы — 409 со своим текстом', () => {
    const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const { status, body } = respond(duplicate);

    expect(status).toBe(409);
    expect(body.message).toBe('A record with this information already exists');
  });

  test('отказ разбора формы multer — 400 с его текстом', () => {
    const { status, body } = respond(new multer.MulterError('LIMIT_FIELD_COUNT'));

    expect(status).toBe(400);
    expect(body.message).toBe('Too many fields');
    expect(body.error.code).toBe('LIMIT_FIELD_COUNT');
  });
});
