/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: nameMatchMode / isIntentEmpty — что умный поиск делает с
 * совпадением по названию заведения (решение Координатора 29.09.2026).
 *
 * Разборы ниже — те, что прод давал на названия 29.09: пустой («Tiden»),
 * тип из слова названия («urban dzen cafe» → «Кафе»), город («SFB Minsk»),
 * блюдо («андердог»). Что эти режимы дают на настоящей базе — держит
 * integration/smart-search.test.js, блок «поиск по названию заведения».
 */

import { isIntentEmpty, nameMatchMode } from '../../services/smartSearchService.js';

const intentOf = (extra = {}) => ({
  category: null, cuisine: null, dish: null, dish_variants: [], meal_type: null,
  price_max: null, location: null, sort: null, tags: [], error: null, ...extra,
});

const full = { level: 3, generic: false };
const prefix = { level: 2, generic: false };
const typo = { level: 1, generic: false };

describe('isIntentEmpty', () => {
  test('пустой разбор пуст; сортировка условием не считается', () => {
    expect(isIntentEmpty(intentOf())).toBe(true);
    expect(isIntentEmpty(intentOf({ sort: 'distance' }))).toBe(true);
  });

  test.each([
    ['тип', { category: 'Кафе' }],
    ['кухня', { cuisine: ['Японская'] }],
    ['блюдо', { dish: 'андердог' }],
    ['приём пищи', { meal_type: 'dinner' }],
    ['цена', { price_max: 20 }],
    ['город', { location: 'Минск' }],
    ['теги', { tags: ['терраса'] }],
  ])('%s — условие', (_, extra) => {
    expect(isIntentEmpty(intentOf(extra))).toBe(false);
  });

  test('пустые списки кухонь и тегов условием не считаются', () => {
    expect(isIntentEmpty(intentOf({ cuisine: [], tags: [] }))).toBe(true);
  });
});

describe('nameMatchMode — название целиком', () => {
  test('пустой разбор («Tiden») — только совпавшие', () => {
    expect(nameMatchMode(full, { intent: intentOf(), hasMenuTerm: false })).toBe('only');
  });

  test('тип или город из слов самого названия («urban dzen cafe», «SFB Minsk») — всё равно только совпавшие', () => {
    expect(nameMatchMode(full, { intent: intentOf({ category: 'Кафе' }), hasMenuTerm: false })).toBe('only');
    expect(nameMatchMode(full, { intent: intentOf({ location: 'Минск' }), hasMenuTerm: false })).toBe('only');
  });

  test('фраза просит блюдо или приём пищи («underdog пицца», «Tiden завтрак») — совпавшие первыми', () => {
    expect(nameMatchMode(full, { intent: intentOf({ dish: 'пицца' }), hasMenuTerm: true })).toBe('first');
  });

  test('фраза просит ещё что-то словами (теги: «терраса» при заведении «Терраса») — первыми, а не вместо всех террас', () => {
    expect(nameMatchMode(full, { intent: intentOf({ tags: ['терраса'] }), hasMenuTerm: false })).toBe('first');
  });

  test('название — общее слово («Бар» на «бар») — первыми, а не вместо всех баров', () => {
    expect(nameMatchMode({ level: 3, generic: true }, { intent: intentOf({ category: 'Бар' }), hasMenuTerm: false })).toBe('first');
  });

  test('модель не ответила (запасной путь) — первыми', () => {
    expect(nameMatchMode(full, { intent: null, hasMenuTerm: false })).toBe('first');
  });
});

describe('nameMatchMode — начало названия и опечатка', () => {
  test.each([['начало', prefix], ['опечатка', typo]])('%s при пустом разборе («tid», «tidem») — только совпавшие', (_, match) => {
    expect(nameMatchMode(match, { intent: intentOf(), hasMenuTerm: false })).toBe('only');
    expect(nameMatchMode(match, { intent: intentOf({ sort: 'distance' }), hasMenuTerm: false })).toBe('only');
  });

  test.each([
    ['тип («кафе»)', { category: 'Кафе' }, false],
    ['город («минск»)', { location: 'Минск' }, false],
    ['блюдо («андердог»)', { dish: 'андердог' }, true],
    ['теги', { tags: ['терраса'] }, false],
    ['ужин', { meal_type: 'dinner' }, false],
  ])('разбор с условием — %s — только спасение от пустой выдачи', (_, extra, hasMenuTerm) => {
    expect(nameMatchMode(prefix, { intent: intentOf(extra), hasMenuTerm })).toBe('rescue');
    expect(nameMatchMode(typo, { intent: intentOf(extra), hasMenuTerm })).toBe('rescue');
  });

  test('модель не ответила — спасение от пустой выдачи', () => {
    expect(nameMatchMode(prefix, { intent: null, hasMenuTerm: false })).toBe('rescue');
  });
});

describe('nameMatchMode — нет совпадения', () => {
  test('без совпадения режима нет — обычная выдача', () => {
    expect(nameMatchMode(null, { intent: intentOf(), hasMenuTerm: false })).toBeNull();
    expect(nameMatchMode({ level: 0, generic: false }, { intent: intentOf(), hasMenuTerm: false })).toBeNull();
  });
});
