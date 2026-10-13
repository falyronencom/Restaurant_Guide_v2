/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сторож: отказы партнёру на действиях с карточкой — по-русски и из одного
 * места (решение Координатора 13.10.2026).
 *
 * Приложение показывает текст сервера как есть, а уже установленные сборки
 * (iPhone не пересобирается до запуска) другого не покажут. Поэтому правило
 * держат две проверки:
 *
 *   1. Каждый `new AppError(` в services/establishmentService.js берёт текст
 *      из constants/establishmentRefusals.js. Отказ, написанный строкой прямо
 *      в сервисе, — это отказ, который никто не прочёл как текст для партнёра:
 *      так в нём и оказывался английский.
 *   2. В самих текстах нет латиницы, кроме названий форматов файлов.
 *
 * Что поиск по исходнику не ослеп, держит якорь: тот же разбор обязан найти
 * нарушения в образце, где они заведомо есть. Как выключить сторож, не изменив
 * итог прогона? Только расширив список разрешённой латиницы или переписав
 * разбор — обе правки видны в коде рядом с правилом.
 *
 * Дословные формулировки здесь не проверяются — их держат тесты через
 * настоящие маршруты (integration/establishment-refusal-texts.test.js).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { ESTABLISHMENT_REFUSALS } from '../../constants/establishmentRefusals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_FILE = resolve(__dirname, '../../services/establishmentService.js');

/** Латиница, которой можно быть в тексте партнёра: названия форматов файлов. */
const ALLOWED_LATIN = ['JPG', 'PNG', 'WebP', 'HEIC', 'PDF'];

/** Слова латиницей, оставшиеся в тексте после разрешённых. */
const latinWords = (text) =>
  ALLOWED_LATIN.reduce((rest, word) => rest.split(word).join(''), text).match(/[A-Za-z]+/g) ?? [];

/**
 * Тексты-функции и аргументы, с которыми их зовёт сервис. Функция, которой
 * здесь нет, не проверена — это отдельная проверка ниже, а не молчаливый пропуск.
 */
const CALLS = {
  photoLimit: [['interior', 30], ['menu', 30]],
  incomplete: [
    [['name', 'city', 'address', 'coordinates', 'categories', 'cuisines', 'working_hours']],
    // Поле, которого нет в списке названий, не должно выйти к партнёру по-английски.
    [['some_future_field']],
  ],
};

const texts = () => Object.entries(ESTABLISHMENT_REFUSALS).flatMap(([key, value]) => {
  if (typeof value === 'string') return [[key, value]];
  return (CALLS[key] ?? []).map((args) => [`${key}(${JSON.stringify(args)})`, value(...args)]);
});

/** Первый аргумент каждого `new AppError(` — до первой запятой. */
const firstArguments = (source) =>
  [...source.matchAll(/new AppError\(\s*([^,]*)/g)].map((match) => match[1].trim());

/**
 * Текст из списка — это ровно его член или вызов члена: `ESTABLISHMENT_REFUSALS.x`
 * или `ESTABLISHMENT_REFUSALS.f(…`. Склейка `ESTABLISHMENT_REFUSALS.x + ' …'`
 * уже не текст из списка.
 */
const FROM_REFUSALS = /^ESTABLISHMENT_REFUSALS\.\w+(\(.*)?$/;

const notFromRefusals = (source) =>
  firstArguments(source).filter((argument) => !FROM_REFUSALS.test(argument));

describe('Отказы партнёру на действиях с карточкой', () => {
  it('каждый текст — по-русски: есть кириллица, нет латиницы, кроме названий форматов', () => {
    const all = texts();
    // Сторож перебора: тексты нашлись (25 строк и 4 вызова функций на 13.10.2026).
    expect(all.length).toBeGreaterThanOrEqual(25);

    const offenders = all
      .filter(([, text]) => !/[А-Яа-яЁё]/.test(text) || latinWords(text).length > 0)
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });

  it('каждый текст-функция вызван здесь с аргументами сервиса', () => {
    const functions = Object.entries(ESTABLISHMENT_REFUSALS)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key);
    expect(functions.filter((key) => !CALLS[key])).toEqual([]);
  });

  it('якорь: разбор исходника видит отказ строкой, шаблоном, константой и склейкой', () => {
    const sample = [
      "  throw new AppError('Access denied', 403, 'FORBIDDEN');",
      '  throw new AppError(',
      '    `Coordinates (${lat}, ${lon}) are outside`,',
      '    422,',
      "    'COORDINATES_CITY_MISMATCH',",
      '  );',
      "  throw new AppError(SOME_MESSAGE, 422, 'X');",
      "  throw new AppError(ESTABLISHMENT_REFUSALS.notFound + ' (archived)', 404, 'X');",
      "  throw new AppError(ESTABLISHMENT_REFUSALS.notFound, 404, 'ESTABLISHMENT_NOT_FOUND');",
      "  throw new AppError(ESTABLISHMENT_REFUSALS.photoLimit('interior', 30), 403, 'X');",
    ].join('\n');
    expect(notFromRefusals(sample)).toEqual([
      "'Access denied'",
      '`Coordinates (${lat}',
      'SOME_MESSAGE',
      "ESTABLISHMENT_REFUSALS.notFound + ' (archived)'",
    ]);
  });

  it('каждый new AppError в сервисе карточки берёт текст из ESTABLISHMENT_REFUSALS', () => {
    const source = readFileSync(SERVICE_FILE, 'utf8');
    // Сторож разбора: отказы в файле нашлись (51 на 13.10.2026).
    expect(firstArguments(source).length).toBeGreaterThanOrEqual(45);
    expect(notFromRefusals(source)).toEqual([]);
  });
});
