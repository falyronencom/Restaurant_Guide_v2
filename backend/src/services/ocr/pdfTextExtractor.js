/**
 * PDF Text Extractor
 *
 * Wraps pdf-parse: the page count of a PDF and its text layer. The orchestrator
 * reads PDF pages as images first (vision OCR via pg_N URL transformations on
 * Cloudinary) — the page count decides how many pages it renders, and a text
 * layer the heuristic below finds usable is the backup when the image read
 * fails (ocrService.extractPageTexts).
 *
 * pdf-parse runs in a child process of its own, under a deadline and a memory
 * limit (pdfParseRunner, PDF_PARSE_TIMEOUT_MS and PDF_PARSE_MEMORY_LIMIT_MB
 * below): the API process does not run the parse.
 */

import { ownCloudPublicId } from '../../config/cloudinary.js';
import logger from '../../utils/logger.js';
import { abortedError, parsePdfIsolated } from './pdfParseRunner.js';

/**
 * Heuristic thresholds for determining whether a PDF has a usable text layer.
 * Tuned for menu documents in Russian/Belarusian/English. Adjust if false negatives
 * become common (scanned PDFs misclassified as having text, or vice versa).
 */
const MIN_AVG_CHARS_PER_PAGE = 50;
const MIN_DIGIT_COUNT = 3;
const MIN_PRINTABLE_RATIO = 0.7;

/**
 * Abort the PDF download after this long. fetch() has no timeout of its own:
 * without a signal the download is bounded only by undici's defaults (300 s
 * to the headers, 300 s between body chunks) — the one OCR stage that could
 * outlive the graceful-shutdown budget (config/shutdown.js); the vision and
 * structurer calls already abort after their REQUEST_TIMEOUT_MS. A 60 MB menu
 * from Cloudinary downloads in seconds. A timeout surfaces as "This operation
 * was aborted" and the orchestrator reads the pages as images without the
 * page count, as for any download failure. Same pattern as visionOcrAdapter
 * (controller + timer). The caller's signal (graceful shutdown) aborts it
 * too, and then it fails as cut short by shutdown (PDF_PARSE_ABORTED).
 */
const PDF_FETCH_TIMEOUT_MS = 60000;

/**
 * The parse of one PDF — its page count and the text layer of the first
 * pages — in its child process (pdfParseRunner): killed past this deadline,
 * or above this much memory (the child's V8 heap cap, and its resident memory
 * where /proc shows it, as on Railway). A broken limit fails the job for good
 * (ocrService.processJob): the same file breaks it again on every attempt.
 *
 * A file over a limit is not read around (its pages are not read as images
 * without the page count, as after an ordinary parse failure): breaking a
 * limit is the file's doing, and the job ends with that reason.
 *
 * The numbers — proposed (Trunk session, 18.10.2026); the Coordinator's word
 * comes with the merge. Measured 18.10.2026 on synthetic menu-like PDFs (text
 * pages and one large photo — files that ask little of a parser), the
 * child's start included: 1–100 pages, 0.1–58 MB — 0.15–0.22 s, peak
 * resident memory 46–219 MB (the 58 MB file, just under the 60 MB upload
 * limit). Both limits leave the ordinary file room: twenty seconds is about a
 * hundred times the measured time, 384 MB one and three-quarter times the
 * largest file's peak. Real menus were not measured here (production files
 * stay on production): every parse logs its time and peak memory
 * ('PDF text extraction complete') — the check after the deploy.
 */
const PDF_PARSE_TIMEOUT_MS = 20000;
const PDF_PARSE_MEMORY_LIMIT_MB = 384;

/**
 * Fetch a PDF from a URL and return it as a Buffer.
 * Uses the global fetch (Node.js 18+), aborted after PDF_FETCH_TIMEOUT_MS —
 * the signal covers the body read (arrayBuffer) as well as the headers.
 *
 * Only a delivery URL on our own cloud is downloaded. The URL comes from an
 * establishment_media row, and the media URL gate checks the extension only
 * (review 02.10.2026, N3): without this the server fetched any host a row
 * named. A refusal is a download failure like any other for the orchestrator.
 *
 * @param {string} url - Cloudinary PDF URL
 * @param {AbortSignal} [signal] - Graceful shutdown: aborts the download
 * @returns {Promise<Buffer>}
 * @throws {Error} code PDF_PARSE_ABORTED when `signal` cut it short
 */
const fetchPdfBuffer = async (url, signal) => {
  if (ownCloudPublicId(url) === null) {
    throw new Error('PDF URL is not on this project\'s Cloudinary cloud');
  }
  if (signal?.aborted) {
    throw abortedError('PDF download cut short by shutdown');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS);
  const onStop = () => controller.abort();
  signal?.addEventListener('abort', onStop, { once: true });

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (signal?.aborted) {
      throw abortedError('PDF download cut short by shutdown');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onStop);
  }
};

/**
 * On Linux (Railway) the memory limit rests on two things the platform must
 * allow: reading the child's resident memory from /proc, and the child
 * raising its own OOM score. Either missing leaves only the heap cap and the
 * deadline — said once per process, at the first parse that shows it.
 */
let platformLimitsChecked = false;

const warnIfPlatformLimitsMissing = ({ peakResidentBytes, oomScoreAdjusted }) => {
  if (platformLimitsChecked || process.platform !== 'linux') return;
  platformLimitsChecked = true;
  if (peakResidentBytes == null || !oomScoreAdjusted) {
    logger.warn('PDF parse child: a memory safeguard is unavailable on this platform', {
      residentMemoryRead: peakResidentBytes != null,
      oomScoreAdjusted: oomScoreAdjusted === true,
    });
  }
};

/** Tests: forget that the platform was checked. */
export const resetPlatformLimitsCheck = () => {
  platformLimitsChecked = false;
};

/**
 * Compute ratio of printable ASCII + common Cyrillic characters to total characters.
 * Helps filter out PDFs where text extraction returned garbage (encoding artifacts).
 *
 * @param {string} text
 * @returns {number} 0..1
 */
const computePrintableRatio = (text) => {
  if (!text || text.length === 0) return 0;

  let printable = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const isAscii = code >= 0x20 && code <= 0x7e;
    const isCyrillic = code >= 0x0400 && code <= 0x04ff;
    const isWhitespace = ch === '\n' || ch === '\r' || ch === '\t';
    if (isAscii || isCyrillic || isWhitespace) {
      printable++;
    }
  }

  return printable / text.length;
};

/**
 * Apply heuristic to determine if the extracted text looks like a real text layer.
 *
 * @param {string} text
 * @param {number} pageCount
 * @returns {boolean}
 */
const hasUsableTextLayer = (text, pageCount) => {
  if (!text || pageCount === 0) return false;

  const avgCharsPerPage = text.length / pageCount;
  if (avgCharsPerPage < MIN_AVG_CHARS_PER_PAGE) return false;

  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount < MIN_DIGIT_COUNT) return false;

  const printableRatio = computePrintableRatio(text);
  if (printableRatio < MIN_PRINTABLE_RATIO) return false;

  return true;
};

/**
 * Extract text from a PDF URL. Returns the text, page count, and whether the text
 * layer is usable — the caller renders that many pages for vision OCR and keeps
 * a usable text layer as the backup for a failed image read.
 *
 * `maxPages` bounds the work as the caller bounds its reading
 * (ocrService.PDF_PAGE_LIMIT): pdf-parse extracts the text of the first
 * `maxPages` pages only (its `max` option; 0 — every page) and still reports
 * the document's page count. The text layer is judged by the pages it covers.
 *
 * `maxChars` bounds the text the API process receives: the child cuts the
 * text layer to that many characters (0 — not cut) and reports its full
 * length as textLength. The heuristic judges the text received.
 *
 * Never throws on "no text layer" — that's an expected signal for scanned PDFs.
 * Only throws on fetch or parse failures; a parse that broke its limits throws
 * with error.code pdfParseRunner.PDF_PARSE_LIMIT, a download or parse cut by
 * `signal` with PDF_PARSE_ABORTED.
 *
 * @param {string} pdfUrl - Cloudinary PDF URL
 * @param {Object} [options]
 * @param {number} [options.maxPages=0] - Pages to extract the text of; 0 — all
 * @param {number} [options.maxChars=0] - Characters of the text layer to receive; 0 — all
 * @param {AbortSignal} [options.signal] - Cuts the download and the parse short (graceful shutdown)
 * @returns {Promise<{ text: string, textLength: number, pageCount: number, pagesParsed: number, hasTextLayer: boolean }>}
 *   text — at most maxChars; textLength — the text layer's full length;
 *   pageCount — the document's pages; pagesParsed — the pages the text comes from
 */
export const extractText = async (pdfUrl, { maxPages = 0, maxChars = 0, signal } = {}) => {
  const buffer = await fetchPdfBuffer(pdfUrl, signal);
  const parsed = await parsePdfIsolated(buffer, {
    maxPages,
    maxChars,
    timeoutMs: PDF_PARSE_TIMEOUT_MS,
    memoryLimitMb: PDF_PARSE_MEMORY_LIMIT_MB,
    signal,
  });
  warnIfPlatformLimitsMissing(parsed);

  const text = parsed.text || '';
  const textLength = parsed.textLength ?? text.length;
  const pageCount = parsed.numpages || 0;
  const pagesParsed = maxPages > 0 ? Math.min(pageCount, maxPages) : pageCount;
  const hasTextLayer = hasUsableTextLayer(text, pagesParsed);

  // Info, not debug: the time and the peak memory of real menus are what the
  // limits above are to be checked against (PDF jobs are a few a day).
  logger.info('PDF text extraction complete', {
    pdfUrl,
    fileBytes: buffer.length,
    pageCount,
    pagesParsed,
    textLength,
    hasTextLayer,
    parseMs: parsed.durationMs ?? null,
    peakResidentMb: parsed.peakResidentBytes == null
      ? null
      : Math.round(parsed.peakResidentBytes / (1024 * 1024)),
  });

  return { text, textLength, pageCount, pagesParsed, hasTextLayer };
};

export {
  MIN_AVG_CHARS_PER_PAGE,
  MIN_DIGIT_COUNT,
  MIN_PRINTABLE_RATIO,
  PDF_FETCH_TIMEOUT_MS,
  PDF_PARSE_TIMEOUT_MS,
  PDF_PARSE_MEMORY_LIMIT_MB,
  hasUsableTextLayer,
  computePrintableRatio,
};
