/**
 * Unit — OCR benchmark harness: model spec with a reasoning effort, catalog
 * verification, request body, attempts (scripts/ocr-benchmark/*).
 *
 * Why it matters (2026-09-28, OCR model swap): a benchmark «as production»
 * that silently differs from production measures the wrong thing. A plain id
 * must send exactly the `reasoning` production sends (getOcrConfig — since
 * 28.09 effort "minimal"), `@default` must send no field (the model's own
 * default), and «@minimal» the shape smartSearchService sends. Attempts: a
 * call that timed out once and then succeeded is otherwise invisible, while
 * in production it burns a job attempt.
 *
 * OpenRouter is not called: global.fetch is a mock, the key a stub.
 */

import { jest } from '@jest/globals';
import { parseModelSpec, verifyModels, REASONING_EFFORTS } from '../../../scripts/ocr-benchmark/models.js';
import { visionExtract, structureText, reasoningField } from '../../../scripts/ocr-benchmark/caller.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSummary, readSavedVision } from '../../../scripts/ocr-benchmark/report.js';

const ok = (content, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], usage }),
});
const httpError = (status, text = 'upstream') => ({ ok: false, status, text: async () => text });
const bodyOf = (call) => JSON.parse(call[1].body);

let savedKey;
let originalFetch;
beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  originalFetch = global.fetch;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  global.fetch = originalFetch;
});

describe('parseModelSpec', () => {
  test('id без суффикса — «как в проде», без effort', () => {
    expect(parseModelSpec('google/gemini-3.5-flash-lite')).toEqual({
      spec: 'google/gemini-3.5-flash-lite', id: 'google/gemini-3.5-flash-lite', effort: null,
    });
  });

  test('id@minimal — effort отдельно от id', () => {
    expect(parseModelSpec('google/gemini-3.8-flash@minimal')).toEqual({
      spec: 'google/gemini-3.8-flash@minimal', id: 'google/gemini-3.8-flash', effort: 'minimal',
    });
  });

  test('неизвестный effort и пустой id — отказ сразу, а не молчаливый прогон без поля', () => {
    expect(() => parseModelSpec('google/gemini-3.8-flash@turbo')).toThrow('bad model spec');
    expect(() => parseModelSpec('@minimal')).toThrow('bad model spec');
  });

  test('none и minimal входят в допустимые', () => {
    expect(REASONING_EFFORTS).toEqual(expect.arrayContaining(['none', 'minimal']));
  });

  test('@default — отдельный суффикс «без поля»', () => {
    expect(parseModelSpec('google/gemini-2.5-flash@default')).toEqual({
      spec: 'google/gemini-2.5-flash@default', id: 'google/gemini-2.5-flash', effort: 'default',
    });
  });
});

describe('verifyModels', () => {
  const entry = (params, modalities = ['text', 'image']) => ({
    pricing: { prompt: '0.0000003', completion: '0.0000025' }, inputModalities: modalities, supportedParameters: params,
  });
  const catalog = new Map([
    ['a/full', entry(['response_format', 'reasoning'])],
    ['a/noreason', entry(['response_format'])],
    ['a/text', entry(['response_format', 'reasoning'], ['text'])],
    ['a/nojson', entry(['reasoning'])],
  ]);
  const specs = (...s) => s.map(parseModelSpec);

  test('годная модель — с ценой и своим effort', () => {
    const { usable, skipped } = verifyModels(specs('a/full@minimal'), catalog);
    expect(skipped).toEqual([]);
    expect(usable).toEqual([{ spec: 'a/full@minimal', id: 'a/full', effort: 'minimal', pricing: { prompt: '0.0000003', completion: '0.0000025' } }]);
  });

  test('effort при модели без параметра reasoning — пропуск с причиной; без effort и @default — годна', () => {
    const { usable, skipped } = verifyModels(specs('a/noreason@minimal', 'a/noreason', 'a/noreason@default'), catalog);
    expect(skipped).toEqual([{ id: 'a/noreason@minimal', reason: 'reasoning parameter not supported' }]);
    expect(usable.map((u) => u.spec)).toEqual(['a/noreason', 'a/noreason@default']);
  });

  test('нет в каталоге, нет картинок, нет JSON-режима — пропуск', () => {
    const { usable, skipped } = verifyModels(specs('a/missing', 'a/text', 'a/nojson'), catalog);
    expect(usable).toEqual([]);
    expect(skipped.map((s) => s.id)).toEqual(['a/missing', 'a/text', 'a/nojson']);
  });

  test('каталог недоступен — все годны, цена неизвестна', () => {
    const { usable } = verifyModels(specs('x/y@none'), null);
    expect(usable).toEqual([{ spec: 'x/y@none', id: 'x/y', effort: 'none', pricing: null }]);
  });
});

describe('тело запроса и попытки', () => {
  test('без суффикса — как в проде: обе стадии шлют reasoning из getOcrConfig', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(ok('Меню: борщ 5'))
      .mockResolvedValueOnce(ok('{"items":[]}'));
    const vision = await visionExtract(['data:image/jpeg;base64,AAAA'], 'google/gemini-3.8-flash');
    await structureText(vision.rawText, 'google/gemini-3.8-flash');
    const [v, s] = global.fetch.mock.calls.map(bodyOf);
    // Прод с 28.09.2026 шлёт minimal (config/openrouter.js).
    expect(v.reasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(s.reasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(vision.sentReasoning).toEqual({ effort: 'minimal', exclude: true });
  });

  test('@default — поля reasoning нет: умолчание самой модели', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(ok('Меню: борщ 5'))
      .mockResolvedValueOnce(ok('{"items":[]}'));
    const vision = await visionExtract(['data:image/jpeg;base64,AAAA'], 'google/gemini-2.5-flash', 'default');
    await structureText(vision.rawText, 'google/gemini-2.5-flash', 'default');
    const [v, s] = global.fetch.mock.calls.map(bodyOf);
    expect(Object.keys(v)).toEqual(['model', 'messages', 'temperature', 'usage']);
    expect(v).toMatchObject({ model: 'google/gemini-2.5-flash', temperature: 0, usage: { include: true } });
    expect(Object.keys(s)).toEqual(['model', 'messages', 'temperature', 'response_format', 'usage']);
    expect(s).toMatchObject({ response_format: { type: 'json_object' }, usage: { include: true } });
    expect(vision.sentReasoning).toBeNull();
  });

  test('@minimal — обе стадии шлют {effort, exclude:true}, как умный поиск', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(ok('Меню: борщ 5'))
      .mockResolvedValueOnce(ok('{"items":[{"item_name":"Борщ","price_byn":5,"category_raw":null,"confidence":0.9}]}'));
    const vision = await visionExtract(['data:image/jpeg;base64,AAAA'], 'google/gemini-3.8-flash', 'minimal');
    const structured = await structureText(vision.rawText, 'google/gemini-3.8-flash', 'minimal');
    const [v, s] = global.fetch.mock.calls.map(bodyOf);
    expect(v.reasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(s.reasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(s.response_format).toEqual({ type: 'json_object' });
    expect(structured.items).toEqual([{ item_name: 'Борщ', price_byn: 5, category_raw: null, confidence: 0.9 }]);
    // Дамп несёт то, что ушло в запрос, — доказательство конфигурации прогона.
    expect(vision.sentReasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(structured.sentReasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(reasoningField('default')).toBeNull();
  });

  test('успех с первого раза — одна попытка', async () => {
    global.fetch = jest.fn().mockResolvedValue(ok('Меню'));
    const v = await visionExtract(['data:image/jpeg;base64,AAAA'], 'm');
    expect(v.attempts).toBe(1);
  });

  test('503, затем успех — две попытки видны в результате', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(httpError(503)).mockResolvedValueOnce(ok('Меню'));
    const v = await visionExtract(['data:image/jpeg;base64,AAAA'], 'm');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(v.attempts).toBe(2);
  }, 10000);

  test('503 дважды — ошибка несёт две попытки', async () => {
    global.fetch = jest.fn().mockResolvedValue(httpError(503));
    const err = await visionExtract(['data:image/jpeg;base64,AAAA'], 'm').catch((e) => e);
    expect(err.message).toContain('503');
    expect(err.attempts).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 10000);

  test('400 (модель отвергла effort) — отказ сразу, попытка одна и записана на ошибке', async () => {
    global.fetch = jest.fn().mockResolvedValue(httpError(400, 'reasoning effort none is not supported'));
    const err = await visionExtract(['data:image/jpeg;base64,AAAA'], 'm', 'none').catch((e) => e);
    expect(err.message).toContain('reasoning effort none is not supported');
    expect(err.attempts).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('finish_reason ответа vision — в результате: прод с 29.09 отвергает всё, кроме stop', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Меню' }, finish_reason: 'length' }] }),
      })
      .mockResolvedValueOnce(ok('Меню'));
    expect((await visionExtract(['data:image/jpeg;base64,AAAA'], 'm')).finishReason).toBe('length');
    // Ответ без поля — null, а не 'stop': стенд не додумывает.
    expect((await visionExtract(['data:image/jpeg;base64,AAAA'], 'm')).finishReason).toBeNull();
  });

  test('пустой текст OCR — структурер не зовётся, попыток ноль', async () => {
    global.fetch = jest.fn();
    const s = await structureText('   ', 'm', 'minimal');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(s.attempts).toBe(0);
  });
});

describe('SUMMARY', () => {
  test('токены рассуждения и повторы — отдельными столбцами', () => {
    const r = {
      unitId: 'A.jpg', model: 'x@minimal', error: null, items: [],
      vision: { ms: 100, attempts: 2, usage: { prompt_tokens: 10, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 40 } } },
      structurer: { ms: 50, attempts: 1, parseOk: true, zodOk: true, usage: { prompt_tokens: 5, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 3 } } },
      metrics: { itemsCount: 0, needsCaution: 0, empty: true, costUsd: 0.001 },
    };
    const md = buildSummary({ startedAt: 't', photoCount: 1, sources: ['s'], skippedModels: [], warnings: [] }, ['x@minimal'], [r]);
    expect(md).toContain('| 15/57 | 43 | 1 | $0.0010 |');
  });

  test('обрывы vision — отдельным столбцом: ответы, которые прод отверг бы', () => {
    const row = (unitId, finishReason) => ({
      unitId, model: 'x', error: null, items: [],
      vision: { ms: 100, attempts: 1, finishReason, usage: null },
      structurer: { ms: 50, attempts: 1, parseOk: true, zodOk: true, usage: null },
      metrics: { itemsCount: 0, needsCaution: 0, empty: true, costUsd: null },
    });
    const md = buildSummary(
      { startedAt: 't', photoCount: 3, sources: ['s'], skippedModels: [], warnings: [] },
      ['x'],
      [row('A.jpg', 'stop'), row('B.jpg', 'length'), row('C.jpg', null)],
    );
    expect(md).toContain('| JSON-fail | Обрывы vision | needs_caution |');
    // Меню OK 3, ошибок 0, позиций 0, в среднем 0.0, пустых 3, JSON-fail 0, обрывов 1 (только 'length').
    expect(md).toContain('| `x` | 3 | 0 | 0 | 0.0 | 3 | 0 | 1 | — |');
  });
});

// --text-from (29.09.2026, составные меню): итерации инструкции структурера
// идут по тексту, уже прочитанному с фото, — без повторного vision.
describe('readSavedVision — текст фото из прошлого прогона', () => {
  let runDir;
  const saveDump = (model, unit, vision) => {
    const dir = join(runDir, 'dumps', model);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, unit), JSON.stringify({ unitId: 'x', vision }), 'utf8');
  };
  beforeEach(() => { runDir = mkdtempSync(join(tmpdir(), 'ocr-bench-')); });
  afterEach(() => { rmSync(runDir, { recursive: true, force: true }); });

  test('отдаёт блок vision дампа той же метки модели и того же фото', () => {
    const vision = { rawText: 'Борщ 15', usage: { prompt_tokens: 1 }, finishReason: 'stop' };
    saveDump('google--gemini-3.8-flash@minimal', 'Zalkind Kitchen__pdf1_p02.png.json', vision);
    saveDump('google--gemini-3.8-flash@minimal', 'IMG_1.jpg.json', { rawText: 'чужое фото', usage: {} });
    saveDump('google--gemini-3.8-flash', 'Zalkind Kitchen__pdf1_p02.png.json', { rawText: 'чужая метка', usage: {} });

    expect(readSavedVision(runDir, 'google/gemini-3.8-flash@minimal', 'Zalkind Kitchen/pdf1_p02.png')).toEqual(vision);
  });

  test('дампа нет — ошибка, а не пустой текст', () => {
    expect(() => readSavedVision(runDir, 'm', 'IMG_1.jpg')).toThrow(/no saved text/);
  });

  test('vision того прогона упал — ошибка: пустой текст выдал бы себя за «позиций нет»', () => {
    saveDump('m', 'IMG_1.jpg.json', { rawText: '', usage: null });
    expect(() => readSavedVision(runDir, 'm', 'IMG_1.jpg')).toThrow(/did not complete/);
  });
});
