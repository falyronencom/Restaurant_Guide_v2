/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: middleware/requestGuard.js
 *
 * Фильтр на входе API: NUL где угодно в запросе → 400 INVALID_FORMAT, номер
 * страницы выше потолка сайта или смещение выше миллиона → 422
 * VALIDATION_ERROR. Ожидания — литералы брифа (10 000 страниц, 1 000 000 строк
 * смещения), границы — парой N / N+1, номер читается так же, как его читают
 * обработчики (parseInt по основанию 10). / Literal expectations, boundaries in
 * N / N+1 pairs, the page read exactly as the handlers read it.
 *
 * NUL собирается в рантайме (String.fromCharCode(0)), не escape-ом в исходнике:
 * инструменты правки раскрывают escape в сырой байт, и проверка молча стала бы
 * проверкой обычной буквы. / NUL is built at runtime, never written as an escape.
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  MAX_PAGE,
  MAX_OFFSET,
  urlHasNul,
  bodyHasNul,
  requestGuard,
} from '../../middleware/requestGuard.js';
import { AppError } from '../../middleware/errorHandler.js';

const NUL = String.fromCharCode(0);

/** Фильтр на поддельном запросе: то, с чем он позвал next (undefined — пропустил). */
function run({ url = '/api/v1/public/establishments', query = {}, body = {} } = {}) {
  const next = jest.fn();
  requestGuard({ originalUrl: url, query, body }, {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0];
}

describe('потолки', () => {
  test('литералы брифа: 10 000 страниц, 1 000 000 строк смещения', () => {
    expect(MAX_PAGE).toBe(10000);
    expect(MAX_OFFSET).toBe(1000000);
  });

  test('потолок страницы равен потолку сайта (web/src/lib/catalog-params.ts)', () => {
    // Сайт сам читает номер выше своего MAX_PAGE как первую страницу, backend
    // выше своего отвечает 422. Разойдутся числа — страницы между двумя
    // потолками уведут сайт на экран ошибки. Якорь — исходник сайта, не
    // константа под тестом; промах регулярки обязан ронять тест, а не
    // пропускать его.
    const source = readFileSync(
      fileURLToPath(new URL('../../../../web/src/lib/catalog-params.ts', import.meta.url)),
      'utf8',
    );
    const found = [...source.matchAll(/^export const MAX_PAGE = ([0-9_]+);$/gm)];
    expect(found).toHaveLength(1);
    expect(Number(found[0][1].replace(/_/g, ''))).toBe(MAX_PAGE);
  });
});

describe('номер страницы — граница парой', () => {
  test.each([
    ['строкой из адреса', { query: { page: '10000' } }, { query: { page: '10001' } }],
    ['числом из JSON-тела (умный поиск)', { body: { page: 10000 } }, { body: { page: 10001 } }],
  ])('%s: 10 000 проходит, 10 001 — 422', (_label, atCeiling, aboveCeiling) => {
    expect(run(atCeiling)).toBeUndefined();

    const error = run(aboveCeiling);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Page must not exceed 10000');
    expect(error.details).toEqual([{ field: 'page', message: 'Page must not exceed 10000' }]);
  });
});

describe('смещение — граница парой', () => {
  test('строкой из адреса: 1 000 000 проходит, 1 000 001 — 422', () => {
    expect(run({ query: { offset: '1000000' } })).toBeUndefined();

    const error = run({ query: { offset: '1000001' } });
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Offset must not exceed 1000000');
    expect(error.details).toEqual([{ field: 'offset', message: 'Offset must not exceed 1000000' }]);
  });

  test('числом из JSON-тела — тем же правилом', () => {
    expect(run({ body: { offset: 1000000 } })).toBeUndefined();
    expect(run({ body: { offset: 1000001 } }).statusCode).toBe(422);
  });
});

describe('номер читается, как его читают обработчики — parseInt по основанию 10', () => {
  const TOO_LARGE = 'Page must not exceed 10000';
  const NOT_A_NUMBER = 'Page must be a number';

  test.each([
    ['10^18 со стенда (500 до правки)', '1000000000000000000', TOO_LARGE],
    ['10^20 со стенда (400 до правки)', '100000000000000000000', TOO_LARGE],
    ['хвост после цифр отбрасывается', '10001abc', TOO_LARGE],
    ['пробел впереди пропускается', ' 10001', TOO_LARGE],
    ['повторённый ключ читается по первому элементу — выше потолка', ['10001', '1'], TOO_LARGE],
    ['повторённый ключ читается по первому элементу — в пределах', ['1', '99999999999999999999'], undefined],
    ['экспонента — это страница 1', '1e18', undefined],
    ['не число — правило самого обработчика', 'abc', undefined],
    ['пустая строка — правило самого обработчика', '', undefined],
    ['отрицательный — правило самого обработчика', '-99999999999999999999', undefined],
    ['объект из page[a]=… — правило самого обработчика', { a: '99999999999999999999' }, undefined],
    ['объект со своим valueOf читается как «[object Object]» — правило обработчика', { valueOf: 'x' }, undefined],
    // У объекта со своим toString-не-функцией нет текстовой формы: parseInt
    // бросает TypeError, обработчик ответил бы 500 (ревью 13.10:
    // ?page[toString]=x ронял в 500 сам фильтр, на любом адресе).
    ['объект из page[toString]=… — без текстовой формы', { toString: 'x' }, NOT_A_NUMBER],
    ['такой объект внутри повторённого ключа', [{ toString: 'x' }], NOT_A_NUMBER],
  ])('%s: page=%j', (_label, page, expectedMessage) => {
    const error = run({ query: { page } });
    expect(error?.statusCode).toBe(expectedMessage === undefined ? undefined : 422);
    expect(error?.message).toBe(expectedMessage);
  });

  test('число из JSON-тела: 10^18 — отказ, 10^21 печатается экспонентой и читается как 1', () => {
    // parseInt(1e18) = 10^18 (число печатается всеми цифрами), parseInt(1e21) = 1
    // («1e+21») — ровно так умный поиск и прочитал бы номер сам.
    expect(run({ body: { page: 1e18 } }).statusCode).toBe(422);
    expect(run({ body: { page: 1e21 } })).toBeUndefined();
  });

  test('номер — массив глубже стека: RangeError — тоже отказ, а не 500', () => {
    // parseInt приводит массив к строке через join — рекурсивно; на глубине в
    // несколько тысяч уровней это RangeError (Node 20 — от ~3,3 тыс., ревью
    // 13.10). Такой номер приходит JSON-телом на любой адрес: ловить в
    // readInteger только TypeError мало.
    let deep = [];
    for (let i = 0; i < 100000; i += 1) deep = [deep];
    const error = run({ body: { page: deep } });
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe('Page must be a number');
  });

  test('без текстовой формы — отказ и из JSON-тела, и для смещения', () => {
    const fromBody = run({ body: { page: { toString: 1 } } });
    expect(fromBody.statusCode).toBe(422);
    expect(fromBody.code).toBe('VALIDATION_ERROR');
    expect(fromBody.details).toEqual([{ field: 'page', message: NOT_A_NUMBER }]);

    const offset = run({ query: { offset: { toString: 'x' } } });
    expect(offset.statusCode).toBe(422);
    expect(offset.message).toBe('Offset must be a number');
    expect(offset.details).toEqual([{ field: 'offset', message: 'Offset must be a number' }]);
  });
});

describe('NUL в адресе', () => {
  test.each([
    ['в значении параметра', '/api/v1/public/establishments?priceRange=%00'],
    ['в середине фразы', '/api/v1/public/establishments?search=pizza%00x'],
    ['в имени параметра', '/api/v1/public/establishments?%00=1'],
    ['сегментом пути', '/api/v1/public/establishments/by-slug/%00'],
    ['в хвосте слага', '/api/v1/public/establishments/by-slug/brooklyn%00/reviews'],
  ])('%s → 400 INVALID_FORMAT', (_label, url) => {
    const error = run({ url });
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('INVALID_FORMAT');
    expect(error.message).toBe('Request URL contains a NUL character (U+0000)');
  });

  test.each([
    ['%2500 — закодированный знак процента, а не NUL', '/api/v1/public/establishments/by-slug/%2500'],
    ['U+0001 база принимает', '/api/v1/public/establishments?priceRange=%01'],
    ['U+007F база принимает', '/api/v1/public/establishments?search=%7F'],
    ['адрес без строки запроса', '/api/v1/public/establishments'],
  ])('%s → пропускает', (_label, url) => {
    expect(run({ url })).toBeUndefined();
  });

  test('отсутствующий адрес не роняет проверку', () => {
    expect(urlHasNul(undefined)).toBe(false);
  });
});

describe('NUL в теле — на любой глубине, в ключах тоже', () => {
  test.each([
    ['в строке верхнего уровня', { query: `pizza${NUL}` }],
    ['в элементе массива', { priceRange: ['$', NUL] }],
    ['во вложенном объекте', { attributes: { wifi: { note: `a${NUL}b` } } }],
    ['в ключе (ключ доходит до jsonb)', { attributes: { [`wifi${NUL}`]: true } }],
    ['тело-массив', [`x${NUL}`]],
  ])('%s → 400 INVALID_FORMAT', (_label, body) => {
    const error = run({ body });
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('INVALID_FORMAT');
    // Текст тела — для человека: приложение показывает текст отказа 400 как
    // есть (акции, загрузка в мастере, правка карточки, вход; 16.10.2026) —
    // поэтому «отправить», а не «сохранить»; у адреса — английский.
    expect(error.message).toBe('В тексте есть невидимый символ, который нельзя отправить. Наберите текст заново и попробуйте ещё раз.');
  });

  test('все прочие коды ниже U+0100 и все типы JSON — пропускает', () => {
    // U+0001–U+001F и U+007F — законный текст для базы, их чистит обработчик
    // (sanitizeQuery умного поиска). Проход по всем кодам ловит фильтр, взявший
    // больше одного NUL.
    const everyOtherCode = Array.from({ length: 0x100 }, (_, code) => String.fromCharCode(code))
      .filter((ch) => ch !== NUL)
      .join('');
    expect(everyOtherCode).toHaveLength(255);
    expect(run({
      body: { query: everyOtherCode, [everyOtherCode]: [1.5, true, null, { nested: everyOtherCode }] },
    })).toBeUndefined();
  });

  test('массив обходится по индексу, без Object.keys на его элементах', () => {
    // Ревью 13.10: обход, клавший в стек каждое значение и звавший Object.keys
    // на массивах, тратил на 10 МБ массив чисел 1,2 с и ~300 МБ против 0,1 с
    // JSON.parse. Цену тест не мерит (время на CI нестабильно) — он закрепляет
    // устройство: массив-Proxy с бросающей ловушкой ownKeys прежний обход
    // уронил бы, нынешний проходит его по индексу и находит NUL внутри.
    const noKeys = (items) => new Proxy(items, {
      ownKeys() { throw new Error('Object.keys on an array'); },
    });
    expect(bodyHasNul({ list: noKeys(['a', ['b'], { c: 'd' }]) })).toBe(false);
    expect(bodyHasNul({ list: noKeys(['a', `b${NUL}`]) })).toBe(true);
  });

  test('глубокая вложенность не роняет стек', () => {
    // 100 000 уровней: рекурсивный обход упал бы с RangeError.
    let withNul = `x${NUL}`;
    let clean = 'x';
    for (let i = 0; i < 100000; i += 1) {
      withNul = [withNul];
      clean = { a: clean };
    }
    expect(bodyHasNul(withNul)).toBe(true);
    expect(bodyHasNul(clean)).toBe(false);
  });

  test('пустое тело и запрос вовсе без тела', () => {
    expect(bodyHasNul({})).toBe(false);
    expect(bodyHasNul(undefined)).toBe(false);

    const next = jest.fn();
    requestGuard({ originalUrl: '/api/v1/health', query: {} }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
