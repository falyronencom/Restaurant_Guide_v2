/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: llmStructurer.js
 *
 * Tests Zod-validated JSON response handling against mocked fetch. Focuses on
 * happy path, malformed JSON, and schema violations — the failure modes the
 * orchestrator relies on to propagate errors cleanly.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../config/openrouter.js', () => ({
  getOcrConfig: jest.fn(),
}));

const openrouterMock = await import('../../config/openrouter.js');
const { structureMenu, ResponseSchema } = await import('../../services/ocr/llmStructurer.js');

const DEFAULT_OCR_CONFIG = {
  apiKey: 'test-key',
  baseUrl: 'https://test.openrouter.ai/api/v1',
  model: 'test-model',
};

const buildFetchResponse = (content, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => ({
    choices: [{ message: { content } }],
  }),
  text: async () => (ok ? content : `error body: ${content}`),
});

describe('llmStructurer', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    openrouterMock.getOcrConfig.mockReturnValue(DEFAULT_OCR_CONFIG);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('returns empty array for empty input without calling API', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await structureMenu('');
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns empty array for whitespace-only input', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await structureMenu('   \n\t  ');
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('successfully parses valid JSON response', async () => {
    const validResponse = JSON.stringify({
      items: [
        { item_name: 'Борщ', price_byn: 15, category_raw: 'Супы', confidence: 0.95 },
        { item_name: 'Салат', price_byn: null, category_raw: null, confidence: 0.8 },
      ],
    });
    global.fetch = jest.fn().mockResolvedValue(buildFetchResponse(validResponse));

    const items = await structureMenu('Борщ 15 руб\nСалат');
    expect(items).toHaveLength(2);
    expect(items[0].item_name).toBe('Борщ');
    expect(items[0].price_byn).toBe(15);
    expect(items[1].price_byn).toBeNull();
  });

  test('throws on non-2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'upstream error',
    });

    await expect(structureMenu('some text')).rejects.toThrow(/OpenRouter structurer call failed: 502/);
  });

  test('throws on malformed JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      buildFetchResponse('this is not json {{{'),
    );

    await expect(structureMenu('some text')).rejects.toThrow(/invalid JSON/);
  });

  test('throws on schema violation — missing item_name', async () => {
    const bad = JSON.stringify({
      items: [{ price_byn: 15, category_raw: null, confidence: 0.9 }],
    });
    global.fetch = jest.fn().mockResolvedValue(buildFetchResponse(bad));

    await expect(structureMenu('x')).rejects.toThrow(/schema validation/);
  });

  test('throws on schema violation — confidence out of range', async () => {
    const bad = JSON.stringify({
      items: [{ item_name: 'A', price_byn: 15, category_raw: null, confidence: 1.5 }],
    });
    global.fetch = jest.fn().mockResolvedValue(buildFetchResponse(bad));

    await expect(structureMenu('x')).rejects.toThrow(/schema validation/);
  });

  test('throws when content is empty', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
      text: async () => '',
    });

    await expect(structureMenu('x')).rejects.toThrow(/empty content/);
  });

  test('accepts empty items array as valid gibberish response', async () => {
    const empty = JSON.stringify({ items: [] });
    global.fetch = jest.fn().mockResolvedValue(buildFetchResponse(empty));

    const items = await structureMenu('gibberish');
    expect(items).toEqual([]);
  });

  describe('ResponseSchema direct validation', () => {
    test('accepts minimal valid response', () => {
      const result = ResponseSchema.safeParse({ items: [] });
      expect(result.success).toBe(true);
    });

    test('rejects item with non-string name', () => {
      const result = ResponseSchema.safeParse({
        items: [{ item_name: 123, price_byn: 10, category_raw: null, confidence: 0.9 }],
      });
      expect(result.success).toBe(false);
    });

    test('rejects negative confidence', () => {
      const result = ResponseSchema.safeParse({
        items: [{ item_name: 'A', price_byn: 10, category_raw: null, confidence: -0.1 }],
      });
      expect(result.success).toBe(false);
    });
  });
});
