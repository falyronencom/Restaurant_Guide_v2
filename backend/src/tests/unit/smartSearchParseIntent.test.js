/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: smartSearchService.parseIntent / normalizeIntent
 *
 * Разбор фразы моделью после А1 (24.09.2026, SDL CAT-C-2.2 с поправкой того же
 * дня): модель по умолчанию и промпт — те, что мерились вместе; reasoning
 * "minimal"; один повтор, если ответ пришёл, но им нельзя воспользоваться;
 * значения вне словаря отбрасываются поштучно, а не роняют весь разбор.
 *
 * OpenRouter подменён: global.fetch — мок, ключ — заглушка. AI_MODEL снят на
 * время каждого теста: локальный .env разработчика может нести прежний id.
 */

import crypto from 'crypto';
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const { default: logger } = await import('../../utils/logger.js');
const { parseIntent, normalizeIntent, SYSTEM_PROMPT } = await import('../../services/smartSearchService.js');
const { CITY_SLUG_MAP } = await import('../../constants/urlSlugs.js');

/** Форма ответа по промпту P1, все поля пустые. */
const P1_EMPTY = {
  category: null, cuisine: null, dish: null, dish_variants: [], meal_type: null,
  price_max: null, location: null, sort: null, tags: [], error: null,
};

/** Ответ прежнего промпта — так выглядят разборы, лежащие в кэше при выкатке. */
const P0_EMPTY = {
  category: null, cuisine: null, dish: null, meal_type: null,
  price_max: null, location: null, sort: null, tags: [], error: null,
};

/** Ответ OpenRouter с произвольным текстом в content. */
const rawAnswer = (content, finishReason = 'stop') => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'google/gemini-3.5-flash-lite',
    choices: [{ finish_reason: finishReason, message: { content } }],
  }),
});

/** Ответ OpenRouter с разбором по форме P1. */
const answer = (fields) => rawAnswer(JSON.stringify({ ...P1_EMPTY, ...fields }));

const httpError = (status, text) => ({
  ok: false,
  status,
  statusText: 'Error',
  text: async () => text,
});

const bodyOf = (call) => JSON.parse(call[1].body);

const ENV_KEYS = ['OPENROUTER_API_KEY', 'AI_MODEL', 'OPENROUTER_BASE_URL'];
let savedEnv;
let originalFetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.AI_MODEL;
  delete process.env.OPENROUTER_BASE_URL;
  originalFetch = global.fetch;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
});

// ─── Запрос к модели ─────────────────────────────────────────────────────────

describe('parseIntent — запрос к модели', () => {
  test('по умолчанию: google/gemini-3.5-flash-lite, reasoning minimal, JSON-режим', async () => {
    global.fetch = jest.fn().mockResolvedValue(answer({ dish: 'кофе' }));

    await parseIntent('кофе');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = bodyOf(global.fetch.mock.calls[0]);
    expect(body.model).toBe('google/gemini-3.5-flash-lite');
    expect(body.reasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'кофе' });
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
  });

  test('промпт — ровно тот P1, что мерился с этой моделью 24.09.2026', () => {
    // Хеш посчитан по bench_prompts.cjs стенда замера
    // (docs/handoffs/smart_search_recall_20260924), а не по этому модулю.
    // Модель и промпт выбирались вместе: правка текста (или словарей типов и
    // кухонь, которые в него подставлены) — повод перепрогнать замер и
    // обновить хеш, а не просто обновить хеш.
    const sha256 = crypto.createHash('sha256').update(SYSTEM_PROMPT, 'utf8').digest('hex');

    expect(sha256).toBe('006e5ab2f9db074c4f9ec1b56ff61db8de9cc80d12e4dac22f0f52e1a657d3e1');
  });

  test('AI_MODEL из окружения сильнее умолчания', async () => {
    process.env.AI_MODEL = 'google/gemini-3.1-flash-lite';
    global.fetch = jest.fn().mockResolvedValue(answer({ dish: 'кофе' }));

    await parseIntent('кофе');

    expect(bodyOf(global.fetch.mock.calls[0]).model).toBe('google/gemini-3.1-flash-lite');
  });
});

// ─── Один повтор ─────────────────────────────────────────────────────────────

describe('parseIntent — один повтор, если ответ пришёл непригодным', () => {
  test('ответ оборван на полуслове (finish_reason "error") — повтор, второй ответ принят', async () => {
    // Так выглядели обрывы в замере 24.09: у 2.5-flash-lite 4 из 222, у
    // 3.8-flash 3 из 111 — сбой поставщика, а не одной модели.
    global.fetch = jest.fn()
      .mockResolvedValueOnce(rawAnswer('{"category":null,"cuisine":null,"dish":"пиц', 'error'))
      .mockResolvedValueOnce(answer({ dish: 'пицца' }));

    const intent = await parseIntent('пицца');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(intent.dish).toBe('пицца');
  });

  test('невалидный JSON — повтор', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(rawAnswer('{"dish": пицца}'))
      .mockResolvedValueOnce(answer({ dish: 'пицца' }));

    const intent = await parseIntent('пицца');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(intent.dish).toBe('пицца');
  });

  test('пустой ответ — повтор', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(rawAnswer(''))
      .mockResolvedValueOnce(answer({ dish: 'пицца' }));

    const intent = await parseIntent('пицца');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(intent.dish).toBe('пицца');
  });

  test('тело ответа OpenRouter оборвано (не JSON) — повтор', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
      })
      .mockResolvedValueOnce(answer({ dish: 'пицца' }));

    const intent = await parseIntent('пицца');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(intent.dish).toBe('пицца');
  });

  test('ответ не по форме (цена строкой) — повтор', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(answer({ dish: 'пицца', price_max: '20' }))
      .mockResolvedValueOnce(answer({ dish: 'пицца', price_max: 20 }));

    const intent = await parseIntent('пицца до 20 рублей');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(intent.price_max).toBe(20);
  });

  test('два непригодных ответа подряд — null, и третьего вызова нет', async () => {
    global.fetch = jest.fn().mockResolvedValue(rawAnswer('не JSON'));

    const intent = await parseIntent('пицца');

    expect(intent).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('обе попытки делят один бюджет времени — один и тот же AbortSignal', async () => {
    // Своя отсечка на каждую попытку удвоила бы худшее ожидание (20 → 40 с).
    global.fetch = jest.fn()
      .mockResolvedValueOnce(rawAnswer('не JSON'))
      .mockResolvedValueOnce(answer({ dish: 'пицца' }));

    await parseIntent('пицца');

    const [first, second] = global.fetch.mock.calls;
    expect(first[1].signal).toBeInstanceOf(AbortSignal);
    expect(second[1].signal).toBe(first[1].signal);
  });

  test('ошибка HTTP не повторяется; текст отказа попадает в лог', async () => {
    // Неверный AI_MODEL или неподдержанный параметр — 4xx на каждом вызове.
    // Без текста отказа в логе это неотличимо от любой другой ошибки.
    global.fetch = jest.fn().mockResolvedValue(
      httpError(400, '{"error":{"message":"reasoning effort minimal is not supported"}}'),
    );

    const intent = await parseIntent('пицца');

    expect(intent).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('OpenRouter API error', expect.objectContaining({
      status: 400,
      detail: expect.stringContaining('reasoning effort minimal is not supported'),
    }));
  });

  test('бюджет истёк при чтении тела ошибки — в логе таймаут, а не «ошибка API»', async () => {
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => { throw abort; },
    });

    const intent = await parseIntent('пицца');

    expect(intent).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('OpenRouter API timeout', expect.any(Object));
    expect(logger.error).not.toHaveBeenCalledWith('OpenRouter API error', expect.anything());
  });

  test('отказ сети не повторяется', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    const intent = await parseIntent('пицца');

    expect(intent).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── Значения вне словаря — поштучно ─────────────────────────────────────────

describe('parseIntent — значение вне словаря отбрасывается поштучно, разбор жив', () => {
  test('кухня вне списка отброшена, остальные поля и кухни из списка остались', async () => {
    // Раньше enum в схеме ронял весь разбор → запасной путь без меню.
    global.fetch = jest.fn().mockResolvedValue(
      answer({ dish: 'суши', cuisine: ['Японская', 'Паназиатская'] }),
    );

    const intent = await parseIntent('суши');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(intent).not.toBeNull();
    expect(intent.dish).toBe('суши');
    expect(intent.cuisine).toEqual(['Японская']);
  });

  test('тип и сортировка вне списка — null, разбор жив', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      answer({ dish: 'рамен', category: 'Суши-бар', sort: 'relevance' }),
    );

    const intent = await parseIntent('рамен');

    expect(intent).not.toBeNull();
    expect(intent.dish).toBe('рамен');
    expect(intent.category).toBeNull();
    expect(intent.sort).toBeNull();
  });

  test('кухня строкой вместо списка — список из одного значения', async () => {
    global.fetch = jest.fn().mockResolvedValue(answer({ cuisine: 'Грузинская' }));

    const intent = await parseIntent('грузинская кухня');

    expect(intent).not.toBeNull();
    expect(intent.cuisine).toEqual(['Грузинская']);
  });
});

// ─── Нормализация разбора (ответ модели и разбор из кэша) ────────────────────

describe('normalizeIntent', () => {
  test('«рядом» в location — города нет, сортировка по расстоянию', () => {
    // Прежний промпт так и отвечал на «Рядом со мной» (прод 24.09).
    const intent = normalizeIntent({ ...P0_EMPTY, location: 'Рядом со мной' });

    expect(intent.location).toBeNull();
    expect(intent.sort).toBe('distance');
  });

  test('названная сортировка сильнее «рядом» в location', () => {
    const intent = normalizeIntent({ ...P0_EMPTY, location: 'поблизости', sort: 'rating' });

    expect(intent.location).toBeNull();
    expect(intent.sort).toBe('rating');
  });

  test('улица или район — не город и не «рядом»: location пуст, сортировка не назначается', () => {
    const intent = normalizeIntent({ ...P0_EMPTY, location: 'на Немиге' });

    expect(intent.location).toBeNull();
    expect(intent.sort).toBeNull();
  });

  test('город — в каноническом написании, регистр и «е» вместо «ё» не мешают', () => {
    expect(normalizeIntent({ ...P0_EMPTY, location: 'могилев' }).location).toBe('Могилёв');
    expect(normalizeIntent({ ...P0_EMPTY, location: 'МОГИЛЁВ' }).location).toBe('Могилёв');
    expect(normalizeIntent({ ...P0_EMPTY, location: ' гродно ' }).location).toBe('Гродно');
  });

  test('каждый город справочника принимается — список промпта не отстал от канона', () => {
    // Якорь: CITY_SLUG_MAP — справочник городов (оба написания Могилёва).
    // Новый город в справочнике без правки промпта и этого списка — красный.
    const accepted = Object.keys(CITY_SLUG_MAP)
      .map((city) => normalizeIntent({ ...P0_EMPTY, location: city }).location);

    expect(accepted).not.toContain(null);
    expect(new Set(accepted).size).toBe(7);
  });

  test('dish_variants: только строки, без пустых, без повторов и без самого блюда, не больше пяти', () => {
    const intent = normalizeIntent({
      ...P1_EMPTY,
      dish: 'суши',
      dish_variants: [' ролл ', 'ролл', 'СУШИ', '', 5, 'сашими', 'нигири', 'sushi', 'гункан', 'маки'],
    });

    expect(intent.dish_variants).toEqual(['ролл', 'сашими', 'нигири', 'sushi', 'гункан']);
  });

  test('варианты без блюда отбрасываются, негодная форма поля — пустой список', () => {
    expect(normalizeIntent({ ...P1_EMPTY, dish_variants: ['ролл'] }).dish_variants).toEqual([]);
    expect(normalizeIntent({ ...P1_EMPTY, dish: 'суши', dish_variants: 'ролл' }).dish_variants)
      .toEqual([]);
  });

  test('разбор прежнего промпта (без dish_variants) принимается с пустым списком', () => {
    const intent = normalizeIntent({ ...P0_EMPTY, dish: 'пицца', tags: ['пицца'] });

    expect(intent).toEqual({ ...P0_EMPTY, dish: 'пицца', tags: ['пицца'], dish_variants: [] });
  });

  test('чужая форма — не разбор, а отказ: иначе мусор стал бы выдачей всего города', () => {
    expect(normalizeIntent({})).toBeNull();
    expect(normalizeIntent({ category: null })).toBeNull();
    expect(normalizeIntent(null)).toBeNull();
  });

  test('повторная нормализация ничего не меняет — разбор из кэша проходит её ещё раз', () => {
    const once = normalizeIntent({
      ...P0_EMPTY,
      location: 'рядом',
      dish: ' кофе ',
      dish_variants: ['coffee', 'КОФЕ'],
      cuisine: ['Европейская', 'Паназиатская'],
      meal_type: ' Breakfast ',
    });

    expect(normalizeIntent(once)).toEqual(once);
    expect(once).toMatchObject({
      dish: 'кофе',
      dish_variants: ['coffee'],
      cuisine: ['Европейская'],
      meal_type: 'breakfast',
      location: null,
      sort: 'distance',
    });
  });
});
