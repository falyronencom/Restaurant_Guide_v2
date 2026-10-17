/* eslint-env jest */
/**
 * utils/userName.js — the one name rule (decision of the Coordinator
 * 17.10.2026, В4) and the provider name that never fails a login.
 */

import {
  NAME_REFUSALS,
  PROVIDER_NAME_FALLBACK,
  checkUserName,
  normalizeUserName,
  providerDisplayName,
} from '../../utils/userName.js';

describe('checkUserName', () => {
  test.each([
    'Анна',
    'Ян',
    'Алеся Ўладзіслаўна',
    'Ёжик Ёлкин',
    "O'Brien",
    'Мар’яна',
    "Мария-Анна О'Брайен-Иванова",
    'Jean-Luc Picard',
    'Zoë',
    '李小龍',
    'А'.repeat(50),
  ])('takes %s', (name) => {
    expect(checkUserName(name)).toEqual({ name });
  });

  test.each([
    ['', 'NAME_EMPTY'],
    ['   ', 'NAME_EMPTY'],
    [undefined, 'NAME_EMPTY'],
    [42, 'NAME_EMPTY'],
    ['А', 'NAME_LENGTH'],
    ['А'.repeat(51), 'NAME_LENGTH'],
    ['Анна, К.', 'NAME_CHARS'],
    ['Иван2', 'NAME_CHARS'],
    ['Анна!', 'NAME_CHARS'],
    ['С=3', 'NAME_CHARS'],
    ['-Анна', 'NAME_CHARS'],
    ['Анна-', 'NAME_CHARS'],
    ["'Анна", 'NAME_CHARS'],
    ['Анна--Мария', 'NAME_CHARS'],
    ['Анна -Мария', 'NAME_CHARS'],
    ['Анна_Мария', 'NAME_CHARS'],
    ['Анна\u200bМария', 'NAME_CHARS'],
    ['Х-у-й', 'NAME_PROFANE'],
    ['х у й', 'NAME_PROFANE'],
    ["Х'у'й", 'NAME_PROFANE'],
    ['Cyka', 'NAME_PROFANE'],
    ['Мудак Иванов', 'NAME_PROFANE'],
  ])('refuses %j: %s', (name, code) => {
    expect(checkUserName(name)).toEqual({ code, message: NAME_REFUSALS[code] });
  });

  test('stores the name normalized', () => {
    expect(checkUserName('  Анна \t  Мария  ')).toEqual({ name: 'Анна Мария' });
    expect(checkUserName('Анна\u2011Мария')).toEqual({ name: 'Анна-Мария' });
    expect(checkUserName('И\u0306осиф')).toEqual({ name: 'Йосиф' });
  });

  test('the refusals are Russian', () => {
    for (const text of Object.values(NAME_REFUSALS)) {
      expect(text).toMatch(/^[А-ЯЁ][а-яё0-9 ,-]+$/);
    }
  });
});

describe('normalizeUserName', () => {
  test('trims and collapses whitespace', () => {
    expect(normalizeUserName(' a \n b ')).toBe('a b');
  });
});

describe('providerDisplayName', () => {
  test.each([
    ['Иван Петров', 'Иван Петров'],
    ['Анна, К.', 'Анна К'],
    ['ivan.petrov93', 'ivan petrov'],
    ['john_doe', 'john doe'],
    ["--O'Brien--", "O'Brien"],
    ['Мария-Анна О\'Брайен-Иванова Длиннаяфамилия Ещё Одна', "Мария-Анна О'Брайен-Иванова Длиннаяфамилия Ещё"],
    ['Б'.repeat(60), 'Б'.repeat(50)],
  ])('cleans %j to %j', (raw, name) => {
    expect(providerDisplayName(raw)).toBe(name);
    expect(checkUserName(name)).toEqual({ name });
  });

  test.each([
    ['x'],
    ['!!!'],
    ['12345'],
    [''],
    [undefined],
    ['Хуйло Петров'],
    ['pizda'],
  ])('replaces %j with the neutral name', (raw) => {
    expect(providerDisplayName(raw)).toBe(PROVIDER_NAME_FALLBACK);
  });

  test('the neutral name passes the rule', () => {
    expect(checkUserName(PROVIDER_NAME_FALLBACK)).toEqual({ name: PROVIDER_NAME_FALLBACK });
  });
});
