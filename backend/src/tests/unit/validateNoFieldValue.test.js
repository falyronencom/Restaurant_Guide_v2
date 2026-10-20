/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказ проверки полей (validate, validatePersonText) не несёт значения поля
 * ни в журнал, ни в ответ (Н19 нитки «Остатки „500 вместо отказа“», сессия Д,
 * 20.10.2026).
 *
 * До правки каждый отказ писал в журнал и отдавал в ответе `value` — то, что
 * человек ввёл: текст отзыва, подпись к фото, имя. (Пароли проверяет свой
 * обработчик authValidation.js — он значений не пишет.)
 * Потребителя у `value` в ответе нет: сайт, приложение и панель читают из
 * `details` только `field` и `message` (сверено 20.10.2026 по web/src/lib,
 * mobile/lib, admin-web/lib). Имя поля и текст отказа остаются — по ним
 * клиенты показывают отказ.
 *
 * Здесь же — тело, которое не разобрано как JSON: текст ошибки V8 цитирует
 * кусок тела («Unexpected token 'S', ..."assword": Secr3t"...»), и
 * errorHandler писал его в журнал как есть (линза ревью, 20.10.2026).
 */

import { jest } from '@jest/globals';
import { body } from 'express-validator';
import logger from '../../utils/logger.js';
import { errorHandler, validate, validatePersonText } from '../../middleware/errorHandler.js';

// Значение, которое не должно уйти никуда, и то, что должно остаться.
const ENTERED = 'Текст-отзыва-введённый-человеком-7';
const FIELD = 'text';
const MESSAGE = 'Отзыв — не короче 64 знаков';

const refuse = async (middleware) => {
  const req = { body: { [FIELD]: ENTERED }, path: '/x', method: 'POST' };
  await body(FIELD).isLength({ min: 64 }).withMessage(MESSAGE).run(req);
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const next = jest.fn();
  middleware(req, res, next);
  return { status: res.status.mock.calls[0]?.[0], payload: res.json.mock.calls[0]?.[0], next };
};

let warn;
beforeEach(() => {
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ['validate', validate],
  ['validatePersonText', validatePersonText],
])('%s', (_name, middleware) => {
  test('ответ: поле и текст отказа есть, введённого значения нет', async () => {
    const { status, payload, next } = await refuse(middleware);

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(422);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details).toEqual([{ field: FIELD, message: MESSAGE }]);
    expect(JSON.stringify(payload)).not.toContain(ENTERED);
  });

  test('журнал: поле и текст отказа есть, введённого значения нет', async () => {
    await refuse(middleware);

    const logged = warn.mock.calls.filter(([message]) => message === 'Request validation failed');
    expect(logged).toHaveLength(1);
    expect(logged[0][1].errors).toEqual([{ field: FIELD, message: MESSAGE }]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ENTERED);
  });
});

describe('тело не JSON (body-parser)', () => {
  // Ошибка — та, что отдаёт body-parser: SyntaxError от JSON.parse с type и
  // статусом (node_modules/body-parser/lib/types/json.js).
  const parseFailure = (raw) => {
    let err;
    try {
      JSON.parse(raw);
    } catch (e) {
      err = e;
    }
    return Object.assign(err, { type: 'entity.parse.failed', status: 400, statusCode: 400, body: raw });
  };

  test('ни в журнал, ни в ответ кусок тела не уходит', () => {
    const err = parseFailure('{"email": "a@b.c", "password": Secr3tPass}');
    // Сторож примера: V8 действительно цитирует кусок тела.
    expect(err.message).toContain('Secr3t');
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);

    errorHandler(err, { path: '/auth/login', method: 'POST', ip: '127.0.0.1' }, res, () => {});

    const payload = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload.error.code).toBe('INVALID_JSON');
    expect(payload.message).toBe('Request body contains invalid JSON');
    expect(warn).toHaveBeenCalledWith('Client error occurred', expect.objectContaining({
      message: 'Request body contains invalid JSON',
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Secr3t');
    // `stack` ответ несёт только вне продакшена — это отладка, не текст клиенту.
    const { stack: _devStack, ...visible } = payload;
    expect(JSON.stringify(visible)).not.toContain('Secr3t');
  });
});
