/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: пагинация броней партнёра (validators/bookingValidation.js) и
 * уведомлений (validators/notificationValidation.js).
 *
 * Правило — то же, что у отзывов и избранного: страница — целое ≥ 1, размер —
 * целое 1–50, смещение — целое ≥ 0; верхний потолок страницы и смещения — у
 * фильтра на входе (middleware/requestGuard.js). Границы — парой N / N+1,
 * ожидаемые тексты — литералы. Сквозной путь — integration/
 * listing-pagination-refusals.test.js.
 */

import { validationResult } from 'express-validator';
import { validateGetPartnerBookings } from '../../validators/bookingValidation.js';
import { validateGetNotifications } from '../../validators/notificationValidation.js';

const PAGE = 'Page must be a positive integer';
const LIMIT = 'Limit must be between 1 and 50';
const OFFSET = 'Offset must be a non-negative integer';

/** Цепочки на поддельном запросе: [] — прошло, иначе [{ field, message }]. */
async function complaints(chains, query) {
  const req = { query, params: {}, body: {} };
  for (const chain of chains) {
    await chain.run(req);
  }
  return validationResult(req).array().map(({ path, msg }) => ({ field: path, message: msg }));
}

describe('уведомления', () => {
  test.each([
    ['без параметров (запрос по умолчанию)', {}],
    ['запрос приложения', { page: '1', limit: '20' }],
    ['страница 1 и размер 1 — нижние границы', { page: '1', limit: '1' }],
    ['размер 50 — верхняя граница', { limit: '50' }],
    ['большая страница — потолок держит фильтр на входе', { page: '10000' }],
  ])('%s → проходит', async (_label, query) => {
    expect(await complaints(validateGetNotifications, query)).toEqual([]);
  });

  test.each([
    ['страница 0', { page: '0' }, 'page', PAGE],
    ['страница −1', { page: '-1' }, 'page', PAGE],
    ['страница не числом', { page: 'abc' }, 'page', PAGE],
    ['страница дробью', { page: '1.5' }, 'page', PAGE],
    ['размер 0', { limit: '0' }, 'limit', LIMIT],
    ['размер 51', { limit: '51' }, 'limit', LIMIT],
    ['размер −5', { limit: '-5' }, 'limit', LIMIT],
    ['размер не числом', { limit: 'abc' }, 'limit', LIMIT],
    // qs строит из ?limit[toString]=x объект без текстовой формы: parseInt
    // в контроллере бросал на нём TypeError → 500.
    ['размер — объект без текстовой формы', { limit: { toString: 'x' } }, 'limit', LIMIT],
    ['он же внутри массива', { limit: [{ toString: 'x' }] }, 'limit', LIMIT],
    ['страница — объект без текстовой формы', { page: { toString: 'x' } }, 'page', PAGE],
  ])('%s → отказ', async (_label, query, field, message) => {
    expect(await complaints(validateGetNotifications, query)).toEqual([{ field, message }]);
  });
});

describe('брони партнёра', () => {
  test.each([
    ['без параметров (запрос приложения)', {}],
    ['размер 1 и смещение 0 — нижние границы', { limit: '1', offset: '0' }],
    ['размер 50 — верхняя граница', { limit: '50' }],
    ['большое смещение — потолок держит фильтр на входе', { offset: '1000000' }],
  ])('%s → проходит', async (_label, query) => {
    expect(await complaints(validateGetPartnerBookings, query)).toEqual([]);
  });

  test.each([
    ['размер 0', { limit: '0' }, 'limit', LIMIT],
    ['размер 51', { limit: '51' }, 'limit', LIMIT],
    ['размер −1', { limit: '-1' }, 'limit', LIMIT],
    ['размер выше bigint', { limit: '100000000000000000000' }, 'limit', LIMIT],
    ['размер не числом', { limit: 'abc' }, 'limit', LIMIT],
    ['смещение −1', { offset: '-1' }, 'offset', OFFSET],
    ['смещение не числом', { offset: 'abc' }, 'offset', OFFSET],
    ['размер — объект без текстовой формы', { limit: { toString: 'x' } }, 'limit', LIMIT],
    ['смещение — объект без текстовой формы, внутри массива', { offset: [{ toString: 'x' }] }, 'offset', OFFSET],
  ])('%s → отказ', async (_label, query, field, message) => {
    expect(await complaints(validateGetPartnerBookings, query)).toEqual([{ field, message }]);
  });
});
