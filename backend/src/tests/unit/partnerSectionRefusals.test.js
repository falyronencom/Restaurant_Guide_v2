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
 *      партнёра: так в нём и оказывался английский. Исключения названы
 *      поимённо и посчитаны — каждое со своей причиной.
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

/** Статусы брони — ровно список CHECK таблицы bookings (migrations/021_booking_system.sql). */
const BOOKING_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'expired', 'no_show', 'completed'];

/**
 * Тексты-функции и аргументы, с которыми их проверять. Функция, которой здесь
 * нет, не проверена — это отдельная проверка ниже, а не молчаливый пропуск.
 */
const CALLS = {
  'BOOKING_REFUSALS.statusChanged': [...BOOKING_STATUSES, 'some_future_status', 'constructor'].map((s) => [s]),
  'PROMOTION_REFUSALS.activeLimit': [[3]],
};

/** Все тексты модуля: строки как есть, функции — с аргументами из CALLS. */
const texts = () => Object.entries(REFUSALS).flatMap(([group, members]) =>
  Object.entries(members).flatMap(([key, value]) => {
    const name = `${group}.${key}`;
    if (typeof value !== 'function') return [[name, value]];
    return (CALLS[name] ?? []).map((args) => [`${name}(${JSON.stringify(args)})`, value(...args)]);
  }));

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
 * Текст из списка — это ровно член группы или вызов члена: `GROUP.x`,
 * `GROUP.f(…)`. Склейка `GROUP.x + ' …'` уже не текст из списка.
 */
const fromGroup = (group) => new RegExp(`^${group}\\.\\w+(\\(.*\\))?$`);

/** Строка или шаблон с кириллицей прямо в коде. */
const cyrillicLiteral = (value) => /^['`]/.test(value) && /[А-Яа-яЁё]/.test(value);

/**
 * Значения не из группы. `allowed` — поимённые исключения, каждое снимается
 * один раз (второе такое же уже нарушение); `cyrillic` — пропускать русские
 * строки прямо в коде (только там, где это гостевые тексты, а не партнёрские).
 */
const notFrom = (group, values, { allowed = [], cyrillic = false } = {}) => {
  const rest = [...allowed];
  return values.filter((value) => {
    if (fromGroup(group).test(value)) return false;
    if (cyrillic && cyrillicLiteral(value)) return false;
    const i = rest.indexOf(value);
    if (i === -1) return true;
    rest.splice(i, 1);
    return false;
  });
};

describe('Отказы партнёру вне карточки: тексты', () => {
  it('каждый текст — по-русски: есть кириллица, нет латиницы, кроме названий форматов', () => {
    const all = texts();
    // Сторож перебора: тексты нашлись (8 загрузки + 3 брони + 9 вызовов статуса
    // + 6 акций + 1 вызов лимита на 13.10.2026).
    expect(all.length).toBeGreaterThanOrEqual(27);

    const offenders = all
      .filter(([, text]) => typeof text !== 'string' || !/[А-Яа-яЁё]/.test(text) || latinWords(text).length > 0)
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });

  it('каждый текст-функция вызван здесь с аргументами', () => {
    const functions = Object.entries(REFUSALS).flatMap(([group, members]) =>
      Object.entries(members).filter(([, v]) => typeof v === 'function').map(([key]) => `${group}.${key}`));
    expect(functions.filter((name) => !CALLS[name])).toEqual([]);
  });

  it('у каждого статуса брони из базы — своя фраза, не общая', () => {
    const fallback = REFUSALS.BOOKING_REFUSALS.statusChanged('some_future_status');
    const phrases = BOOKING_STATUSES.map((status) => REFUSALS.BOOKING_REFUSALS.statusChanged(status));
    expect(phrases.filter((phrase) => phrase === fallback)).toEqual([]);
    expect(new Set(phrases).size).toBe(BOOKING_STATUSES.length);
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
      "  throw new AppError('Гостю: заведение неактивно', 400, 'X');",
      "  throw new AppError(UPLOAD_REFUSALS.statusChanged(booking.status), 400, 'X');",
    ].join('\n');
    expect(notFrom('UPLOAD_REFUSALS', messageTexts(sample))).toEqual([
      "'No file uploaded'",
      '`Limit ${limit',
      'SOME_TEXT',
      "UPLOAD_REFUSALS.fileRequired + ' (1)'",
    ]);
    expect(notFrom('UPLOAD_REFUSALS', appErrorTexts(sample))).toEqual([
      "'Failed'",
      "'Гостю: заведение неактивно'",
    ]);
    // Русская строка в коде проходит только там, где её пропуск включён явно,
    // и английская не проходит и там.
    expect(notFrom('UPLOAD_REFUSALS', appErrorTexts(sample), { cyrillic: true })).toEqual(["'Failed'"]);
  });

  it('загрузка в мастере (tempMediaRoutes.js): каждый отказ — из UPLOAD_REFUSALS', () => {
    const code = source('routes/v1/tempMediaRoutes.js');
    const messages = messageTexts(code);
    // Сторож разбора: ответы с текстом нашлись (10 на 13.10.2026).
    expect(messages.length).toBeGreaterThanOrEqual(10);
    // Одно исключение, и только одно: прочие отказы разбора формы multer
    // (Too many fields и т.п.) отдаются его текстом — запрос злоупотребления,
    // клиенты так не шлют; эти тексты держит multipart-limits.test.js.
    expect(notFrom('UPLOAD_REFUSALS', messages, { allowed: ['error.message'] })).toEqual([]);
    expect(appErrorTexts(code).length).toBeGreaterThanOrEqual(1);
    expect(notFrom('UPLOAD_REFUSALS', appErrorTexts(code))).toEqual([]);
  });

  it('брони (bookingService.js): каждый отказ партнёру — из BOOKING_REFUSALS', () => {
    const found = appErrorTexts(source('services/bookingService.js'));
    // Сторож разбора: отказы нашлись (30 на 13.10.2026: 14 партнёру, 16 гостю).
    expect(found.length).toBeGreaterThanOrEqual(30);
    // Гостевые тексты — по слову Координатора, проход их не трогал: русские
    // тексты оформления брони и ровно три английских текста отмены гостем.
    const guestCancel = [
      "'Booking not found'",
      "'This booking does not belong to you'",
      "`Cannot cancel booking with status '${booking.status}'`",
    ];
    expect(notFrom('BOOKING_REFUSALS', found, { allowed: guestCancel, cyrillic: true })).toEqual([]);
    // Русских строк прямо в коде — не больше гостевых (13 в оформлении брони):
    // партнёрский отказ, вписанный строкой обратно, их число увеличит.
    expect(found.filter(cyrillicLiteral).length).toBeLessThanOrEqual(13);
  });

  it('акции (promotionService.js, promotionController.js): каждый отказ — из PROMOTION_REFUSALS', () => {
    const service = appErrorTexts(source('services/promotionService.js'));
    // Сторож разбора: отказы нашлись (11 на 13.10.2026).
    expect(service.length).toBeGreaterThanOrEqual(11);
    expect(notFrom('PROMOTION_REFUSALS', service)).toEqual([]);

    const controller = messageTexts(source('controllers/promotionController.js'));
    // Ответы с текстом нашлись (2 отказа на 13.10.2026).
    expect(controller.length).toBeGreaterThanOrEqual(2);
    expect(notFrom('PROMOTION_REFUSALS', controller)).toEqual([]);
  });
});
