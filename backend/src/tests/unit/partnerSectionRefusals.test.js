/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сторож: отказы партнёру вне самой карточки — по-русски и из одного места
 * (решение Координатора 13.10.2026; карточку сторожит establishmentRefusals.test.js).
 *
 * Правило держат две проверки:
 *
 *   1. Каждый отказ, который отправляет охраняемый файл, берёт текст из
 *      constants/partnerSectionRefusals.js: и `new AppError(…)`, и ответ
 *      маршрута `res.status(…).json({ message: … })`. Текст, написанный строкой
 *      прямо в коде, — это текст, который никто не прочёл как текст для
 *      партнёра: так в нём и оказывался английский.
 *   2. В самих текстах нет латиницы, кроме названий форматов файлов.
 *
 * Что поиск по исходнику не ослеп, держит якорь: тот же разбор обязан найти
 * нарушения в образце, где они заведомо есть, и число найденных отказов в
 * каждом файле не меньше известного.
 *
 * Дословные формулировки здесь не проверяются — их держат тесты через
 * настоящие маршруты (integration/partner-*-refusal-texts.test.js).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as REFUSALS from '../../constants/partnerSectionRefusals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = (relative) => readFileSync(resolve(__dirname, '../..', relative), 'utf8');

/** Латиница, которой можно быть в тексте партнёра: названия форматов файлов. */
const ALLOWED_LATIN = ['JPG', 'PNG', 'WebP', 'HEIC', 'PDF'];

const latinWords = (text) =>
  ALLOWED_LATIN.reduce((rest, word) => rest.split(word).join(''), text).match(/[A-Za-z]+/g) ?? [];

/** Все тексты модуля: группы — объекты строк. */
const texts = () => Object.entries(REFUSALS).flatMap(([group, members]) =>
  Object.entries(members).map(([key, text]) => [`${group}.${key}`, text]));

/** Первый аргумент каждого `new AppError(` — до первой запятой. */
const appErrorTexts = (code) =>
  [...code.matchAll(/new AppError\(\s*([^,]*)/g)].map((match) => match[1].trim());

/**
 * Значение каждого `message:` в ответе маршрута — до запятой, `}` или конца
 * строки. Строку или шаблон с запятой или `}` внутри это обрежет, но обрезанное
 * всё равно не член группы — нарушение не потеряется.
 */
const messageTexts = (code) =>
  [...code.matchAll(/\bmessage:\s*([^,}\n\r]*)/g)].map((match) => match[1].trim());

/**
 * Текст из списка — это ровно член группы: `UPLOAD_REFUSALS.x`. Склейка
 * `UPLOAD_REFUSALS.x + ' …'` уже не текст из списка.
 */
const fromGroup = (group) => new RegExp(`^${group}\\.\\w+$`);

const notFrom = (group, values, allowed = []) => {
  const rest = [...allowed];
  return values.filter((value) => {
    if (fromGroup(group).test(value)) return false;
    const i = rest.indexOf(value);
    if (i === -1) return true;
    rest.splice(i, 1);
    return false;
  });
};

describe('Отказы партнёру вне карточки: тексты', () => {
  it('каждый текст — по-русски: есть кириллица, нет латиницы, кроме названий форматов', () => {
    const all = texts();
    // Сторож перебора: тексты нашлись (8 на 13.10.2026 в загрузке).
    expect(all.length).toBeGreaterThanOrEqual(8);

    const offenders = all
      .filter(([, text]) => typeof text !== 'string' || !/[А-Яа-яЁё]/.test(text) || latinWords(text).length > 0)
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });
});

describe('Отказы партнёру вне карточки: исходники', () => {
  it('якорь: разбор видит отказ строкой, шаблоном, константой и склейкой', () => {
    const sample = [
      "  return res.status(400).json({ success: false, message: 'No file uploaded', error: { code: 'X' } });",
      '  return res.status(422).json({',
      '    message: `Limit ${limit}`,',
      '  });',
      '  return res.status(422).json({ message: SOME_TEXT });',
      "  return res.status(422).json({ message: UPLOAD_REFUSALS.fileRequired + ' (1)' });",
      '  return res.status(422).json({ message: UPLOAD_REFUSALS.fileRequired });',
      "  next(new AppError('Failed', 500, 'X'));",
      "  next(new AppError(UPLOAD_REFUSALS.uploadFailed, 500, 'X'));",
    ].join('\n');
    expect(notFrom('UPLOAD_REFUSALS', messageTexts(sample))).toEqual([
      "'No file uploaded'",
      '`Limit ${limit',
      'SOME_TEXT',
      "UPLOAD_REFUSALS.fileRequired + ' (1)'",
    ]);
    expect(notFrom('UPLOAD_REFUSALS', appErrorTexts(sample))).toEqual(["'Failed'"]);
  });

  it('загрузка в мастере (tempMediaRoutes.js): каждый отказ — из UPLOAD_REFUSALS', () => {
    const code = source('routes/v1/tempMediaRoutes.js');
    const messages = messageTexts(code);
    // Сторож разбора: ответы с текстом нашлись (10 на 13.10.2026).
    expect(messages.length).toBeGreaterThanOrEqual(10);
    // Одно исключение, и только одно: прочие отказы разбора формы multer
    // (Too many fields и т.п.) отдаются его текстом — запрос злоупотребления,
    // клиенты так не шлют; эти тексты держит multipart-limits.test.js.
    expect(notFrom('UPLOAD_REFUSALS', messages, ['error.message'])).toEqual([]);
    expect(appErrorTexts(code).length).toBeGreaterThanOrEqual(1);
    expect(notFrom('UPLOAD_REFUSALS', appErrorTexts(code))).toEqual([]);
  });
});
