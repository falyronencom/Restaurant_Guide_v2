/**
 * Unit — OCR model configuration (config/openrouter.js getOcrConfig) and its
 * wiring into both OCR calls.
 *
 * Замер 28.09.2026 по эталону 480 строк (scripts/ocr-benchmark, отчёт
 * backend/session_reports/ocr_model_swap_2026_report.md): google/gemini-3.8-flash
 * с reasoning minimal — цены 84 % против 75 % у 3.5-flash-lite, без сбоев;
 * без поля та же модель рассуждает на medium (×1,7 цены, 2 сбоя JSON).
 * У прежнего умолчания google/gemini-2.5-flash-lite срок в каталоге
 * OpenRouter — 2026-10-20. Ожидания — литералы решения Координатора 28.09.
 *
 * OpenRouter не вызывается: global.fetch — мок, ключ — заглушка.
 */

import { jest } from '@jest/globals';
import { getOcrConfig } from '../../config/openrouter.js';
import { extractFromImages } from '../../services/ocr/visionOcrAdapter.js';
import { structureMenu } from '../../services/ocr/llmStructurer.js';

const ENV_KEYS = ['AI_OCR_MODEL', 'AI_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL'];
let savedEnv;
let originalFetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  delete process.env.AI_OCR_MODEL;
  delete process.env.AI_MODEL;
  delete process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_API_KEY = 'test-key';
  originalFetch = global.fetch;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
});

const answer = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
const bodyOf = (call) => JSON.parse(call[1].body);

describe('getOcrConfig', () => {
  test('без AI_OCR_MODEL — google/gemini-3.8-flash, а не истекающая 20.10 модель 2.5', () => {
    expect(getOcrConfig().model).toBe('google/gemini-3.8-flash');
  });

  test('AI_OCR_MODEL перекрывает умолчание', () => {
    process.env.AI_OCR_MODEL = 'google/gemini-3.5-flash-lite';
    expect(getOcrConfig().model).toBe('google/gemini-3.5-flash-lite');
  });

  test('рассуждения — minimal, текст рассуждений не возвращать', () => {
    expect(getOcrConfig().reasoning).toEqual({ effort: 'minimal', exclude: true });
  });

  test('OCR не наследует модель умного поиска (AI_MODEL)', () => {
    // Контракт getConfig — у сессий умного поиска; здесь только сторона OCR.
    process.env.AI_MODEL = 'google/intent-model';
    expect(getOcrConfig().model).toBe('google/gemini-3.8-flash');
  });
});

describe('связка: настоящий конфиг → запросы обеих стадий', () => {
  test('vision и структурер шлют модель по умолчанию и reasoning minimal', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(answer('Борщ 15'))
      .mockResolvedValueOnce(answer('{"items":[{"item_name":"Борщ","price_byn":15,"category_raw":null,"confidence":0.9}]}'));

    const { rawText } = await extractFromImages(['https://res.cloudinary.com/test/image/upload/menu.jpg']);
    const items = await structureMenu(rawText);

    const [vision, structurer] = global.fetch.mock.calls.map(bodyOf);
    for (const body of [vision, structurer]) {
      expect(body.model).toBe('google/gemini-3.8-flash');
      expect(body.reasoning).toEqual({ effort: 'minimal', exclude: true });
      expect(body.temperature).toBe(0);
    }
    expect(structurer.response_format).toEqual({ type: 'json_object' });
    expect(items).toEqual([{ item_name: 'Борщ', price_byn: 15, category_raw: null, confidence: 0.9 }]);
  });
});
