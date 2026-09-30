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
const prefix = { level: 2, generic: false, wordIds: [], wordGeneric: false };
const typo = { level: 1, generic: false, wordIds: [], wordGeneric: false };
/** Целое слово названия: «Pigeon» у Le Pigeon. */
const word = { level: 2, generic: false, wordIds: ['le-pigeon'], wordGeneric: false };

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

  test('слово обстановки в тегах условием не считается — выдачу оно не режет (29.09.2026)', () => {
    expect(isIntentEmpty(intentOf({ tags: ['уютное'] }))).toBe(true);
    expect(isIntentEmpty(intentOf({ tags: ['уютное', 'с видом'] }))).toBe(true);
    expect(isIntentEmpty(intentOf({ tags: ['уютное', 'терраса'] }))).toBe(false);
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

  test('слово обстановки («уютный Tiden») ничего не просит — только совпавшие', () => {
    // С 29.09.2026 «уютное» выдачу не режет: «первыми» показало бы после TIDEN
    // весь город.
    expect(nameMatchMode(full, { intent: intentOf({ tags: ['уютное'] }), hasMenuTerm: false })).toBe('only');
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

  test.each([['начало', prefix], ['опечатка', typo]])('%s при одном слове обстановки в тегах — как при пустом разборе, только совпавшие', (_, match) => {
    expect(nameMatchMode(match, { intent: intentOf({ tags: ['уютное'] }), hasMenuTerm: false })).toBe('only');
  });
});

describe('nameMatchMode — целое слово названия (решение Координатора 30.09.2026)', () => {
  // Разборы — те, что модель давала 30.09 на целые слова названий прода
  // (docs/handoffs/name_part_vs_dish_20260930/name_parts_parse_probe.*).
  test('модель ничего не прочла («Pigeon» в 15 разборах из 20) — только совпавшие, как прежде', () => {
    expect(nameMatchMode(word, { intent: intentOf(), hasMenuTerm: false })).toBe('only');
  });

  test.each([
    ['блюдо «голубь»', { dish: 'голубь', dish_variants: ['pigeon'] }, true],
    ['блюдо «голубцы»', { dish: 'голубцы', dish_variants: ['pigeon'] }, true],
    ['город («Zalkind»)', { location: 'Минск' }, false],
    ['тип («Brasserie»)', { category: 'Ресторан' }, false],
    ['удобство', { tags: ['терраса'] }, false],
  ])('модель прочла %s — заведение первым, дальше её выдача', (_, extra, hasMenuTerm) => {
    expect(nameMatchMode(word, { intent: intentOf(extra), hasMenuTerm })).toBe('first');
  });

  test('модель не ответила (запасной путь) — первым', () => {
    expect(nameMatchMode(word, { intent: null, hasMenuTerm: false })).toBe('first');
  });

  test('фраза — общее слово («кафе» у urban dzen cafe, «минск» у SFB Minsk) — только спасение, как у начала', () => {
    const generic = { ...word, wordGeneric: true };
    expect(nameMatchMode(generic, { intent: intentOf({ category: 'Кафе' }), hasMenuTerm: false })).toBe('rescue');
    expect(nameMatchMode(generic, { intent: intentOf({ location: 'Минск' }), hasMenuTerm: false })).toBe('rescue');
    expect(nameMatchMode(generic, { intent: null, hasMenuTerm: false })).toBe('rescue');
  });

  test('начало без целого слова («Pige») при том же разборе — по-прежнему только спасение', () => {
    expect(nameMatchMode(prefix, { intent: intentOf({ dish: 'голубь' }), hasMenuTerm: true })).toBe('rescue');
  });
});

describe('nameMatchMode — нет совпадения', () => {
  test('без совпадения режима нет — обычная выдача', () => {
    expect(nameMatchMode(null, { intent: intentOf(), hasMenuTerm: false })).toBeNull();
    expect(nameMatchMode({ level: 0, generic: false }, { intent: intentOf(), hasMenuTerm: false })).toBeNull();
  });
});
