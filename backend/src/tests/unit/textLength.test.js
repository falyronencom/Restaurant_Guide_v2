/* eslint-env jest */
/**
 * Unit: utils/textLength.js — длина текста, как её считает PostgreSQL
 * (varchar(n) держит n знаков — code points).
 */

import { fitsVarchar, longerThan } from '../../utils/textLength.js';

const HEART = '❤️'; // U+2764 U+FE0F — два знака
const BEER = '🍺'; // U+1F37A — один знак, две единицы UTF-16

describe('longerThan', () => {
  test('считает знаки: знак вариации — знак, суррогатная пара — один', () => {
    expect(longerThan(HEART.repeat(2), 3)).toBe(true);
    expect(longerThan(HEART.repeat(2), 4)).toBe(false);
    expect(longerThan(BEER.repeat(4), 3)).toBe(true);
    expect(longerThan(BEER.repeat(4), 4)).toBe(false);
  });
});

describe('fitsVarchar', () => {
  test('граница max — по знакам базы', () => {
    const fits = fitsVarchar(4);
    expect(fits(HEART.repeat(2))).toBe(true);
    expect(fits(`${HEART.repeat(2)}а`)).toBe(false);
    expect(fits(BEER.repeat(4))).toBe(true);
    expect(fits(BEER.repeat(5))).toBe(false);
  });

  test('граница min', () => {
    const fits = fitsVarchar(10, { min: 2 });
    expect(fits('а')).toBe(false);
    expect(fits('аб')).toBe(true);
    expect(fits(BEER)).toBe(false);
    expect(fits(HEART)).toBe(true);
    expect(fitsVarchar(10)('')).toBe(true);
    expect(fitsVarchar(10, { min: 1 })('')).toBe(false);
  });

  test.each([
    ['массив', ['а', 'б']],
    ['число', 5],
    ['null', null],
    ['объект', { a: 'б' }],
  ])('не строка (%s) — не помещается', (_label, value) => {
    expect(fitsVarchar(255)(value)).toBe(false);
  });
});
