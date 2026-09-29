/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: buildSearchQueryLog
 *
 * Что именно из запроса пользователя попадает в лог. Решение вынесено в чистую
 * функцию ровно затем, чтобы это проверялось напрямую, а не через подмену
 * логгера: побочный эффект легко «проверить» так, что тест останется зелёным
 * при вернувшихся в лог словах.
 *
 * Правило: слова пользователя пишутся ТОЛЬКО там, где по ним действуют — когда
 * выдача пуста. Ноль результатов означает дыру (нет синонима, нет данных,
 * промахнулся разбор), и чинить её без самой фразы нельзя. Удачный запрос не
 * учит почти ничему — по нему хватает формы разбора и счётчиков.
 */

import { buildSearchQueryLog } from '../../services/smartSearchService.js';

const intentOf = (extra = {}) => ({
  dish: null, category: null, cuisine: null, price_max: null,
  meal_type: null, location: null, sort: null, tags: [], error: null, ...extra,
});

/** Разбор, который дословно повторяет фразу — так делает живая модель. */
const echoingIntent = () => intentOf({
  dish: 'пицца',
  price_max: 20,
  tags: ['пицца за 20 рублей'],
});

const base = {
  rawQuery: 'пицца за 20 рублей',
  queryHash: 'abc123',
  intent: echoingIntent(),
  isFallback: false,
  fromCache: false,
  hasExplicitFilters: true,
};

describe('buildSearchQueryLog — слова пользователя', () => {
  test('при непустой выдаче фразы в логе нет', () => {
    const line = buildSearchQueryLog({ ...base, resultCount: 7 });

    expect(line.query).toBeUndefined();
    expect(line.queryHash).toBe('abc123');
    expect(line.resultCount).toBe(7);
  });

  test('при непустой выдаче нет и полного разбора — он повторяет фразу', () => {
    // Ключевой тест правки. Убрать `query`, оставив `intent`, было бы
    // видимостью: живая модель кладёт фразу целиком в `tags`
    // (прод 07.09: tags: ["пицца за 20 рублей"]).
    const line = buildSearchQueryLog({ ...base, resultCount: 7 });

    expect(line.intent).toBeUndefined();
    expect(JSON.stringify(line)).not.toContain('пицца за 20 рублей');
    expect(JSON.stringify(line)).not.toContain('пицца');
  });

  test('при пустой выдаче фраза и полный разбор пишутся', () => {
    // Здесь они действенны: ноль результатов — это то, что чинят.
    const line = buildSearchQueryLog({ ...base, resultCount: 0 });

    expect(line.query).toBe('пицца за 20 рублей');
    expect(line.intent).toEqual(echoingIntent());
  });
});

describe('buildSearchQueryLog — форма разбора', () => {
  test('несёт только закрытые словари, признаки и счётчики', () => {
    const line = buildSearchQueryLog({
      ...base,
      intent: intentOf({
        dish: 'капучино',
        category: 'Кофейня',
        cuisine: ['Итальянская'],
        price_max: 15,
        sort: 'price_asc',
        tags: ['капучино', 'рядом'],
      }),
      resultCount: 3,
    });

    expect(line.intentShape).toEqual({
      hasDish: true,
      category: 'Кофейня',
      cuisine: ['Итальянская'],
      priceMax: 15,
      sort: 'price_asc',
      tagCount: 2,
      features: [],
    });
    // Блюдо и теги — слова пользователя, поэтому сведены к признаку и счётчику.
    expect(JSON.stringify(line.intentShape)).not.toContain('капучино');
    expect(JSON.stringify(line.intentShape)).not.toContain('рядом');
  });

  test('удобства из тегов — ключами канона, сами слова тегов в строку не попадают', () => {
    // С 29.09.2026 «уютное место» даёт выдачу, а не ноль, и фразы в логе больше
    // нет. Спрос на слова обстановки остаётся виден без слов: tagCount больше,
    // чем удобств, понятых из тегов.
    const line = buildSearchQueryLog({
      ...base,
      intent: intentOf({ tags: ['уютное', 'с террасой'] }),
      resultCount: 19,
    });

    expect(line.intentShape.tagCount).toBe(2);
    expect(line.intentShape.features).toEqual(['terrace']);
    expect(JSON.stringify(line)).not.toContain('уютное');
    expect(JSON.stringify(line)).not.toContain('террас');
  });

  test('без разбора (отказ AI) форма пустая, счётчики на месте', () => {
    const line = buildSearchQueryLog({
      ...base, intent: null, resultCount: 4, isFallback: true,
    });

    expect(line.intentShape).toBeNull();
    expect(line.fallback).toBe(true);
    expect(line.query).toBeUndefined();
  });

  test('совпадение по названию — уровень, режим и число совпавших, без названий и без слов', () => {
    const line = buildSearchQueryLog({
      ...base,
      rawQuery: 'Tiden',
      intent: intentOf(),
      resultCount: 1,
      nameMatch: { level: 3, mode: 'only', shown: 1 },
    });

    expect(line.nameMatch).toEqual({ level: 3, mode: 'only', shown: 1 });
    expect(JSON.stringify(line).toLowerCase()).not.toContain('tiden');
  });

  test('без совпадения по названию поле есть и равно null', () => {
    const line = buildSearchQueryLog({ ...base, resultCount: 3 });

    expect(line.nameMatch).toBeNull();
  });

  test('счётчики и флаги остаются при любой выдаче — аналитика не пострадала', () => {
    for (const resultCount of [0, 12]) {
      const line = buildSearchQueryLog({ ...base, resultCount, fromCache: true });

      expect(line.queryHash).toBe('abc123');
      expect(line.resultCount).toBe(resultCount);
      expect(line.fromCache).toBe(true);
      expect(line.explicitFilters).toBe(true);
      expect(typeof line.timestamp).toBe('string');
    }
  });
});
