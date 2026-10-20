/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сторож: отказы партнёру вне самой карточки — по-русски и из одного места
 * (решение Координатора 13.10.2026; у отказов по карточке свой сторож —
 * establishmentRefusals.test.js из прохода по карточке, ветка
 * claude/nice-meitner-ae8d57 на 13.10.2026).
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
  // Предел облака — число из настройки (config/cloudinary.js): Free и Plus.
  'UPLOAD_REFUSALS.pdfOverCloudLimit': [[10], [20]],
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
 * всё равно не член группы. Чего этот разбор не видит — продолжения значения на
 * следующей строке (`+ '…'`, `|| '…'`) и сокращённой записи `{ message }`, —
 * то запрещает отдельная проверка ниже (unreadMessageShapes).
 */
const messageTexts = (code) =>
  [...code.matchAll(/\bmessage:\s*([^,}\n\r]*)/g)].map((match) => match[1].trim());

/**
 * Формы `message`, которые messageTexts прочесть не может: сокращённая запись
 * `{ message }` и значение, продолженное на следующей строке оператором.
 */
const unreadMessageShapes = (code) => {
  const lines = code.split(/\r?\n/);
  const shorthand = lines.filter((line) => /[{,]\s*message\s*[,}]/.test(line) || /^\s*message,?\s*$/.test(line));
  const continued = lines
    .map((line, i) => [line, lines[i + 1] ?? ''])
    .filter(([line, next]) => /\bmessage:/.test(line) && /^\s*(\+|\|\||\?\?|\?|:)/.test(next))
    .map(([line, next]) => `${line.trim()} ⏎ ${next.trim()}`);
  return [...shorthand.map((line) => line.trim()), ...continued];
};

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
    // Сторож перебора: тексты нашлись (9 загрузки + 2 вызова предела облака
    // + 3 брони + 9 вызовов статуса + 11 акций + 1 вызов лимита на 19.10.2026;
    // 33 на 18.10.2026, 27 на 13.10.2026).
    expect(all.length).toBeGreaterThanOrEqual(35);

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

  it('якорь: формы message, которые разбор не читает, видны отдельной проверке', () => {
    const sample = [
      '  return res.status(400).json({ success: false, message });',
      '  return res.status(400).json({',
      '    message: UPLOAD_REFUSALS.fileRequired',
      "      + ' (English tail)',",
      '  });',
      '  return res.status(422).json({ message: UPLOAD_REFUSALS.fileRequired });',
    ].join('\n');
    // Разбор значений такие формы пропускает — потому и нужна эта проверка.
    expect(notFrom('UPLOAD_REFUSALS', messageTexts(sample))).toEqual([]);
    expect(unreadMessageShapes(sample)).toEqual([
      'return res.status(400).json({ success: false, message });',
      "message: UPLOAD_REFUSALS.fileRequired ⏎ + ' (English tail)',",
    ]);
  });

  // Проверка поля type (express-validator, ответ «Validation failed» с полями)
  // этим разбором не видна и в проход не входила: приложение поле шлёт всегда.
  it('загрузка в мастере (tempMediaRoutes.js): ответы отказа маршрута и AppError — из UPLOAD_REFUSALS', () => {
    const code = source('routes/v1/tempMediaRoutes.js');
    expect(unreadMessageShapes(code)).toEqual([]);
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

  // Медиа карточки отказывают файлу по тем же правилам, что мастер, — его
  // текстами (с 19.10.2026; до того — английский, сайт переводил по коду).
  // Отказы сервиса медиа (mediaService.js) этим разбором не держатся: в файле
  // и другие действия с медиа, их тексты проход не трогал; формулировки
  // загрузки держит integration/upload-module-hardening.test.js.
  it('медиа карточки (mediaRoutes.js): ответы отказа загрузчика — из UPLOAD_REFUSALS', () => {
    const code = source('routes/v1/mediaRoutes.js');
    expect(unreadMessageShapes(code)).toEqual([]);
    const messages = messageTexts(code);
    // Сторож разбора: ответы с текстом нашлись (4 на 19.10.2026).
    expect(messages.length).toBeGreaterThanOrEqual(4);
    // То же исключение, что у мастера: прочие отказы разбора формы multer.
    expect(notFrom('UPLOAD_REFUSALS', messages, { allowed: ['error.message'] })).toEqual([]);
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
    // Русских строк прямо в коде — не больше гостевых (14 в оформлении брони:
    // 13 и «Учётка отключена — забронировать нельзя» — бронь, отправленная во
    // время удаления учётки, 19.10.2026): партнёрский отказ, вписанный строкой
    // обратно, их число увеличит.
    expect(found.filter(cyrillicLiteral).length).toBeLessThanOrEqual(14);
  });

  it('акции (promotionService.js, promotionController.js, promotionRoutes.js): каждый отказ — из PROMOTION_REFUSALS', () => {
    const service = appErrorTexts(source('services/promotionService.js'));
    // Сторож разбора: отказы нашлись (11 на 13.10.2026).
    expect(service.length).toBeGreaterThanOrEqual(11);
    expect(notFrom('PROMOTION_REFUSALS', service)).toEqual([]);

    expect(unreadMessageShapes(source('controllers/promotionController.js'))).toEqual([]);
    const controller = messageTexts(source('controllers/promotionController.js'));
    // Ответы с текстом нашлись (2 отказа на 13.10.2026).
    expect(controller.length).toBeGreaterThanOrEqual(2);
    expect(notFrom('PROMOTION_REFUSALS', controller)).toEqual([]);
    // Отказы полей акции — AppError из контроллера, до сервиса и облака
    // (4 на 18.10.2026: название, даты, позиция, описание и условия).
    const controllerRefusals = appErrorTexts(source('controllers/promotionController.js'));
    expect(controllerRefusals.length).toBeGreaterThanOrEqual(4);
    expect(notFrom('PROMOTION_REFUSALS', controllerRefusals)).toEqual([]);

    // Фильтр картинки в маршруте: до 16.10.2026 он отказывал английской
    // строкой, которую партнёр не видел вовсе — наружу уходило 500.
    const routes = source('routes/v1/promotionRoutes.js');
    expect(unreadMessageShapes(routes)).toEqual([]);
    expect(notFrom('PROMOTION_REFUSALS', messageTexts(routes))).toEqual([]);
    const routeRefusals = appErrorTexts(routes);
    // Отказ фильтра нашёлся (1 на 16.10.2026).
    expect(routeRefusals.length).toBeGreaterThanOrEqual(1);
    expect(notFrom('PROMOTION_REFUSALS', routeRefusals)).toEqual([]);
  });
});
