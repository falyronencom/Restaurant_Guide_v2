/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Why recognition failed, as the partner is told (services/ocr/failureReason.js,
 * finding 3 of the Railway incident, 24.10.2026).
 *
 * The cause lives only in the job's error_message — the English message of the
 * exception. The classifier reads it by its opening, so the opening it expects
 * must be the one the code writes: the table below takes the messages from the
 * code that writes them wherever the code can build them (pdfParseRunner
 * classifyChildEnd, the reaper's and the poller's constants, the constants
 * ocrService throws with), and the PDF_PARSE_LIMIT code the runner puts on an
 * error is the reference for «over the limit» — not the classifier's own idea
 * of it. Review of 24.10.2026 (both passes): the table used to hold a blank
 * PDF's message the code never writes, and missed the one it does.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../config/database.js', () => ({
  default: { query: jest.fn() },
}));

const {
  EMPTY_TEXT_MESSAGE,
  PAGES_BLANK_MESSAGE,
  UNSUPPORTED_FILE_MESSAGE,
  failureCauseOf,
  failureReasonOf,
  failureTextOf,
} = await import('../../services/ocr/failureReason.js');
const { classifyChildEnd, OUTSIDE_KILL_MEMORY_SHARE, PDF_PARSE_LIMIT } = await import('../../services/ocr/pdfParseRunner.js');
const ocrJobModel = await import('../../models/ocrJobModel.js');
const { MENU_RECOGNITION_FAILURES } = await import('../../constants/partnerSectionRefusals.js');

describe('failureReasonOf — a parse that broke its limit, and only that, is «over the limit»', () => {
  const MB = 1024 * 1024;
  const base = { handedOver: true, code: null, exitSignal: null, stderr: '', peakResident: null, memoryLimitMb: 384 };
  const limitAt = 384 * MB * OUTSIDE_KILL_MEMORY_SHARE;

  // Every end of the parse's process the runner classifies (pdfParseRunner.test.js
  // holds the same table): the runner's PDF_PARSE_LIMIT decides which are the file's.
  test.each([
    ['ended before it took the file', { handedOver: false, code: 1 }],
    ['the V8 heap limit on stderr', { code: 134, stderr: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory' }],
    ['SIGKILL from outside with the child near its limit', { exitSignal: 'SIGKILL', peakResident: limitAt }],
    ['SIGKILL from outside, the container ran short', { exitSignal: 'SIGKILL', peakResident: limitAt - 1 }],
    ['SIGKILL from outside, memory never read', { exitSignal: 'SIGKILL' }],
    ['Ctrl+C reaching the child', { exitSignal: 'SIGINT' }],
    ['a platform stop', { exitSignal: 'SIGTERM' }],
    ['a closed session', { exitSignal: 'SIGHUP' }],
    ['exit code 0 with no answer', { code: 0 }],
    ['a crash, exit code 3', { code: 3 }],
    ['a crash, SIGSEGV', { exitSignal: 'SIGSEGV' }],
  ])('%s', (_label, end) => {
    const error = classifyChildEnd({ ...base, ...end });
    const isLimit = error.code === PDF_PARSE_LIMIT;

    expect(failureReasonOf(error.message)).toBe(isLimit ? 'overLimit' : 'serviceFailure');
  });

  test('the time limit and the memory sample (the runner writes them inline)', () => {
    expect(failureReasonOf('PDF parse exceeded its time limit (20 s)')).toBe('overLimit');
    expect(failureReasonOf('PDF parse exceeded its memory limit (384 MB): 400 MB resident')).toBe('overLimit');
  });
});

describe('failureReasonOf — the other causes', () => {
  test.each([
    // A PDF whose every page read blank, no text layer behind it — what
    // ocrService readPagesAsImages throws (the constant it throws with).
    [PAGES_BLANK_MESSAGE, 'unreadable'],
    // A photo read blank — ocrService processJob: «<constant> via strategy=…».
    [`${EMPTY_TEXT_MESSAGE} via strategy=vision_image`, 'unreadable'],
    [`${UNSUPPORTED_FILE_MESSAGE}: docx`, 'unreadable'],
    // The recognition service — the incident of 22–23.10.2026 was a 401 here.
    ['page 1 of 3: OpenRouter vision call failed: 401 {"error":{"message":"User not found."}}', 'serviceFailure'],
    ['OpenRouter structurer call failed: 500 upstream', 'serviceFailure'],
    ['LLM structurer returned invalid JSON: Unexpected token', 'serviceFailure'],
    ['vision OCR answer cut short: finish_reason=length', 'serviceFailure'],
    ['The operation was aborted due to timeout', 'serviceFailure'],
    // The server, not the file.
    [ocrJobModel.STALE_REAP_ERROR_MESSAGE, 'serviceFailure'],
    [ocrJobModel.ABANDONED_ATTEMPT_MESSAGE, 'serviceFailure'],
    [ocrJobModel.SHUTDOWN_INTERRUPT_MARK, 'serviceFailure'],
    // Nothing recorded.
    [null, 'serviceFailure'],
    [undefined, 'serviceFailure'],
    ['', 'serviceFailure'],
  ])('%s → %s', (message, reason) => {
    expect(failureReasonOf(message)).toBe(reason);
  });

  test('the literal texts the constants stand for — what a job written before this change keeps', () => {
    expect(PAGES_BLANK_MESSAGE).toBe('vision OCR returned empty text');
    expect(EMPTY_TEXT_MESSAGE).toBe('OCR produced empty text');
    expect(UNSUPPORTED_FILE_MESSAGE).toBe('Unsupported file_type for OCR');
  });

  // Synthetic on purpose: no code builds these. A provider's error body is
  // free text and may quote anything; the cause is read at the start of the
  // message, where our own throw sites put it.
  test('the opening counts, not a word inside: an error quoting «empty text» stays the service\'s', () => {
    expect(failureReasonOf('OpenRouter vision call failed: 500 vision OCR returned empty text')).toBe('serviceFailure');
    expect(failureReasonOf('OpenRouter vision call failed: 500 OCR produced empty text')).toBe('serviceFailure');
  });
});

describe('failureTextOf and failureCauseOf — the dictionary\'s text and the cause\'s code, never the internal message', () => {
  test.each([
    ['PDF parse exceeded its time limit (20 s)', MENU_RECOGNITION_FAILURES.overLimit, 'over_limit'],
    [PAGES_BLANK_MESSAGE, MENU_RECOGNITION_FAILURES.unreadable, 'unreadable'],
    ['OpenRouter vision call failed: 401 User not found', MENU_RECOGNITION_FAILURES.serviceFailure, 'service_failure'],
  ])('%s', (message, text, cause) => {
    expect(failureTextOf(message)).toBe(text);
    expect(failureTextOf(message)).toMatch(/[А-Яа-яЁё]/);
    expect(failureTextOf(message)).not.toMatch(/[A-Za-z]/);
    expect(failureCauseOf(message)).toBe(cause);
  });
});
