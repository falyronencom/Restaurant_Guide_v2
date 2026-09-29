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
const pdfTextExtractor = await import('../../services/ocr/pdfTextExtractor.js');
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
});

describe('carryCategoriesAcrossPages — the section open at a page break', () => {
  // The pages as the structurer returns them one by one; processJob joins
  // them (see "PDF menus" below for the whole path).
  const item = (name, category) => ({ item_name: name, price_byn: 10, category_raw: category, confidence: 0.9 });
  const joined = (pages) => {
    const { items, categoriesCarried } = ocrService.carryCategoriesAcrossPages(pages);
    return { categories: items.map((it) => [it.item_name, it.category_raw]), categoriesCarried };
  };

  test('a menu without headings has nothing to carry', () => {
    expect(joined([[item('Борщ', null)], [item('Чай', null)]])).toEqual({
      categories: [['Борщ', null], ['Чай', null]],
      categoriesCarried: 0,
    });
  });

  test('a page without a heading of its own continues the open section to its end', () => {
    expect(joined([[item('Шардоне', 'Вино')], [item('Рислинг', null), item('Мерло', null)]])).toEqual({
      categories: [['Шардоне', 'Вино'], ['Рислинг', 'Вино'], ['Мерло', 'Вино']],
      categoriesCarried: 2,
    });
  });

  test('a null at the end of a page stays null and does not close the section for the next page', () => {
    expect(joined([
      [item('Борщ', 'Супы'), item('Хлеб', null)],
      [item('Солянка', null), item('Цезарь', 'Салаты')],
    ])).toEqual({
      categories: [['Борщ', 'Супы'], ['Хлеб', null], ['Солянка', 'Супы'], ['Цезарь', 'Салаты']],
      categoriesCarried: 1,
    });
  });

  test('a blank category is none: carried over at the top of a page, never opening a section', () => {
    // The response schema lets category_raw be '' — it must not pass for a section name.
    expect(joined([[item('Борщ', 'Супы')], [item('Солянка', '  ')], [item('Уха', null)]])).toEqual({
      categories: [['Борщ', 'Супы'], ['Солянка', 'Супы'], ['Уха', 'Супы']],
      categoriesCarried: 2,
    });
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

  test('end-to-end: pdf → pages read as images, structured items persisted, job marked done', async () => {
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
      strategy: 'vision_pdf',
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

  test('scanned PDF (no text layer) → pages read as images (vision_pdf)', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    // pdf-parse returns short garbage text → hasTextLayer=false
    pdfParseModule.default.mockResolvedValue({
      text: 'xy',
      numpages: 2,
    });

    const structuredItems = [
      { item_name: 'Scanned Dish', price_byn: 10, category_raw: null, confidence: 0.85 },
    ];

    // OpenRouter calls: a vision call per page (the request carries the page
    // image), then a structurer call per page with text. Page 1 has the dish,
    // page 2 is blank — it costs no structurer call.
    let chatCallCount = 0;
    global.fetch = jest.fn(async (url, init) => {
      if (url.includes('/chat/completions')) {
        chatCallCount++;
        const userContent = JSON.parse(init.body).messages[1].content;
        if (Array.isArray(userContent)) {
          const isFirstPage = userContent.some((part) => part.image_url?.url.includes('/pg_1/'));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: isFirstPage ? 'Scanned Dish — 10 руб' : '' } }],
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
    expect(finalJob.result_summary.strategy).toBe('vision_pdf');
    expect(chatCallCount).toBe(3);
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

  test('OpenRouter failing (vision and structurer) → markFailed returns job to pending (retry)', async () => {
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

  // ── PDF menus: page images first, the text layer only as a backup ────────
  // 2026-09-29: a text layer keeps the words but not the layout. Where a menu
  // sets its prices in a column apart from the dish names, the text carries
  // them as a separate block and the structurer guesses the pairing: Charlie's
  // breakfast menu came out with 15 prices of 35 on the wrong dishes, SFB Minsk
  // with 17 on an active card. The same pages read as images gave the right
  // prices — every PDF is now read as images, its text layer is the backup.
  //
  // Same day, later: page by page. One vision call for every page and one
  // structurer call for the whole menu were the ceiling on big menus — the
  // structurer timed out at 60 s on Сорренто (161 items) and the vision call
  // returned Zalkind's pages out of order. Now each page has its own vision
  // call and its own structurer call, and the pages of a stage run at once.

  describe('PDF menus: read and structured page by page, the text layer only as a backup', () => {
    // Charlie's breakfast page as its text layer carries it (29.09): the
    // prices first, as one block, the dish names after them.
    const TEXT_LAYER =
      '20\n46\n38\n39\n' +
      'ХЛЕБ\nБриошь, джем, масло 180 г\nЯЙЦА\nБенедикт с лососем и красной икрой 270 г\n' +
      'Оладьи из цукини с яйцом пашот 360 г\nЯйца пашот с ростбифом и сальсой 300 г';
    // What the structurer made of that text on 29.09: prices on the wrong dishes.
    const TEXT_LAYER_ITEMS = [
      { item_name: 'Бриошь, джем, масло', price_byn: 20, category_raw: 'ХЛЕБ', confidence: 0.9 },
      { item_name: 'Бенедикт с лососем и красной икрой', price_byn: 46, category_raw: 'ЯЙЦА', confidence: 0.9 },
      { item_name: 'Оладьи из цукини с яйцом пашот', price_byn: 38, category_raw: 'ЯЙЦА', confidence: 0.9 },
      { item_name: 'Яйца пашот с ростбифом и сальсой', price_byn: 39, category_raw: 'ЯЙЦА', confidence: 0.9 },
    ];
    // The same page read as an image: each price next to its dish (checked by eye).
    const PAGE_IMAGE_TEXT =
      'ХЛЕБ\nБриошь, джем, масло 180 г 9\nЯЙЦА\nБенедикт с лососем и красной икрой 270 г 38\n' +
      'Оладьи из цукини с яйцом пашот 360 г 37\nЯйца пашот с ростбифом и сальсой 300 г 38';
    const PAGE_IMAGE_ITEMS = [
      { item_name: 'Бриошь, джем, масло', price_byn: 9, category_raw: 'ХЛЕБ', confidence: 0.95 },
      { item_name: 'Бенедикт с лососем и красной икрой', price_byn: 38, category_raw: 'ЯЙЦА', confidence: 0.95 },
      { item_name: 'Оладьи из цукини с яйцом пашот', price_byn: 37, category_raw: 'ЯЙЦА', confidence: 0.95 },
      { item_name: 'Яйца пашот с ростбифом и сальсой', price_byn: 38, category_raw: 'ЯЙЦА', confidence: 0.95 },
    ];
    const ITEMS_BY_TEXT = new Map([[TEXT_LAYER, TEXT_LAYER_ITEMS], [PAGE_IMAGE_TEXT, PAGE_IMAGE_ITEMS]]);

    // A menu whose sections run on across pages, as Facktory Bar's did
    // (29.09): structured one page at a time, the top of a page does not see
    // the heading of its section. Page 3 is a picture with nothing to read.
    const SEAM_PAGE_1 = 'SNACKS\nBEEF TARTARE 33\nBACON WRAPPED SHRIMP 32';
    const SEAM_PAGE_2 =
      'TURKEY CARPACCIO 28\nMIXED BRUSCHETTA SET 43\nSALADS\nAVOCADO SALMON SALAD 33\nMAIN DISH\nGRILLED TUNA 55';
    const SEAM_PAGE_4 = 'KENTUCKY CUTLET 45\nBURGERS\nCHICKEN BURGER 30\nСоус к бургерам 3';
    const seamItem = (itemName, priceByn, categoryRaw) =>
      ({ item_name: itemName, price_byn: priceByn, category_raw: categoryRaw, confidence: 0.95 });
    // What the structurer returns for each page on its own: the items at the
    // top of pages 2 and 4 carry no category.
    const SEAM_ITEMS = new Map([
      [SEAM_PAGE_1, [seamItem('BEEF TARTARE', 33, 'SNACKS'), seamItem('BACON WRAPPED SHRIMP', 32, 'SNACKS')]],
      [SEAM_PAGE_2, [
        seamItem('TURKEY CARPACCIO', 28, null),
        seamItem('MIXED BRUSCHETTA SET', 43, null),
        seamItem('AVOCADO SALMON SALAD', 33, 'SALADS'),
        seamItem('GRILLED TUNA', 55, 'MAIN DISH'),
      ]],
      [SEAM_PAGE_4, [
        seamItem('KENTUCKY CUTLET', 45, null),
        seamItem('CHICKEN BURGER', 30, 'BURGERS'),
        seamItem('Соус к бургерам', 3, null),
      ]],
    ]);

    /** Cloudinary rendering of page n of the test PDF (generatePdfPageImageUrl). */
    const page = (n) =>
      `https://res.cloudinary.com/test/image/upload/pg_${n}/v1/establishments/${establishment.id}/menu_pdf/test.jpg`;

    const chatResponse = (content, { finishReason = 'stop', nativeFinishReason = 'STOP' } = {}) => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content }, finish_reason: finishReason, native_finish_reason: nativeFinishReason }],
      }),
      text: async () => '',
    });

    /**
     * fetch mock routed by request shape, not by call order. A vision request
     * carries one page image and answers the text `pageTexts` registers for
     * that page — a page not listed is blank — or HTTP 500 for every page with
     * `visionFails`; `pageFaults` overrides single pages: `{ status }` fails
     * the call, `{ finishReason, nativeFinishReason }` ends the answer early.
     * A structurer request answers the items `itemsByText` registers for its
     * input text, or HTTP 500 when its input is `failStructurerOn`.
     * `delaysMs` (keyed by page URL or by structurer input) holds single calls
     * back; `callDelayMs` holds back every call.
     * Records: `calls` — the image URLs of each vision call and each
     * structurer input; `events` — the start and the end of every call, in
     * order; `inFlight` (live) and `maxInFlight` — calls under way, per kind.
     */
    const routedFetch = ({
      pageTexts = { [page(1)]: PAGE_IMAGE_TEXT },
      visionFails = false,
      pageFaults = {},
      itemsByText = ITEMS_BY_TEXT,
      failStructurerOn = null,
      delaysMs = {},
      callDelayMs = 0,
    } = {}) => {
      const calls = { vision: [], structurer: [] };
      const events = [];
      const inFlight = { vision: 0, structurer: 0 };
      const maxInFlight = { vision: 0, structurer: 0 };

      const answer = (kind, key) => {
        if (kind === 'vision') {
          const fault = pageFaults[key] ?? {};
          if (visionFails || fault.status) {
            return { ok: false, status: fault.status ?? 500, text: async () => 'upstream failure' };
          }
          return chatResponse(pageTexts[key] ?? '', fault);
        }
        if (key === failStructurerOn) {
          return { ok: false, status: 500, text: async () => 'upstream failure' };
        }
        const items = itemsByText.get(key);
        if (!items) throw new Error(`unexpected structurer input: ${key.slice(0, 40)}`);
        return chatResponse(JSON.stringify({ items }));
      };

      const fetchMock = jest.fn(async (url, init) => {
        if (!url.includes('/chat/completions')) {
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
        }
        const userContent = JSON.parse(init.body).messages[1].content;
        const kind = Array.isArray(userContent) ? 'vision' : 'structurer';
        const images = kind === 'vision'
          ? userContent.filter((part) => part.type === 'image_url').map((part) => part.image_url.url)
          : null;
        const key = kind === 'vision' ? images[0] : userContent;
        calls[kind].push(kind === 'vision' ? images : userContent);
        events.push(`${kind}:start`);
        inFlight[kind] += 1;
        maxInFlight[kind] = Math.max(maxInFlight[kind], inFlight[kind]);
        try {
          const delay = delaysMs[key] ?? callDelayMs;
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          return answer(kind, key);
        } finally {
          inFlight[kind] -= 1;
          events.push(`${kind}:end`);
        }
      });
      return { fetchMock, calls, events, inFlight, maxInFlight };
    };

    /**
     * Enqueue, pick and run a job for `mediaId`; returns the result and the
     * settled job row. `lastAttempt` makes this pick the job's last allowed one.
     */
    const runJob = async (mediaId, { lastAttempt = false } = {}) => {
      const enqueued = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
      if (lastAttempt) {
        await pool.query('UPDATE ocr_jobs SET attempts = max_attempts - 1 WHERE id = $1', [enqueued.id]);
      }
      const picked = await ocrJobModel.pickNextPending();
      const result = await ocrService.processJob(picked.id);
      return { result, job: await ocrJobModel.getJobStatus(picked.id) };
    };

    /** Persisted items by position: [name, price] or, withCategory, [name, price, category]. */
    const persistedByPosition = async ({ withCategory = false } = {}) => {
      const items = await menuItemModel.getByEstablishmentId(establishment.id, { includeHidden: true });
      return [...items]
        .sort((a, b) => a.position - b.position)
        .map((it) => {
          const row = [it.item_name, it.price_byn == null ? null : Number(it.price_byn)];
          return withCategory ? [...row, it.category_raw] : row;
        });
    };

    test('a PDF with a text layer is read as page images, a call per page — its text layer never reaches the structurer', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: TEXT_LAYER, numpages: 3 });
      // Page 1 carries the menu; pages 2 and 3 are pictures with nothing to read.
      const { fetchMock, calls } = routedFetch();
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      // Premise: the text layer is usable — without that this would test a scan.
      expect(pdfTextExtractor.hasUsableTextLayer(TEXT_LAYER, 3)).toBe(true);
      expect(result).toMatchObject({ success: true, itemCount: 4 });
      expect(job.status).toBe('done');
      // Every page of the PDF (pdf-parse counted 3), each in a vision call of its own.
      expect(calls.vision).toEqual([[page(1)], [page(2)], [page(3)]]);
      // A blank page costs no structurer call.
      expect(calls.structurer).toEqual([PAGE_IMAGE_TEXT]);
      expect(job.result_summary).toEqual({
        strategy: 'vision_pdf',
        items_count: 4,
        flagged_count: 0,
        confidence_avg: 0.95,
        pages_count: 3,
        categories_carried: 0,
      });
      expect(await persistedByPosition()).toEqual([
        ['Бриошь, джем, масло', 9],
        ['Бенедикт с лососем и красной икрой', 38],
        ['Оладьи из цукини с яйцом пашот', 37],
        ['Яйца пашот с ростбифом и сальсой', 38],
      ]);
    });

    test('pages are structured one by one and joined in page order; the top of a page continues the section open at the page break', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: 'xy', numpages: 4 });
      // Page 1 finishes last in both stages: the pages join in page order,
      // not in the order the answers arrive.
      const { fetchMock, calls } = routedFetch({
        pageTexts: { [page(1)]: SEAM_PAGE_1, [page(2)]: SEAM_PAGE_2, [page(4)]: SEAM_PAGE_4 },
        itemsByText: SEAM_ITEMS,
        delaysMs: { [page(1)]: 80, [SEAM_PAGE_1]: 80 },
      });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result).toMatchObject({ success: true, itemCount: 9 });
      expect(calls.vision).toEqual([[page(1)], [page(2)], [page(3)], [page(4)]]);
      expect(calls.structurer).toEqual([SEAM_PAGE_1, SEAM_PAGE_2, SEAM_PAGE_4]);
      expect(await persistedByPosition({ withCategory: true })).toEqual([
        ['BEEF TARTARE', 33, 'SNACKS'],
        ['BACON WRAPPED SHRIMP', 32, 'SNACKS'],
        // The top of page 2, before its first heading: the section of page 1 goes on.
        ['TURKEY CARPACCIO', 28, 'SNACKS'],
        ['MIXED BRUSCHETTA SET', 43, 'SNACKS'],
        ['AVOCADO SALMON SALAD', 33, 'SALADS'],
        ['GRILLED TUNA', 55, 'MAIN DISH'],
        // Over the blank page 3: the last section opened before it, not the first one of page 2.
        ['KENTUCKY CUTLET', 45, 'MAIN DISH'],
        ['CHICKEN BURGER', 30, 'BURGERS'],
        // Further down a page, a null is the model's reading and stays.
        ['Соус к бургерам', 3, null],
      ]);
      expect(job.result_summary).toEqual({
        strategy: 'vision_pdf',
        items_count: 9,
        flagged_count: 0,
        confidence_avg: 0.95,
        pages_count: 4,
        categories_carried: 3,
      });
    });

    test('the pages of a stage run at the same time; structuring starts once every page has been read', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: 'xy', numpages: 3 });
      const { fetchMock, events, maxInFlight } = routedFetch({
        pageTexts: { [page(1)]: SEAM_PAGE_1, [page(2)]: SEAM_PAGE_2, [page(3)]: SEAM_PAGE_4 },
        itemsByText: SEAM_ITEMS,
        callDelayMs: 30,
      });
      global.fetch = fetchMock;

      const { result } = await runJob(mediaId);

      expect(result).toMatchObject({ success: true, itemCount: 9 });
      // Calls one after another would bring their own few seconds each: Zalkind
      // took 60.5 s that way against 15 s at once (29.09).
      expect(maxInFlight).toEqual({ vision: 3, structurer: 3 });
      // JOB_DURATION_BOUND_MS counts one vision timeout, then one structurer timeout.
      expect(events.lastIndexOf('vision:end')).toBeLessThan(events.indexOf('structurer:start'));
    });

    test('a page read that fails fails the attempt — the first failed page in page order, reported once every read has settled; no page is structured', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: 'xy', numpages: 4 });
      // Page 3 fails at once, page 2 a little later; page 4, after both of
      // them, reads slowest of all.
      const { fetchMock, calls, inFlight } = routedFetch({
        pageTexts: { [page(1)]: SEAM_PAGE_1, [page(4)]: SEAM_PAGE_4 },
        pageFaults: { [page(2)]: { status: 500 }, [page(3)]: { status: 503 } },
        delaysMs: { [page(2)]: 150, [page(4)]: 600 },
        itemsByText: SEAM_ITEMS,
      });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result.success).toBe(false);
      expect(job.status).toBe('pending');
      expect(job.error_message).toBe('page 2 of 4: OpenRouter vision call failed: 500 upstream failure');
      // No request of the job is still under way when it settles.
      expect(inFlight).toEqual({ vision: 0, structurer: 0 });
      expect(calls.vision).toHaveLength(4);
      expect(calls.structurer).toEqual([]);
      expect(await persistedByPosition()).toEqual([]);
    });

    test('a page read cut short (finish_reason other than stop) fails the attempt like an error', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: 'xy', numpages: 2 });
      const { fetchMock, calls } = routedFetch({
        pageTexts: { [page(1)]: SEAM_PAGE_1, [page(2)]: SEAM_PAGE_2 },
        pageFaults: { [page(2)]: { finishReason: 'length', nativeFinishReason: 'MAX_TOKENS' } },
        itemsByText: SEAM_ITEMS,
      });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result.success).toBe(false);
      expect(job.status).toBe('pending');
      expect(job.error_message).toBe('page 2 of 2: vision OCR answer cut short: finish_reason=length (MAX_TOKENS)');
      expect(calls.structurer).toEqual([]);
      expect(await persistedByPosition()).toEqual([]);
    });

    test('a page whose structuring fails fails the attempt, reported once every page has settled; nothing is saved', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: 'xy', numpages: 3 });
      const { fetchMock, calls, inFlight } = routedFetch({
        pageTexts: { [page(1)]: SEAM_PAGE_1, [page(2)]: SEAM_PAGE_2, [page(3)]: SEAM_PAGE_4 },
        itemsByText: SEAM_ITEMS,
        failStructurerOn: SEAM_PAGE_2,
        delaysMs: { [SEAM_PAGE_4]: 400 },
      });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result.success).toBe(false);
      expect(job.status).toBe('pending');
      expect(job.error_message).toBe('page 2 of 3: OpenRouter structurer call failed: 500 upstream failure');
      expect(inFlight).toEqual({ vision: 0, structurer: 0 });
      expect(calls.structurer).toEqual([SEAM_PAGE_1, SEAM_PAGE_2, SEAM_PAGE_4]);
      expect(await persistedByPosition()).toEqual([]);
    });

    test.each([
      ['fails (HTTP 500)', () => ({ visionFails: true }), /OpenRouter vision call failed: 500/],
      ['returns empty text', () => ({ pageTexts: { [page(1)]: '  \n ' } }), /vision OCR returned empty text/],
    ])('last attempt: image read %s → the text layer stands in, the job is done', async (_how, visionMock, errorPattern) => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: TEXT_LAYER, numpages: 1 });
      const { fetchMock, calls } = routedFetch(visionMock());
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId, { lastAttempt: true });

      expect(result).toMatchObject({ success: true, itemCount: 4 });
      expect(job.status).toBe('done');
      expect(job.error_message).toBeNull();
      expect(calls.vision).toEqual([[page(1)]]);
      expect(calls.structurer).toEqual([TEXT_LAYER]);
      expect(job.result_summary).toMatchObject({
        strategy: 'pdf_text_layer',
        items_count: 4,
        pages_count: 1,
        categories_carried: 0,
      });
      expect(job.result_summary.vision_error).toMatch(errorPattern);
      expect(await persistedByPosition()).toEqual(TEXT_LAYER_ITEMS.map((it) => [it.item_name, it.price_byn]));
    });

    test('last attempt, several pages: one page read fails → the text layer stands in for the whole PDF, in one structurer call', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: TEXT_LAYER, numpages: 3 });
      const { fetchMock, calls } = routedFetch({ pageFaults: { [page(2)]: { status: 500 } } });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId, { lastAttempt: true });

      expect(result).toMatchObject({ success: true, itemCount: 4 });
      expect(job.status).toBe('done');
      expect(calls.vision).toEqual([[page(1)], [page(2)], [page(3)]]);
      // Page 1 was read, but a failed page fails the image read as a whole.
      expect(calls.structurer).toEqual([TEXT_LAYER]);
      expect(job.result_summary).toEqual({
        strategy: 'pdf_text_layer',
        items_count: 4,
        flagged_count: 0,
        confidence_avg: 0.9,
        vision_error: 'page 2 of 3: OpenRouter vision call failed: 500 upstream failure',
        pages_count: 3,
        categories_carried: 0,
      });
    });

    test('earlier attempt: image read fails → back to the queue for a retry, the text layer is not used yet', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: TEXT_LAYER, numpages: 1 });
      const { fetchMock, calls } = routedFetch({ visionFails: true });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result.success).toBe(false);
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(1);
      // A single page is not named: the message is the call's own.
      expect(job.error_message).toMatch(/^OpenRouter vision call failed: 500/);
      expect(calls.structurer).toEqual([]);
      expect(await persistedByPosition()).toEqual([]);
    });

    test('last attempt, scanned PDF (no usable text layer): image read fails → the job fails for good', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: 'xy', numpages: 2 });
      const { fetchMock, calls } = routedFetch({ visionFails: true });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId, { lastAttempt: true });

      expect(result.success).toBe(false);
      expect(job.status).toBe('failed');
      expect(job.error_message).toBe('page 1 of 2: OpenRouter vision call failed: 500 upstream failure');
      expect(calls.vision).toEqual([[page(1)], [page(2)]]);
      expect(calls.structurer).toEqual([]);
    });

    test.each([
      ['earlier attempt → back to the queue', false, 'pending'],
      ['last attempt → failed', true, 'failed'],
    ])('image text read, structurer fails: %s — never a second structurer call on the text layer', async (
      _when, lastAttempt, status,
    ) => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      pdfParseModule.default.mockResolvedValue({ text: TEXT_LAYER, numpages: 1 });
      const { fetchMock, calls } = routedFetch({ failStructurerOn: PAGE_IMAGE_TEXT });
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId, { lastAttempt });

      expect(result.success).toBe(false);
      expect(job.status).toBe(status);
      // A single page is not named: the message is the call's own.
      expect(job.error_message).toMatch(/^OpenRouter structurer call failed: 500/);
      expect(calls.vision).toHaveLength(1);
      // One structurer call, on the image text: a second one would break JOB_DURATION_BOUND_MS.
      expect(calls.structurer).toEqual([PAGE_IMAGE_TEXT]);
    });

    test.each([
      ['pdf-parse fails', () => pdfParseModule.default.mockRejectedValue(new Error('bad XRef entry'))],
      ['pdf-parse counts 0 pages', () => pdfParseModule.default.mockResolvedValue({ text: '', numpages: 0 })],
    ])('%s → the first two pages are read as images (vision_pdf_no_metadata)', async (_how, arrangePdfParse) => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      arrangePdfParse();
      const { fetchMock, calls } = routedFetch();
      global.fetch = fetchMock;

      const { result, job } = await runJob(mediaId);

      expect(result).toMatchObject({ success: true, itemCount: 4 });
      expect(calls.vision).toEqual([[page(1)], [page(2)]]);
      expect(job.result_summary).toMatchObject({ strategy: 'vision_pdf_no_metadata', pages_count: 2 });
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
