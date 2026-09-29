/* eslint-env jest */
/**
 * Unit Tests: visionOcrAdapter.js — the request the vision stage sends.
 *
 * reasoning comes from getOcrConfig (28.09.2026: minimal — see config/openrouter.js);
 * the adapter passes it through and adds nothing when the config has none.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../../config/openrouter.js', () => ({
  getOcrConfig: jest.fn(),
}));

const openrouterMock = await import('../../config/openrouter.js');
const { extractFromImages } = await import('../../services/ocr/visionOcrAdapter.js');

const BASE_CONFIG = { apiKey: 'test-key', baseUrl: 'https://test.openrouter.ai/api/v1', model: 'test-model' };
const URLS = ['https://res.cloudinary.com/test/image/upload/pg_1/menu.jpg'];
const okAnswer = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

describe('visionOcrAdapter', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('шлёт reasoning из конфига OCR', async () => {
    openrouterMock.getOcrConfig.mockReturnValue({ ...BASE_CONFIG, reasoning: { effort: 'minimal', exclude: true } });
    global.fetch = jest.fn().mockResolvedValue(okAnswer('Меню: борщ 15 руб, салат 12 руб, чай 4 руб — и ещё строка'));

    const result = await extractFromImages(URLS);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(body).toMatchObject({ model: 'test-model', temperature: 0 });
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: URLS[0] } });
    expect(result.confidenceOverall).toBe(0.85);
  });

  test('без reasoning в конфиге поля в запросе нет', async () => {
    openrouterMock.getOcrConfig.mockReturnValue(BASE_CONFIG);
    global.fetch = jest.fn().mockResolvedValue(okAnswer('Меню'));

    await extractFromImages(URLS);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Object.keys(body)).toEqual(['model', 'messages', 'temperature']);
  });

  // 29.09.2026: страницы PDF читаются по одной. Ответ, оборванный не самой
  // моделью, — часть страницы: позиции из недочитанных строк пропали бы молча.
  const answerEndingWith = (finishReason, nativeFinishReason) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: { content: 'Борщ 15 руб\nСалат' },
        ...(finishReason !== undefined && { finish_reason: finishReason }),
        ...(nativeFinishReason !== undefined && { native_finish_reason: nativeFinishReason }),
      }],
    }),
  });

  test.each([
    ['length', 'MAX_TOKENS', 'vision OCR answer cut short: finish_reason=length (MAX_TOKENS)'],
    ['content_filter', 'RECITATION', 'vision OCR answer cut short: finish_reason=content_filter (RECITATION)'],
    ['length', undefined, 'vision OCR answer cut short: finish_reason=length'],
  ])('ответ оборван (finish_reason %s, %s) — ошибка, страница неполная', async (finishReason, nativeFinishReason, message) => {
    openrouterMock.getOcrConfig.mockReturnValue(BASE_CONFIG);
    global.fetch = jest.fn().mockResolvedValue(answerEndingWith(finishReason, nativeFinishReason));

    await expect(extractFromImages(URLS)).rejects.toHaveProperty('message', message);
  });

  test.each([
    ['stop', 'STOP'],
    [undefined, undefined],
    [null, null],
  ])('ответ закончен моделью (finish_reason %s) или поля нет — текст принимается', async (finishReason, nativeFinishReason) => {
    openrouterMock.getOcrConfig.mockReturnValue(BASE_CONFIG);
    global.fetch = jest.fn().mockResolvedValue(answerEndingWith(finishReason, nativeFinishReason));

    const result = await extractFromImages(URLS);

    expect(result.rawText).toBe('Борщ 15 руб\nСалат');
  });
});
