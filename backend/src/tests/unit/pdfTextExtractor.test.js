/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: pdfTextExtractor.js
 *
 * Focus: hasUsableTextLayer heuristic — whether a PDF's text layer may stand
 * in when reading its pages as images fails on the job's last attempt
 * (ocrService.extractPageTexts). Testing this in isolation avoids real PDF I/O.
 *
 * Plus the download timeout: the PDF fetch is the one OCR stage with no
 * timeout of its own, so it must carry an AbortSignal that fires after
 * PDF_FETCH_TIMEOUT_MS — a stalled download must not outlive the
 * graceful-shutdown budget (config/shutdown.js). The parse runner (pdf-parse
 * in a child process — pdfParseRunner, tested on real processes in
 * pdfParseRunner.test.js) and the logger are mocked; fetch is replaced per
 * test. mockPdfParse stands for the runner: it resolves { text, numpages }
 * as pdf-parse does.
 */

import { jest } from '@jest/globals';

const mockPdfParse = jest.fn();

jest.unstable_mockModule('../../services/ocr/pdfParseRunner.js', () => ({
  parsePdfIsolated: mockPdfParse,
  // As in the runner: the error of a PDF read cut short by shutdown.
  abortedError: (message = 'PDF parse cut short by shutdown') => Object.assign(
    new Error(message),
    { code: 'PDF_PARSE_ABORTED', reason: 'aborted' },
  ),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const {
  extractText,
  hasUsableTextLayer,
  computePrintableRatio,
  MIN_AVG_CHARS_PER_PAGE,
  MIN_DIGIT_COUNT,
  MIN_PRINTABLE_RATIO,
  PDF_FETCH_TIMEOUT_MS,
  PDF_PARSE_TIMEOUT_MS,
  PDF_PARSE_MEMORY_LIMIT_MB,
  resetPlatformLimitsCheck,
} = await import('../../services/ocr/pdfTextExtractor.js');
const { default: mockLogger } = await import('../../utils/logger.js');

describe('pdfTextExtractor heuristics', () => {
  describe('computePrintableRatio', () => {
    test('returns 0 for empty string', () => {
      expect(computePrintableRatio('')).toBe(0);
      expect(computePrintableRatio(null)).toBe(0);
    });

    test('returns 1.0 for plain ASCII text', () => {
      expect(computePrintableRatio('Hello World 123')).toBe(1.0);
    });

    test('returns 1.0 for Cyrillic text', () => {
      expect(computePrintableRatio('Борщ 15 руб')).toBe(1.0);
    });

    test('handles whitespace as printable', () => {
      expect(computePrintableRatio('abc\n\tdef')).toBe(1.0);
    });

    test('drops ratio when control chars dominate', () => {
      const garbage = '\x01\x02\x03\x04\x05\x06abc';
      const ratio = computePrintableRatio(garbage);
      expect(ratio).toBeCloseTo(3 / 9, 2);
    });
  });

  describe('hasUsableTextLayer', () => {
    test('rejects empty text', () => {
      expect(hasUsableTextLayer('', 5)).toBe(false);
    });

    test('rejects zero pages', () => {
      expect(hasUsableTextLayer('Some reasonable text content 123', 0)).toBe(false);
    });

    test('rejects text below min avg chars per page', () => {
      const short = 'Short';
      expect(hasUsableTextLayer(short, 1)).toBe(false);
    });

    test('rejects text with no digits', () => {
      const noDigits = 'A'.repeat(MIN_AVG_CHARS_PER_PAGE * 2);
      expect(hasUsableTextLayer(noDigits, 1)).toBe(false);
    });

    test('rejects text with garbage printable ratio', () => {
      const printable = 'Menu 1 2 3 ';
      const garbage = '\x01'.repeat(100);
      const mixed = printable + garbage;
      expect(hasUsableTextLayer(mixed, 1)).toBe(false);
    });

    test('accepts a valid menu page', () => {
      const realMenu =
        'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\n' +
        'Пицца Маргарита — 18 руб.\nКофе эспрессо — 4 руб.';
      expect(realMenu.length).toBeGreaterThan(MIN_AVG_CHARS_PER_PAGE);
      expect(hasUsableTextLayer(realMenu, 1)).toBe(true);
    });

    test('boundary: exactly at MIN_AVG_CHARS_PER_PAGE with digits passes', () => {
      const base = 'x'.repeat(MIN_AVG_CHARS_PER_PAGE);
      const withDigits = base + '1'.repeat(MIN_DIGIT_COUNT);
      expect(hasUsableTextLayer(withDigits, 1)).toBe(true);
    });

    test('boundary: just below MIN_DIGIT_COUNT fails', () => {
      const base = 'x'.repeat(MIN_AVG_CHARS_PER_PAGE);
      const tooFewDigits = base + '1'.repeat(MIN_DIGIT_COUNT - 1);
      expect(hasUsableTextLayer(tooFewDigits, 1)).toBe(false);
    });

    test('multi-page PDF with avg per page below threshold fails', () => {
      // 100 chars across 10 pages = 10 chars/page, below threshold
      const text = 'abc 123 xyz'.repeat(10);
      expect(hasUsableTextLayer(text, 10)).toBe(false);
    });

    test('constants are exported and finite', () => {
      expect(MIN_AVG_CHARS_PER_PAGE).toBeGreaterThan(0);
      expect(MIN_DIGIT_COUNT).toBeGreaterThan(0);
      expect(MIN_PRINTABLE_RATIO).toBeGreaterThan(0);
      expect(MIN_PRINTABLE_RATIO).toBeLessThanOrEqual(1);
    });
  });
});

describe('extractText — download timeout', () => {
  const PDF_URL = 'https://res.cloudinary.com/test/image/upload/v1/establishments/x/menu_pdf/menu.pdf';
  const PDF_TEXT = 'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\nПицца Маргарита — 18 руб.\nКофе — 4 руб.';
  let originalFetch;

  const okResponse = () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => new ArrayBuffer(8),
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    // resetMocks wipes implementations before every test — re-arm the default.
    mockPdfParse.mockResolvedValue({ text: PDF_TEXT, numpages: 1 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  test('the download carries an AbortSignal — without one, undici\'s 300 s defaults are the only bound', async () => {
    global.fetch = jest.fn(async () => okResponse());

    const result = await extractText(PDF_URL);

    expect(result).toMatchObject({ pageCount: 1, hasTextLayer: true, text: PDF_TEXT });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(PDF_URL);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
  });

  test('a download stalled past PDF_FETCH_TIMEOUT_MS is aborted and extractText rejects before parsing', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
    }));

    const pending = extractText(PDF_URL);
    const outcome = expect(pending).rejects.toThrow('This operation was aborted');

    jest.advanceTimersByTime(PDF_FETCH_TIMEOUT_MS - 1);
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);

    await outcome;
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  test('a completed download clears its timer', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => okResponse());

    await extractText(PDF_URL);

    expect(jest.getTimerCount()).toBe(0);
  });

  test('a non-2xx response still fails loudly', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));

    await expect(extractText(PDF_URL)).rejects.toThrow('Failed to fetch PDF: 404 Not Found');
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  test('the timeout is 60 s — the same bound as the vision and structurer calls', () => {
    expect(PDF_FETCH_TIMEOUT_MS).toBe(60000);
  });
});

describe('extractText — downloads only from this project\'s cloud', () => {
  // The URL comes from an establishment_media row, and the media URL gate checks
  // only the file extension (review 02.10.2026, N3): the server fetched whatever
  // host the row named. Only a delivery URL on our own cloud (CLOUDINARY_CLOUD_NAME,
  // 'test' in the suite) is downloaded now; the orchestrator treats a refusal like
  // any download failure and reads the pages as images.
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    mockPdfParse.mockResolvedValue({ text: 'Борщ — 15 руб.', numpages: 1 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test.each([
    ['an internal address', 'http://169.254.169.254/latest/menu.pdf'],
    ['a private network host', 'https://10.0.0.5/menu.pdf'],
    ['another Cloudinary cloud', 'https://res.cloudinary.com/othercloud/image/upload/v1/menu.pdf'],
    ['a host that only starts like Cloudinary', 'https://res.cloudinary.com.example.org/test/image/upload/v1/menu.pdf'],
    ['our cloud over plain http', 'http://res.cloudinary.com/test/image/upload/v1/establishments/x/menu_pdf/menu.pdf'],
    ['our cloud, raw resource type', 'https://res.cloudinary.com/test/raw/upload/v1/establishments/x/menu_pdf/menu.pdf'],
  ])('%s — refused before any request', async (_label, url) => {
    await expect(extractText(url)).rejects.toThrow('PDF URL is not on this project\'s Cloudinary cloud');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  test('a delivery URL on our cloud is downloaded as before', async () => {
    const url = 'https://res.cloudinary.com/test/image/upload/v1759600000/establishments/x/menu_pdf/menu.pdf';

    await extractText(url);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(url);
  });
});

describe('extractText — the page limit', () => {
  // The orchestrator reads only the first pages of a long PDF (ocrService
  // PDF_PAGE_LIMIT, review of PR #56, finding 2). pdf-parse is told the same
  // limit, so the text layer — the last attempt's backup — is extracted from
  // those pages only, and it is judged by them: a text spread over 20 pages
  // read is not «12 characters a page» of a 100-page document.
  const PDF_URL = 'https://res.cloudinary.com/test/image/upload/v1/establishments/x/menu_pdf/menu.pdf';
  /** 59 characters with digits — one page of a menu's text layer (MIN_AVG_CHARS_PER_PAGE is 50). */
  const PAGE_TEXT = 'Борщ украинский 15 руб. Салат Цезарь 12 руб. Кофе 4 руб....';
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('pdf-parse reads the first maxPages pages; the text layer is judged by those pages', async () => {
    // A 100-page document; pdf-parse returns the text of the 20 pages it read.
    mockPdfParse.mockResolvedValue({ text: PAGE_TEXT.repeat(20), numpages: 100 });

    const result = await extractText(PDF_URL, { maxPages: 20 });

    expect(mockPdfParse).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ maxPages: 20 }));
    expect(result).toMatchObject({ pageCount: 100, pagesParsed: 20, hasTextLayer: true });
  });

  test('a document within the limit — every page parsed', async () => {
    mockPdfParse.mockResolvedValue({ text: PAGE_TEXT.repeat(3), numpages: 3 });

    const result = await extractText(PDF_URL, { maxPages: 20 });

    expect(result).toMatchObject({ pageCount: 3, pagesParsed: 3, hasTextLayer: true });
  });

  test('no limit given — pdf-parse reads every page, as before', async () => {
    mockPdfParse.mockResolvedValue({ text: PAGE_TEXT.repeat(30), numpages: 30 });

    const result = await extractText(PDF_URL);

    expect(mockPdfParse).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ maxPages: 0 }));
    expect(result).toMatchObject({ pageCount: 30, pagesParsed: 30, hasTextLayer: true });
  });
});

describe('extractText — the parse runs in its child process, under its limits', () => {
  const PDF_URL = 'https://res.cloudinary.com/test/image/upload/v1/establishments/x/menu_pdf/menu.pdf';
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    mockPdfParse.mockResolvedValue({ text: 'Борщ — 15 руб.', numpages: 1 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('the downloaded file goes to the runner with the deadline, the memory limit and the caller\'s signal', async () => {
    const controller = new AbortController();

    await extractText(PDF_URL, { maxPages: 20, signal: controller.signal });

    expect(mockPdfParse).toHaveBeenCalledTimes(1);
    const [buffer, options] = mockPdfParse.mock.calls[0];
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(8);
    expect(options).toEqual({
      maxPages: 20,
      maxChars: 0,
      timeoutMs: PDF_PARSE_TIMEOUT_MS,
      memoryLimitMb: PDF_PARSE_MEMORY_LIMIT_MB,
      signal: controller.signal,
    });
  });

  test('maxChars goes to the child; the full length it reports comes back as textLength', async () => {
    mockPdfParse.mockResolvedValue({ text: 'Борщ — 15 руб. Салат — 12 руб. Кофе — 4 руб. Чай — 3 руб. ', textLength: 250000, numpages: 1 });

    const result = await extractText(PDF_URL, { maxPages: 20, maxChars: 200000 });

    expect(mockPdfParse.mock.calls[0][1]).toMatchObject({ maxChars: 200000 });
    expect(result.textLength).toBe(250000);
    expect(result.text).toBe('Борщ — 15 руб. Салат — 12 руб. Кофе — 4 руб. Чай — 3 руб. ');
  });

  test('a runner answer without textLength: the text\'s own length', async () => {
    mockPdfParse.mockResolvedValue({ text: 'abc', numpages: 1 });

    expect((await extractText(PDF_URL)).textLength).toBe(3);
  });

  test('the shutdown signal aborts a download in progress: PDF_PARSE_ABORTED, and nothing is parsed', async () => {
    global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
    }));
    const controller = new AbortController();

    const pending = extractText(PDF_URL, { maxPages: 20, signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: 'PDF_PARSE_ABORTED',
      message: 'PDF download cut short by shutdown',
    });
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  test('a signal already aborted: no download at all', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(extractText(PDF_URL, { signal: controller.signal })).rejects.toMatchObject({
      code: 'PDF_PARSE_ABORTED',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a download that fails on its own, with the signal quiet, keeps its own error', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' }));
    const controller = new AbortController();

    const error = await extractText(PDF_URL, { signal: controller.signal }).catch((e) => e);

    expect(error.message).toBe('Failed to fetch PDF: 503 Service Unavailable');
    expect(error.code).toBeUndefined();
  });

  describe('a memory safeguard the platform does not allow is said once', () => {
    const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const asPlatform = (value) => Object.defineProperty(process, 'platform', { ...realPlatform, value });

    beforeEach(() => {
      resetPlatformLimitsCheck();
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', realPlatform);
      resetPlatformLimitsCheck();
    });

    const warnings = () => mockLogger.warn.mock.calls
      .filter(([message]) => message === 'PDF parse child: a memory safeguard is unavailable on this platform');

    test('on Linux, with the resident memory unread and the OOM score not raised: one warning for the process', async () => {
      asPlatform('linux');
      mockPdfParse.mockResolvedValue({ text: 'x', numpages: 1, peakResidentBytes: null, oomScoreAdjusted: false });

      await extractText(PDF_URL);
      await extractText(PDF_URL);

      expect(warnings()).toEqual([[
        'PDF parse child: a memory safeguard is unavailable on this platform',
        { residentMemoryRead: false, oomScoreAdjusted: false },
      ]]);
    });

    test('on Linux, with both in place: silence', async () => {
      asPlatform('linux');
      mockPdfParse.mockResolvedValue({ text: 'x', numpages: 1, peakResidentBytes: 50 * 1024 * 1024, oomScoreAdjusted: true });

      await extractText(PDF_URL);

      expect(warnings()).toEqual([]);
    });

    test('elsewhere (no /proc by design): silence', async () => {
      asPlatform('win32');
      mockPdfParse.mockResolvedValue({ text: 'x', numpages: 1, peakResidentBytes: null, oomScoreAdjusted: false });

      await extractText(PDF_URL);

      expect(warnings()).toEqual([]);
    });
  });

  test('a parse that broke its limit reaches the caller with its code', async () => {
    const limit = Object.assign(new Error('PDF parse exceeded its time limit (20 s)'), {
      code: 'PDF_PARSE_LIMIT',
      reason: 'timeout',
    });
    mockPdfParse.mockRejectedValue(limit);

    await expect(extractText(PDF_URL, { maxPages: 20 })).rejects.toBe(limit);
  });

  test('the limits: 20 s and 384 MB — proposed numbers, measured against ordinary files', () => {
    expect(PDF_PARSE_TIMEOUT_MS).toBe(20000);
    expect(PDF_PARSE_MEMORY_LIMIT_MB).toBe(384);
  });
});
