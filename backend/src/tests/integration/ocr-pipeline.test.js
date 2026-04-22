/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration test: OCR menu pipeline end-to-end.
 *
 * Exercises: enqueue → pickNextPending → processJob → menu_items persistence,
 * with pdf-parse and OpenRouter fetch calls mocked at the module boundary.
 *
 * The real DB is used — migration 024 must be applied to restaurant_guide_test
 * for this suite to run.
 */

import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';

jest.unstable_mockModule('pdf-parse/lib/pdf-parse.js', () => ({
  default: jest.fn(),
}));

jest.unstable_mockModule('../../config/openrouter.js', () => ({
  getConfig: jest.fn(),
  getOcrConfig: jest.fn(),
  isAvailable: jest.fn(() => true),
}));

const pdfParseModule = await import('pdf-parse/lib/pdf-parse.js');
const openrouterModule = await import('../../config/openrouter.js');

const { pool } = await import('../../config/database.js');
const ocrJobModel = await import('../../models/ocrJobModel.js');
const menuItemModel = await import('../../models/menuItemModel.js');
const ocrService = await import('../../services/ocr/ocrService.js');
const { createPartnerAndGetToken, createTestEstablishment } = await import('../utils/auth.js');

const OCR_CONFIG = {
  apiKey: 'test-key',
  baseUrl: 'https://test.openrouter.ai/api/v1',
  model: 'test-model',
};

/**
 * Insert a minimal establishment_media row with file_type='pdf'.
 * Does not call real mediaService/cloudinary — we feed a fake URL and trust the
 * mocked pdf-parse + fetch chain.
 */
const insertTestMedia = async (establishmentId, fileType = 'pdf') => {
  const mediaId = randomUUID();
  const url = `https://res.cloudinary.com/test/image/upload/v1/establishments/${establishmentId}/menu_pdf/test.pdf`;
  await pool.query(
    `INSERT INTO establishment_media (
       id, establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary
     ) VALUES ($1, $2, 'menu', $3, $4, $4, $4, 0, false)`,
    [mediaId, establishmentId, fileType, url],
  );
  return { mediaId, url };
};

/**
 * Build a fetch mock that returns a PDF buffer for pdf-downloads and a JSON
 * chat-completion response for the structurer call. Switches based on URL.
 */
const buildFetchMock = (structuredItems) => {
  return jest.fn(async (url) => {
    if (url.includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ items: structuredItems }),
              },
            },
          ],
        }),
        text: async () => '',
      };
    }

    // Default: PDF download
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(64),
    };
  });
};

describe('OCR pipeline integration', () => {
  let establishment;
  let originalFetch;

  beforeAll(async () => {
    const { partner } = await createPartnerAndGetToken();
    establishment = await createTestEstablishment(partner.id);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM menu_items WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM ocr_jobs WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
    originalFetch = global.fetch;
    openrouterModule.getOcrConfig.mockReturnValue(OCR_CONFIG);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM menu_items WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM ocr_jobs WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
  });

  test('end-to-end: pdf with text layer → structured items persisted, job marked done', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    // pdf-parse returns a realistic menu text → hasTextLayer=true
    const menuText =
      'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\n' +
      'Пицца Маргарита — 18 руб.\nКофе эспрессо — 4 руб.\n' +
      'Вода минеральная — 3 руб.';
    pdfParseModule.default.mockResolvedValue({
      text: menuText,
      numpages: 1,
    });

    // Structurer returns 5 items, one flagged-price (0.1), one low-confidence (0.5)
    const structuredItems = [
      { item_name: 'Борщ украинский', price_byn: 15, category_raw: 'Супы', confidence: 0.95 },
      { item_name: 'Салат Цезарь', price_byn: 12, category_raw: 'Салаты', confidence: 0.9 },
      { item_name: 'Пицца Маргарита', price_byn: 18, category_raw: 'Пицца', confidence: 0.88 },
      { item_name: 'Cheap item', price_byn: 0.1, category_raw: null, confidence: 0.9 },
      { item_name: 'Uncertain', price_byn: 20, category_raw: null, confidence: 0.5 },
    ];
    global.fetch = buildFetchMock(structuredItems);

    // Enqueue and atomically pick
    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();
    expect(picked).not.toBeNull();
    expect(picked.status).toBe('processing');
    expect(picked.attempts).toBe(1);

    // Run orchestrator
    const result = await ocrService.processJob(picked.id);
    expect(result.success).toBe(true);
    expect(result.itemCount).toBe(5);

    // Job marked done with result_summary
    const finalJob = await ocrJobModel.getJobStatus(picked.id);
    expect(finalJob.status).toBe('done');
    expect(finalJob.completed_at).not.toBeNull();
    expect(finalJob.error_message).toBeNull();
    expect(finalJob.result_summary).toMatchObject({
      strategy: 'pdf_text_layer',
      items_count: 5,
      flagged_count: 2,
    });

    // Menu items persisted with sanity flags applied
    const persistedItems = await menuItemModel.getByEstablishmentId(establishment.id, {
      includeHidden: true,
    });
    expect(persistedItems).toHaveLength(5);

    const byName = Object.fromEntries(persistedItems.map((it) => [it.item_name, it]));
    expect(byName['Борщ украинский'].sanity_flag).toBeNull();
    expect(byName['Cheap item'].sanity_flag).toMatchObject({
      reason: 'price_below_threshold',
    });
    expect(byName['Uncertain'].sanity_flag).toMatchObject({
      reason: 'low_confidence',
    });

    // Numeric types come back from pg as strings for DECIMAL — verify value
    expect(Number(byName['Борщ украинский'].price_byn)).toBe(15);
  });

  test('pdf-parse returns scanned PDF (no text layer) → vision fallback path', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    // pdf-parse returns short garbage text → hasTextLayer=false
    pdfParseModule.default.mockResolvedValue({
      text: 'xy',
      numpages: 2,
    });

    const structuredItems = [
      { item_name: 'Scanned Dish', price_byn: 10, category_raw: null, confidence: 0.85 },
    ];

    // Two OpenRouter calls happen: vision extract + structurer. For this test we
    // return the same mock for both — vision gets "raw text", structurer gets items.
    let chatCallCount = 0;
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/chat/completions')) {
        chatCallCount++;
        if (chatCallCount === 1) {
          // Vision call — return raw text
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: 'Scanned Dish — 10 руб' } }],
            }),
            text: async () => '',
          };
        }
        // Structurer call
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              { message: { content: JSON.stringify({ items: structuredItems }) } },
            ],
          }),
          text: async () => '',
        };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
    });

    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();
    const result = await ocrService.processJob(picked.id);

    expect(result.success).toBe(true);
    const finalJob = await ocrJobModel.getJobStatus(picked.id);
    expect(finalJob.status).toBe('done');
    expect(finalJob.result_summary.strategy).toBe('vision_pdf_fallback');
    expect(chatCallCount).toBe(2);
  });

  test('structurer throws → markFailed returns job to pending (retry)', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    pdfParseModule.default.mockResolvedValue({
      text: 'Борщ 15 руб.\nСалат 12 руб.\nПицца 18 руб.\nКофе 4 руб.',
      numpages: 1,
    });

    // 500 error from structurer
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/chat/completions')) {
        return { ok: false, status: 500, text: async () => 'upstream failure' };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
    });

    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();

    const result = await ocrService.processJob(picked.id);
    expect(result.success).toBe(false);

    const afterFail = await ocrJobModel.getJobStatus(picked.id);
    expect(afterFail.status).toBe('pending'); // attempts=1 < max_attempts=3 → retry
    expect(afterFail.attempts).toBe(1);
    expect(afterFail.error_message).toMatch(/500/);
    expect(afterFail.completed_at).toBeNull();
  });

  test('permanent failure: after max_attempts reached, job becomes failed', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    pdfParseModule.default.mockRejectedValue(new Error('parse error'));
    // vision also fails
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'fail',
      arrayBuffer: async () => new ArrayBuffer(64),
    }));

    // Force attempts to 3 so that the next processJob call drives to permanent failure
    const job = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    await pool.query(
      'UPDATE ocr_jobs SET attempts = 3 WHERE id = $1',
      [job.id],
    );

    const picked = await ocrJobModel.pickNextPending();
    expect(picked.attempts).toBe(4); // incremented from 3

    await ocrService.processJob(picked.id);

    const final = await ocrJobModel.getJobStatus(picked.id);
    expect(final.status).toBe('failed');
    expect(final.completed_at).not.toBeNull();
  });

  test('enqueue idempotency: second enqueue returns the active job', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    const first = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const second = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });

    expect(second.id).toBe(first.id);

    const rows = await pool.query(
      'SELECT COUNT(*) as count FROM ocr_jobs WHERE media_id = $1',
      [mediaId],
    );
    expect(parseInt(rows.rows[0].count, 10)).toBe(1);
  });

  test('replaceForMedia: previous items fully replaced, delta detected for price change', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    // Pre-seed menu_items with an item that will appear again with a spiked price
    await menuItemModel.createMany({
      establishmentId: establishment.id,
      mediaId,
      items: [
        { item_name: 'Борщ', price_byn: 10, confidence: 0.9, position: 0 },
        { item_name: 'Old item removed', price_byn: 5, confidence: 0.9, position: 1 },
      ],
    });

    pdfParseModule.default.mockResolvedValue({
      text: 'Борщ 50 руб\nСалат 12 руб\nПицца 18 руб\nКофе 4 руб',
      numpages: 1,
    });

    global.fetch = buildFetchMock([
      { item_name: 'Борщ', price_byn: 50, category_raw: null, confidence: 0.95 },
      { item_name: 'Салат', price_byn: 12, category_raw: null, confidence: 0.9 },
    ]);

    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();
    await ocrService.processJob(picked.id);

    const items = await menuItemModel.getByEstablishmentId(establishment.id, {
      includeHidden: true,
    });
    expect(items).toHaveLength(2);
    const borshch = items.find((it) => it.item_name === 'Борщ');
    expect(borshch.sanity_flag).toMatchObject({
      reason: 'price_delta_anomaly',
      details: expect.objectContaining({
        previousPrice: 10,
        currentPrice: 50,
      }),
    });
    expect(items.find((it) => it.item_name === 'Old item removed')).toBeUndefined();
  });
});
