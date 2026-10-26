/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Перезапуск распознавания, отвеченный сбоем сервера, не тратит один из пяти
 * перезапусков дня (находка Н40, 25.10.2026; ревью по линзе тихих сбоев):
 * приложение повторяет запрос на 5xx трижды, и каждый повтор снова проходит
 * лимитер маршрута. Отказ — нет файлов меню, исчерпанный суточный предел
 * (429), чужая карточка — засчитан, как был.
 *
 * Сбой базы до постановки через настоящее приложение не вызвать: сервис
 * подменён, контроллер исполняется целиком.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../services/partnerMenuItemService.js', () => ({
  retryOcr: jest.fn(),
  listMenuItems: jest.fn(),
  updateMenuItem: jest.fn(),
}));
jest.unstable_mockModule('../../middleware/rateLimiter.js', () => ({
  giveBackRateLimitSlots: jest.fn(async () => {}),
}));

const service = await import('../../services/partnerMenuItemService.js');
const { giveBackRateLimitSlots } = await import('../../middleware/rateLimiter.js');
const { AppError } = await import('../../middleware/errorHandler.js');
const { retryOcr } = await import('../../controllers/partnerMenuItemController.js');

const request = () => ({ params: { id: 'card-1' }, user: { userId: 'partner-1' } });
const response = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

/**
 * Исход перезапуска: ошибка, переданная дальше, или ответ. asyncHandler
 * обещания не возвращает — ждём, пока обработчик ответит или позовёт next.
 */
const run = async () => {
  const req = request();
  const res = response();
  const error = await new Promise((resolve) => {
    res.json = jest.fn(() => {
      resolve(undefined);
      return res;
    });
    retryOcr(req, res, resolve);
  });
  return { req, res, error };
};

beforeEach(() => {
  jest.clearAllMocks();
});

test.each([
  ['ни один файл не поставлен', new AppError('Не удалось запустить распознавание. Попробуйте позже.', 500, 'OCR_RESTART_FAILED')],
  ['база упала до постановки', new Error('Connection terminated unexpectedly')],
])('%s → сбой уходит дальше как был, перезапуск возвращён', async (_case, failure) => {
  service.retryOcr.mockRejectedValue(failure);

  const { req, error } = await run();

  expect(error).toBe(failure);
  expect(giveBackRateLimitSlots).toHaveBeenCalledTimes(1);
  expect(giveBackRateLimitSlots).toHaveBeenCalledWith(req);
});

test.each([
  ['исчерпан суточный предел распознавания', 429, 'RATE_LIMIT_EXCEEDED'],
  ['нет файлов меню', 400, 'NO_PDF_MENUS'],
  ['не карточка партнёра', 404, 'ESTABLISHMENT_NOT_FOUND'],
])('отказ: %s (%i) → перезапуск засчитан', async (_case, status, code) => {
  const refusal = new AppError('отказ', status, code);
  service.retryOcr.mockRejectedValue(refusal);

  const { error } = await run();

  expect(error).toBe(refusal);
  expect(giveBackRateLimitSlots).not.toHaveBeenCalled();
});

test('поставлен хотя бы один файл → 202, перезапуск засчитан', async () => {
  service.retryOcr.mockResolvedValue({ enqueuedJobs: 1, totalPdfs: 2 });

  const { res, error } = await run();

  expect(error).toBeUndefined();
  expect(res.status).toHaveBeenCalledWith(202);
  expect(giveBackRateLimitSlots).not.toHaveBeenCalled();
});
