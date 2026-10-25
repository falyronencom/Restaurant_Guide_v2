/* eslint-env jest */
/**
 * escapeLike / likeContains — одна функция экранирования LIKE на весь сервер
 * (прежде четыре копии: adminReviewModel, menuItemModel, establishmentModel,
 * scripts/lib/serviceAccounts.js). Что поиск по базе находит текст буквально,
 * держат интеграционные тесты поисков (admin-menu-items, admin-moderation-
 * extended, review-batch-hide-and-people-filters); здесь — сам контракт
 * функции. Ожидания — литералами.
 */

import { escapeLike, likeContains } from '../../utils/likePattern.js';

describe('escapeLike', () => {
  test.each([
    ['100%', '100\\%'],
    ['a_b', 'a\\_b'],
    ['C:\\путь', 'C:\\\\путь'],
    ['%_\\', '\\%\\_\\\\'],
    ['кофе', 'кофе'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });

  test('обратная косая экранируется первой и один раз: «\\%» → «\\\\\\%»', () => {
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  test('не строку приводит к строке (как прежние копии с String)', () => {
    expect(escapeLike(100)).toBe('100');
  });
});

describe('likeContains', () => {
  test('оборачивает экранированный текст в %…%', () => {
    expect(likeContains('100%')).toBe('%100\\%%');
    expect(likeContains('кофе')).toBe('%кофе%');
  });
});
