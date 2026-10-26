/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказы разборщика тела в errorHandler — то, чего по сети не получить
 * (25.10.2026; по сети — integration/body-parser-refusals):
 *  - размер тела не совпал с Content-Length (request.size.invalid; парсер
 *    HTTP в Node такого тела не пропускает) — как нечитаемая форма:
 *    400 INVALID_FORMAT и текст формы;
 *  - оборванный запрос (request.aborted) и сбои самого сервера при чтении
 *    тела — как прежде: список их намеренно не берёт;
 *  - чужой тип, совпавший с именем члена объекта, — не отказ из списка;
 *  - журнал отказа: текст библиотеки (`reason`) и отклонённый
 *    Content-Encoding (`encoding`) — значения из заголовков клиента,
 *    обрезанные до 100 знаков.
 *
 * Ошибки — той формы, что строят body-parser и raw-body (http-errors:
 * status, statusCode, expose и свойства библиотеки — type, code, encoding).
 * Ожидаемые тексты — литералы.
 */

import { jest } from '@jest/globals';
import logger from '../../utils/logger.js';
import { errorHandler } from '../../middleware/errorHandler.js';

/** Ошибка той формы, что строит http-errors у body-parser и raw-body. */
const createError = (status, message, props) =>
  Object.assign(new Error(message), { status, statusCode: status, expose: status < 500, ...props });

const respond = (err) => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  errorHandler(err, { path: '/x', method: 'POST', ip: '127.0.0.1' }, res, () => {});
  const body = res.json.mock.calls[0][0];
  return { status: res.status.mock.calls[0][0], code: body.error.code, message: body.message };
};

let warn;
beforeEach(() => {
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('размер тела не совпал с Content-Length — 400 INVALID_FORMAT, текст формы; текст библиотеки — в журнале', () => {
  const err = createError(400, 'request size did not match content length', { type: 'request.size.invalid' });

  expect(respond(err)).toEqual({
    status: 400,
    code: 'INVALID_FORMAT',
    message: 'Не удалось прочитать отправленные данные. Попробуйте ещё раз.',
  });
  expect(warn).toHaveBeenCalledWith(
    'Client error occurred',
    expect.objectContaining({ errorCode: 'INVALID_FORMAT', reason: 'request size did not match content length' }),
  );
});

test('оборванный запрос — как прежде: статус и код библиотеки', () => {
  // raw-body/index.js onAborted
  const err = createError(400, 'request aborted', { code: 'ECONNABORTED', type: 'request.aborted' });

  expect(respond(err)).toEqual({ status: 400, code: 'ECONNABORTED', message: 'request aborted' });
});

test('сбой сервера при чтении тела — общая фраза сбоя, как прежде', () => {
  const err = createError(500, 'stream is not readable', { type: 'stream.not.readable' });

  expect(respond(err)).toEqual({
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Сбой на сервере. Попробуйте ещё раз через минуту.',
  });
});

test.each(['constructor', 'toString', 'hasOwnProperty'])('тип «%s» — не отказ из списка', (type) => {
  const err = createError(400, 'something else', { type });

  expect(respond(err)).toEqual({ status: 400, code: 'INTERNAL_ERROR', message: 'something else' });
});

test('сжатое тело: в журнале — отклонённый Content-Encoding', () => {
  // body-parser/lib/read.js contentstream при inflate: false
  const err = createError(415, 'content encoding unsupported', { encoding: 'gzip', type: 'encoding.unsupported' });

  expect(respond(err).code).toBe('UNSUPPORTED_ENCODING');
  expect(warn).toHaveBeenCalledWith(
    'Client error occurred',
    expect.objectContaining({ reason: 'content encoding unsupported', encoding: 'gzip' }),
  );
});

test('значения из заголовков в журнале обрезаны до 100 знаков', () => {
  const long = 'x'.repeat(5000);
  respond(createError(415, 'content encoding unsupported', { encoding: long, type: 'encoding.unsupported' }));
  respond(createError(415, `unsupported charset "${long.toUpperCase()}"`, { charset: long, type: 'charset.unsupported' }));

  const [byEncoding, byCharset] = warn.mock.calls.map(([, context]) => context);
  expect(byEncoding.encoding).toBe('x'.repeat(100));
  const prefix = 'unsupported charset "';
  expect(byCharset.reason).toBe(`${prefix}${'X'.repeat(100 - prefix.length)}`);
  expect(byCharset).not.toHaveProperty('encoding');
});
