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
const { default: logger } = await import('../../utils/logger.js');
const ocrJobModel = await import('../../models/ocrJobModel.js');
const menuItemModel = await import('../../models/menuItemModel.js');
const ocrService = await import('../../services/ocr/ocrService.js');
const ocrJobPoller = await import('../../services/ocr/ocrJobPoller.js');
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

describe('JOB_DURATION_BOUND_MS', () => {
  // server.js measures the graceful-shutdown budget against this sum; a renamed
  // summand would make it NaN, which never trips a comparison — pin it here,
  // where the real module (not a mock) is imported.
  test('is the finite sum of the three stage timeouts: PDF download + vision + structurer = 180 s', () => {
    expect(ocrService.JOB_DURATION_BOUND_MS).toBe(60000 + 60000 + 60000);
  });

  test('the price fallback starts no later than 60 s into the job: bound − vision − structurer', () => {
    // A later start would let text path + vision + second structurer outrun the bound.
    expect(ocrService.PRICE_FALLBACK_START_DEADLINE_MS).toBe(180000 - 60000 - 60000);
  });
});

describe('lacksPrices — text-layer items "almost without prices" (price share < 0.5)', () => {
  /** n structured items, the first `priced` of them with a price. */
  const items = (n, priced) => Array.from({ length: n }, (_, i) => ({
    item_name: `Блюдо ${i}`,
    price_byn: i < priced ? 10 : null,
    category_raw: null,
    confidence: 0.9,
  }));

  test('no price at all (Charlie: 0 of 73) → fallback', () => {
    expect(ocrService.lacksPrices(items(73, 0))).toBe(true);
  });

  test('49 of 100 priced → fallback; exactly half (50 of 100) → no fallback', () => {
    expect(ocrService.lacksPrices(items(100, 49))).toBe(true);
    expect(ocrService.lacksPrices(items(100, 50))).toBe(false);
  });

  test('healthy text layers of 28.09 (Zalkind 56 of 67 — set menus; SFB 48 of 49) → no fallback', () => {
    expect(ocrService.lacksPrices(items(67, 56))).toBe(false);
    expect(ocrService.lacksPrices(items(49, 48))).toBe(false);
  });

  test('no items → no fallback (nothing to price-check)', () => {
    expect(ocrService.lacksPrices([])).toBe(false);
  });
});

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
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [establishment.partner_id]);
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
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [establishment.partner_id]);
  });

  /** menu_parsed rows of the partner, oldest first. */
  const partnerNotifications = async () => {
    const result = await pool.query(
      `SELECT message FROM notifications
       WHERE user_id = $1 AND type = 'menu_parsed'
       ORDER BY created_at ASC`,
      [establishment.partner_id],
    );
    return result.rows;
  };

  /**
   * processJob notifies fire-and-forget after it has returned — poll the table
   * until the expected count shows up instead of sleeping a fixed time.
   */
  const waitForNotifications = async (expectedCount, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    let rows = await partnerNotifications();
    while (rows.length < expectedCount && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      rows = await partnerNotifications();
    }
    return rows;
  };

  /** Grace period for a negative assertion ("nothing was sent"). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  /** fetch mock where both the PDF download and the structurer call fail. */
  const failingFetch = () => jest.fn(async () => ({
    ok: false,
    status: 500,
    text: async () => 'fail',
    arrayBuffer: async () => new ArrayBuffer(64),
  }));

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

    // Prices are in place → the pages are not read again as images: one
    // OpenRouter call (the structurer), no price_fallback in the summary.
    const chatCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/chat/completions'));
    expect(chatCalls).toHaveLength(1);
    expect(finalJob.result_summary).not.toHaveProperty('price_fallback');

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

  test('menu photo (file_type=image) → vision_image strategy, items persisted', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'image');

    const structuredItems = [
      { item_name: 'Фото-блюдо', price_byn: 9, category_raw: null, confidence: 0.9 },
    ];

    // Two OpenRouter calls: vision extract (photo URL directly, no pg_N pages),
    // then structurer.
    let chatCallCount = 0;
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/chat/completions')) {
        chatCallCount++;
        if (chatCallCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: 'Фото-блюдо — 9 руб' } }],
            }),
            text: async () => '',
          };
        }
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
    expect(result.itemCount).toBe(1);

    const finalJob = await ocrJobModel.getJobStatus(picked.id);
    expect(finalJob.status).toBe('done');
    expect(finalJob.result_summary.strategy).toBe('vision_image');
    expect(chatCallCount).toBe(2);
    // Photos never touch the pdf-parse path.
    expect(pdfParseModule.default).not.toHaveBeenCalled();

    const persistedItems = await menuItemModel.getByEstablishmentId(establishment.id, {
      includeHidden: true,
    });
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0].item_name).toBe('Фото-блюдо');
    expect(persistedItems[0].media_id).toBe(mediaId);
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

  // ── Text layer without prices → pages read as images ────────────────────
  // 2026-09-28, re-OCR on gemini-3.8-flash: Charlie's PDF keeps its prices in
  // a separate column of the text layer; the structurer gave 73 items without
  // a single price, while the same pages read as images gave all prices.

  describe('text-layer PDF almost without prices → page images (price fallback)', () => {
    // Names first, the price column after them — the layout of Charlie's text layer.
    const CHARLIE_TEXT_LAYER =
      'СУПЫ\nБиск из лобстера с морепродуктами 310 гр\nЛуковый суп 320 гр\n' +
      'Окрошка с ростбифом 400 гр\nХОЛОДНЫЕ ЗАКУСКИ\nТартар из лосося с авокадо 180 гр\n' +
      '59\n38\n37\n46';
    const CHARLIE_TEXT_ITEMS = [
      { item_name: 'Биск из лобстера с морепродуктами', price_byn: null, category_raw: 'СУПЫ', confidence: 0.9 },
      { item_name: 'Луковый суп', price_byn: null, category_raw: 'СУПЫ', confidence: 0.9 },
      { item_name: 'Окрошка с ростбифом', price_byn: null, category_raw: 'СУПЫ', confidence: 0.9 },
      { item_name: 'Тартар из лосося с авокадо', price_byn: null, category_raw: 'ХОЛОДНЫЕ ЗАКУСКИ', confidence: 0.9 },
    ];
    const CHARLIE_VISION_TEXT =
      '--- PAGE 1 ---\nСУПЫ\nБиск из лобстера с морепродуктами 310 гр 59\nЛуковый суп 320 гр 38\n' +
      'Окрошка с ростбифом 400 гр 37\n--- PAGE 2 ---\nХОЛОДНЫЕ ЗАКУСКИ\n' +
      'Тартар из лосося с авокадо 180 гр 46\nСевиче из сибаса 165 гр 62';
    const CHARLIE_VISION_ITEMS = [
      { item_name: 'Биск из лобстера с морепродуктами', price_byn: 59, category_raw: 'СУПЫ', confidence: 0.95 },
      { item_name: 'Луковый суп', price_byn: 38, category_raw: 'СУПЫ', confidence: 0.95 },
      { item_name: 'Окрошка с ростбифом', price_byn: 37, category_raw: 'СУПЫ', confidence: 0.95 },
      { item_name: 'Тартар из лосося с авокадо', price_byn: 46, category_raw: 'ХОЛОДНЫЕ ЗАКУСКИ', confidence: 0.95 },
      { item_name: 'Севиче из сибаса', price_byn: 62, category_raw: 'ХОЛОДНЫЕ ЗАКУСКИ', confidence: 0.95 },
    ];

    const chatResponse = (content) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    });

    const upstreamFailure = { ok: false, status: 500, text: async () => 'upstream failure' };

    /**
     * fetch mock routed by request shape, not by call order: a vision request
     * (image_url parts) answers `visionText` — or HTTP 500 with `visionFails`;
     * a structurer request answers the items registered for its input text —
     * or HTTP 500 when its input is `failStructurerOn`.
     * `calls` records the image URLs of each vision call and each structurer input.
     */
    const routedFetch = ({ visionText = '', visionFails = false, failStructurerOn = null, itemsByText }) => {
      const calls = { vision: [], structurer: [] };
      const fetchMock = jest.fn(async (url, init) => {
        if (!url.includes('/chat/completions')) {
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
        }
        const userContent = JSON.parse(init.body).messages[1].content;
        if (Array.isArray(userContent)) {
          calls.vision.push(userContent.filter((part) => part.type === 'image_url').map((part) => part.image_url.url));
          return visionFails ? upstreamFailure : chatResponse(visionText);
        }
        calls.structurer.push(userContent);
        if (userContent === failStructurerOn) return upstreamFailure;
        const items = itemsByText.get(userContent);
        if (!items) throw new Error(`unexpected structurer input: ${userContent.slice(0, 40)}`);
        return chatResponse(JSON.stringify({ items }));
      });
      return { fetchMock, calls };
    };

    /** Enqueue, pick and run a job for `mediaId`; returns the settled job row. */
    const runJob = async (mediaId) => {
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
      const picked = await ocrJobModel.pickNextPending();
      const result = await ocrService.processJob(picked.id);
      return { result, job: await ocrJobModel.getJobStatus(picked.id) };
    };

    const persistedByPosition = async () => {
      const items = await menuItemModel.getByEstablishmentId(establishment.id, { includeHidden: true });
      return [...items]
        .sort((a, b) => a.position - b.position)
        .map((it) => [it.item_name, it.price_byn == null ? null : Number(it.price_byn)]);
    };

    test('Charlie: no prices in the text layer → pages read as images, the priced result is saved', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: CHARLIE_TEXT_LAYER, numpages: 3 });
      const { fetchMock, calls } = routedFetch({
        visionText: CHARLIE_VISION_TEXT,
        itemsByText: new Map([
          [CHARLIE_TEXT_LAYER, CHARLIE_TEXT_ITEMS],
          [CHARLIE_VISION_TEXT, CHARLIE_VISION_ITEMS],
        ]),
      });
      global.fetch = fetchMock;
      const infoSpy = jest.spyOn(logger, 'info');

      let result;
      let job;
      try {
        ({ result, job } = await runJob(mediaId));
        // Both outcomes reach the log too — the job's completion line carries the summary.
        expect(infoSpy).toHaveBeenCalledWith('OCR job completed', expect.objectContaining({
          strategy: 'vision_pdf_price_fallback',
          price_fallback: expect.objectContaining({
            text_layer: { items_count: 4, priced_count: 0 },
            vision: { items_count: 5, priced_count: 5 },
          }),
        }));
      } finally {
        infoSpy.mockRestore();
      }

      expect(result).toMatchObject({ success: true, itemCount: 5 });
      expect(job.status).toBe('done');
      expect(job.result_summary).toEqual({
        strategy: 'vision_pdf_price_fallback',
        items_count: 5,
        flagged_count: 0,
        confidence_avg: 0.95,
        price_fallback: {
          outcome: 'vision',
          text_layer: { items_count: 4, priced_count: 0 },
          vision: { items_count: 5, priced_count: 5 },
        },
      });

      // Every page of the PDF (pdf-parse counted 3), rendered by Cloudinary — in one vision call.
      const page = (n) =>
        `https://res.cloudinary.com/test/image/upload/pg_${n}/v1/establishments/${establishment.id}/menu_pdf/test.jpg`;
      expect(calls.vision).toEqual([[page(1), page(2), page(3)]]);
      expect(calls.structurer).toEqual([CHARLIE_TEXT_LAYER, CHARLIE_VISION_TEXT]);

      expect(await persistedByPosition()).toEqual([
        ['Биск из лобстера с морепродуктами', 59],
        ['Луковый суп', 38],
        ['Окрошка с ростбифом', 37],
        ['Тартар из лосося с авокадо', 46],
        ['Севиче из сибаса', 62],
      ]);
    });

    test('menu honestly without prices: images give more items but no more prices → text-layer items kept', async () => {
      const wineText =
        'ВИННАЯ КАРТА\nШардоне Бургундия 2021 0,75 л — по запросу\n' +
        'Кьянти Классико 2019 0,75 л — по запросу\nРислинг Мозель 2022 0,75 л — по запросу';
      const wineVisionText =
        'ВИННАЯ КАРТА\nШардоне, Бургундия 2021 — по запросу\nКьянти 2019 — по запросу\n' +
        'Рислинг 2022 — по запросу\nМерло — по запросу';
      const textItems = [
        { item_name: 'Шардоне Бургундия 2021', price_byn: null, category_raw: 'ВИННАЯ КАРТА', confidence: 0.9 },
        { item_name: 'Кьянти Классико 2019', price_byn: null, category_raw: 'ВИННАЯ КАРТА', confidence: 0.9 },
        { item_name: 'Рислинг Мозель 2022', price_byn: null, category_raw: 'ВИННАЯ КАРТА', confidence: 0.9 },
      ];
      // One item more than the text layer, none priced: the choice goes by prices, not by items.
      const visionItems = [
        { item_name: 'Шардоне, Бургундия', price_byn: null, category_raw: 'ВИННАЯ КАРТА', confidence: 0.85 },
        { item_name: 'Кьянти', price_byn: null, category_raw: 'ВИННАЯ КАРТА', confidence: 0.85 },
        { item_name: 'Рислинг', price_byn: null, category_raw: 'ВИННАЯ КАРТА', confidence: 0.85 },
        { item_name: 'Мерло', price_byn: null, category_raw: 'ВИННАЯ КАРТА', confidence: 0.85 },
      ];
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: wineText, numpages: 1 });
      const { fetchMock, calls } = routedFetch({
        visionText: wineVisionText,
        itemsByText: new Map([[wineText, textItems], [wineVisionText, visionItems]]),
      });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result).toMatchObject({ success: true, itemCount: 3 });
      expect(calls.vision).toHaveLength(1);
      expect(job.result_summary).toMatchObject({
        strategy: 'pdf_text_layer',
        items_count: 3,
        price_fallback: {
          outcome: 'vision_not_better',
          text_layer: { items_count: 3, priced_count: 0 },
          vision: { items_count: 4, priced_count: 0 },
        },
      });
      expect(await persistedByPosition()).toEqual([
        ['Шардоне Бургундия 2021', null],
        ['Кьянти Классико 2019', null],
        ['Рислинг Мозель 2022', null],
      ]);
    });

    test.each([
      ['the vision call', { visionFails: true }, 1, /OpenRouter vision call failed: 500/],
      ['the second structurer call', { failStructurerOn: CHARLIE_VISION_TEXT }, 2, /OpenRouter structurer call failed: 500/],
    ])('%s fails → text-layer items kept, the job is done (not failed, not retried)', async (
      _failingCall, failure, structurerCalls, errorPattern,
    ) => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: CHARLIE_TEXT_LAYER, numpages: 2 });
      const { fetchMock, calls } = routedFetch({
        visionText: CHARLIE_VISION_TEXT,
        ...failure,
        itemsByText: new Map([
          [CHARLIE_TEXT_LAYER, CHARLIE_TEXT_ITEMS],
          [CHARLIE_VISION_TEXT, CHARLIE_VISION_ITEMS],
        ]),
      });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result).toMatchObject({ success: true, itemCount: 4 });
      expect(job.status).toBe('done');
      expect(job.error_message).toBeNull();
      expect(calls.vision).toHaveLength(1);
      expect(calls.structurer).toHaveLength(structurerCalls);
      expect(job.result_summary).toMatchObject({
        strategy: 'pdf_text_layer',
        items_count: 4,
        price_fallback: {
          outcome: 'vision_failed',
          text_layer: { items_count: 4, priced_count: 0 },
        },
      });
      expect(job.result_summary.price_fallback.error).toMatch(errorPattern);
      expect(await persistedByPosition()).toEqual(CHARLIE_TEXT_ITEMS.map((it) => [it.item_name, null]));
    });

    test.each([
      ['the PDF download', (url) => !url.includes('/chat/completions')],
      ['the text-layer structurer call', (url) => url.includes('/chat/completions')],
    ])('61 s spent in %s → past the start deadline: no vision call, text-layer items kept', async (
      _slowStage, isSlowStage,
    ) => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: CHARLIE_TEXT_LAYER, numpages: 2 });
      const { fetchMock, calls } = routedFetch({
        visionText: CHARLIE_VISION_TEXT,
        itemsByText: new Map([
          [CHARLIE_TEXT_LAYER, CHARLIE_TEXT_ITEMS],
          [CHARLIE_VISION_TEXT, CHARLIE_VISION_ITEMS],
        ]),
      });
      // The slow stage "takes" 61 s: from its first request on, the clock runs
      // 61 s ahead of the job's start. Both stages must count — the job's
      // clock starts before the download, not after it.
      let skewMs = 0;
      const realNow = Date.now.bind(Date);
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skewMs);
      global.fetch = jest.fn(async (url, init) => {
        if (isSlowStage(url)) skewMs = 61000;
        return fetchMock(url, init);
      });

      try {
        const { result, job } = await runJob(mediaId);

        expect(result).toMatchObject({ success: true, itemCount: 4 });
        expect(calls.vision).toHaveLength(0);
        expect(job.result_summary).toMatchObject({
          strategy: 'pdf_text_layer',
          price_fallback: {
            outcome: 'no_budget',
            text_layer: { items_count: 4, priced_count: 0 },
          },
        });
        expect(job.result_summary.price_fallback.elapsed_ms).toBeGreaterThan(60000);
        expect(await persistedByPosition()).toEqual(CHARLIE_TEXT_ITEMS.map((it) => [it.item_name, null]));
      } finally {
        nowSpy.mockRestore();
      }
    });

    test.each([
      ['menu photo', 'image', 'vision_image'],
      ['scanned PDF (no text layer)', 'pdf', 'vision_pdf_fallback'],
    ])('%s without prices is not re-read — the fallback belongs to the text layer only', async (
      _kind, fileType, strategy,
    ) => {
      const { mediaId } = await insertTestMedia(establishment.id, fileType);
      pdfParseModule.default.mockResolvedValue({ text: 'xy', numpages: 2 });
      const visionText = 'Чай чёрный\nЧай зелёный';
      const { fetchMock, calls } = routedFetch({
        visionText,
        itemsByText: new Map([[visionText, [
          { item_name: 'Чай чёрный', price_byn: null, category_raw: null, confidence: 0.9 },
          { item_name: 'Чай зелёный', price_byn: null, category_raw: null, confidence: 0.9 },
        ]]]),
      });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result).toMatchObject({ success: true, itemCount: 2 });
      expect(calls.vision).toHaveLength(1);
      expect(calls.structurer).toHaveLength(1);
      expect(job.result_summary.strategy).toBe(strategy);
      expect(job.result_summary).not.toHaveProperty('price_fallback');
    });
  });

  // ── Batch-level partner notification ─────────────────────────────────────
  // Coordinator decision 2026-09-04, option «б»: a job is one file, the
  // partner uploads a menu — notify once, when the last active job settles,
  // with totals over the whole menu. Before this, every job produced its own
  // in-app row and push.

  describe('menu_parsed notification — once per upload batch', () => {
    const menuText =
      'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\n' +
      'Пицца Маргарита — 18 руб.\nКофе эспрессо — 4 руб.\n' +
      'Вода минеральная — 3 руб.';

    const fiveItems = [
      { item_name: 'Борщ украинский', price_byn: 15, category_raw: 'Супы', confidence: 0.95 },
      { item_name: 'Салат Цезарь', price_byn: 12, category_raw: 'Салаты', confidence: 0.9 },
      { item_name: 'Пицца Маргарита', price_byn: 18, category_raw: 'Пицца', confidence: 0.88 },
      { item_name: 'Кофе эспрессо', price_byn: 4, category_raw: 'Напитки', confidence: 0.9 },
      { item_name: 'Вода минеральная', price_byn: 3, category_raw: 'Напитки', confidence: 0.9 },
    ];

    const threeItems = [
      { item_name: 'Тирамису', price_byn: 9, category_raw: 'Десерты', confidence: 0.9 },
      { item_name: 'Чизкейк', price_byn: 8, category_raw: 'Десерты', confidence: 0.9 },
      { item_name: 'Чай', price_byn: 3, category_raw: 'Напитки', confidence: 0.9 },
    ];

    /** Pick the oldest pending job and run it with the given structurer output. */
    const runNextJobWith = async (items) => {
      pdfParseModule.default.mockResolvedValue({ text: menuText, numpages: 1 });
      global.fetch = buildFetchMock(items);
      const picked = await ocrJobModel.pickNextPending();
      expect(picked).not.toBeNull();
      const result = await ocrService.processJob(picked.id);
      expect(result.success).toBe(true);
      return picked;
    };

    test('single file → one notification with the per-file wording', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });

      await runNextJobWith(fiveItems);

      // processJob awaits the notification (graceful-shutdown safety): the row
      // must exist the moment processJob resolves — no polling here on purpose.
      const rows = await partnerNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 5 позиций');
    });

    test('a zombie processing job (older than STALE_PROCESSING_INTERVAL) does not hold the batch open', async () => {
      // Process died mid-job hours ago: the row stays 'processing' and nothing will settle it.
      const zombie = await insertTestMedia(establishment.id, 'pdf');
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, started_at)
         VALUES ($1, $2, 'processing', 1, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
        [establishment.id, zombie.mediaId],
      );

      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
      await runNextJobWith(fiveItems);

      const rows = await partnerNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 5 позиций');
    });

    test('a fresh processing sibling does hold the batch open', async () => {
      const sibling = await insertTestMedia(establishment.id, 'pdf');
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, started_at)
         VALUES ($1, $2, 'processing', 1, NOW())`,
        [establishment.id, sibling.mediaId],
      );

      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
      await runNextJobWith(fiveItems);

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);
    });

    test('two files queued together → silence after the first job, ONE aggregated notification after the last', async () => {
      const first = await insertTestMedia(establishment.id, 'pdf');
      const second = await insertTestMedia(establishment.id, 'pdf');

      // Both files are queued up front — that is what an upload of N files looks like.
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: first.mediaId });
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: second.mediaId });

      const firstJob = await runNextJobWith(fiveItems);
      expect(firstJob.media_id).toBe(first.mediaId);

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      const secondJob = await runNextJobWith(threeItems);
      expect(secondJob.media_id).toBe(second.mediaId);

      const rows = await waitForNotifications(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe(
        'Меню «Test Restaurant» распознано — всего 8 позиций из 2 файлов',
      );

      // Nothing more arrives later either.
      await settle();
      expect(await partnerNotifications()).toHaveLength(1);
    });

    test('a retry (failure with attempts left) keeps the batch open; the retried job closes it', async () => {
      const good = await insertTestMedia(establishment.id, 'pdf');
      const flaky = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: good.mediaId });
      const flakyJob = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: flaky.mediaId });

      await runNextJobWith(fiveItems);
      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      // First attempt of the second file fails → back to 'pending' → batch still open.
      pdfParseModule.default.mockRejectedValue(new Error('parse error'));
      global.fetch = failingFetch();
      const attempt = await ocrJobModel.pickNextPending();
      expect(attempt.id).toBe(flakyJob.id);
      expect((await ocrService.processJob(attempt.id)).success).toBe(false);
      expect((await ocrJobModel.getJobStatus(attempt.id)).status).toBe('pending');

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      // The retry succeeds and is the last active job → one notification, full totals.
      const retried = await runNextJobWith(threeItems);
      expect(retried.id).toBe(flakyJob.id);

      const rows = await waitForNotifications(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe(
        'Меню «Test Restaurant» распознано — всего 8 позиций из 2 файлов',
      );
    });

    test('permanent failure of the last file still reports what the batch recognised', async () => {
      const good = await insertTestMedia(establishment.id, 'pdf');
      const bad = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: good.mediaId });
      const badJob = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: bad.mediaId });
      // Last allowed attempt: the next pick drives it to permanent failure.
      await pool.query('UPDATE ocr_jobs SET attempts = 3 WHERE id = $1', [badJob.id]);

      const goodJob = await runNextJobWith(fiveItems);
      expect(goodJob.media_id).toBe(good.mediaId);

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      pdfParseModule.default.mockRejectedValue(new Error('parse error'));
      global.fetch = failingFetch();
      const picked = await ocrJobModel.pickNextPending();
      expect(picked.id).toBe(badJob.id);
      expect((await ocrService.processJob(picked.id)).success).toBe(false);
      expect((await ocrJobModel.getJobStatus(picked.id)).status).toBe('failed');

      const rows = await waitForNotifications(1);
      expect(rows).toHaveLength(1);
      // Only the good file yielded items → single-file wording, failed file not mentioned.
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 5 позиций');
    });

    test('lone permanent failure with nothing recognised in its batch stays silent', async () => {
      // An older batch already produced items — must not be mistaken for this one.
      const old = await insertTestMedia(establishment.id, 'pdf');
      await menuItemModel.createMany({
        establishmentId: establishment.id,
        mediaId: old.mediaId,
        items: [{ item_name: 'Старая позиция', price_byn: 5, confidence: 0.9, position: 0 }],
      });
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, completed_at)
         VALUES ($1, $2, 'done', 1, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')`,
        [establishment.id, old.mediaId],
      );

      const bad = await insertTestMedia(establishment.id, 'pdf');
      const badJob = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: bad.mediaId });
      await pool.query('UPDATE ocr_jobs SET attempts = 3 WHERE id = $1', [badJob.id]);

      pdfParseModule.default.mockRejectedValue(new Error('parse error'));
      global.fetch = failingFetch();
      const picked = await ocrJobModel.pickNextPending();
      expect(picked.id).toBe(badJob.id);
      expect((await ocrService.processJob(picked.id)).success).toBe(false);
      expect((await ocrJobModel.getJobStatus(picked.id)).status).toBe('failed');

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);
    });
  });

  // ── Stale processing sweep (poller reaper) ───────────────────────────────
  // A 'processing' row whose process died mid-job is settled by nobody:
  // enqueue keeps returning it ("re-run OCR" is dead for that file) and the
  // admin health signals count it as in flight. ocrJobPoller.sweepStaleJobs
  // settles rows older than STALE_PROCESSING_INTERVAL under the markFailed
  // retry rule. The poller itself never starts under NODE_ENV=test — the
  // sweep is invoked directly, like processJob.

  describe('stale processing sweep — ocrJobPoller.sweepStaleJobs', () => {
    /**
     * A job whose process died `age` ago (PostgreSQL interval literal), with
     * the row left in 'processing'. Age is written by the database, like
     * pickNextPending does, so the comparison never crosses the driver.
     */
    const insertZombie = async ({ attempts, age, withStartedAt = true }) => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      const startedAtSql = withStartedAt ? 'NOW() - $4::interval' : 'NULL';
      const result = await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, started_at)
         VALUES ($1, $2, 'processing', $3, NOW() - $4::interval, ${startedAtSql})
         RETURNING *`,
        [establishment.id, mediaId, attempts, age],
      );
      return result.rows[0];
    };

    /** A batch mate that finished 90 minutes ago and produced `items`. */
    const insertDoneMate = async (items) => {
      const mate = await insertTestMedia(establishment.id, 'pdf');
      await menuItemModel.createMany({
        establishmentId: establishment.id,
        mediaId: mate.mediaId,
        items,
      });
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, completed_at)
         VALUES ($1, $2, 'done', 1, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '90 minutes')`,
        [establishment.id, mate.mediaId],
      );
      return mate;
    };

    /** The sweep is global across the test DB — judge only rows of this establishment. */
    const ownReaped = (rows) => rows.filter((job) => job.establishment_id === establishment.id);

    test('older than STALE_PROCESSING_INTERVAL with attempts left → back to pending; re-run works again', async () => {
      const zombie = await insertZombie({ attempts: 1, age: '2 hours' });

      const reaped = ownReaped(await ocrJobPoller.sweepStaleJobs());
      expect(reaped.map((job) => job.id)).toEqual([zombie.id]);

      const after = await ocrJobModel.getJobStatus(zombie.id);
      expect(after.status).toBe('pending');
      expect(after.attempts).toBe(1);
      expect(after.error_message).toBe('stale processing reaped after 1 hour');
      expect(after.started_at).toBeNull();
      expect(after.completed_at).toBeNull();

      // Active again through the normal path: enqueue returns it (no duplicate)
      // and the poller picks it up for its second attempt.
      const again = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: zombie.media_id });
      expect(again.id).toBe(zombie.id);
      const picked = await ocrJobModel.pickNextPending();
      expect(picked.id).toBe(zombie.id);
      expect(picked.attempts).toBe(2);
      expect(picked.started_at).not.toBeNull();
    });

    test('older than the interval with no attempts left → failed with completed_at; the media can be queued anew', async () => {
      const zombie = await insertZombie({ attempts: 3, age: '2 hours' });

      const reaped = ownReaped(await ocrJobPoller.sweepStaleJobs());
      expect(reaped.map((job) => job.status)).toEqual(['failed']);

      const after = await ocrJobModel.getJobStatus(zombie.id);
      expect(after.status).toBe('failed');
      expect(after.attempts).toBe(3);
      expect(after.error_message).toBe('stale processing reaped after 1 hour');
      expect(after.completed_at).not.toBeNull();
      expect(after.started_at).not.toBeNull();

      // Before the sweep, enqueue would have returned the zombie forever.
      const fresh = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: zombie.media_id });
      expect(fresh.id).not.toBe(zombie.id);
      expect(fresh.status).toBe('pending');
      expect(fresh.attempts).toBe(0);
    });

    test('a fresh processing row is untouched', async () => {
      const inFlight = await insertZombie({ attempts: 1, age: '5 minutes' });

      const reaped = ownReaped(await ocrJobPoller.sweepStaleJobs());
      expect(reaped).toEqual([]);

      const after = await ocrJobModel.getJobStatus(inFlight.id);
      expect(after.status).toBe('processing');
      expect(after.attempts).toBe(1);
      expect(after.error_message).toBeNull();
      expect(after.started_at).not.toBeNull();
      expect(after.completed_at).toBeNull();
    });

    test('started_at NULL falls back to created_at for the age', async () => {
      const zombie = await insertZombie({ attempts: 1, age: '2 hours', withStartedAt: false });

      await ocrJobPoller.sweepStaleJobs();

      expect((await ocrJobModel.getJobStatus(zombie.id)).status).toBe('pending');
    });

    test('permanently failing the last job of a batch reports what its batch mates recognised', async () => {
      await insertDoneMate([
        { item_name: 'Борщ', price_byn: 15, confidence: 0.9, position: 0 },
        { item_name: 'Салат', price_byn: 12, confidence: 0.9, position: 1 },
      ]);
      const zombie = await insertZombie({ attempts: 3, age: '2 hours' });

      await ocrJobPoller.sweepStaleJobs();
      expect((await ocrJobModel.getJobStatus(zombie.id)).status).toBe('failed');

      // The sweep awaits the notification: the row exists the moment it resolves.
      const rows = await partnerNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 2 позиции');
    });

    test('a job reaped back to pending keeps the batch open — no notification', async () => {
      await insertDoneMate([
        { item_name: 'Борщ', price_byn: 15, confidence: 0.9, position: 0 },
      ]);
      const zombie = await insertZombie({ attempts: 1, age: '2 hours' });

      await ocrJobPoller.sweepStaleJobs();
      expect((await ocrJobModel.getJobStatus(zombie.id)).status).toBe('pending');

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);
    });
  });
});
