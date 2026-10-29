/**
 * Why recognition of a menu file failed — as the partner is told.
 *
 * A failed job keeps one record of its cause: the error_message the outcome
 * writers store (ocrJobModel markFailed / markFailedPermanently, the reaper,
 * the poller's settling) — the English message of the exception, for the log
 * and the moderator. The partner reads one of the texts of
 * MENU_RECOGNITION_FAILURES (constants/partnerSectionRefusals.js) instead,
 * chosen here (finding 3 of the Railway incident, directive of 24.10.2026),
 * and the app picks its advice by the cause's code (RECOGNITION_FAILURE_CAUSES).
 * A module of its own so that the partner's menu service reads it without
 * loading the recognition pipeline.
 *
 * The messages of a file with nothing to read are written by ocrService from
 * the constants below, so the classifier and the code that throws cannot
 * drift apart; the messages of a parse over its limit come from
 * pdfParseRunner, and tests/unit/ocrFailureReason.test.js builds them with
 * the runner's own classifyChildEnd.
 */

import { MENU_RECOGNITION_FAILURES } from '../../constants/partnerSectionRefusals.js';

/**
 * ocrService readPagesAsImages: every page of a PDF read as an image came
 * back blank — and on the last attempt the PDF had no text layer to fall
 * back to. The usual end of a PDF with nothing readable on its pages.
 */
export const PAGES_BLANK_MESSAGE = 'vision OCR returned empty text';

/**
 * ocrService processJob: the text read is blank on every page — a photo of a
 * menu read blank. Followed by « via strategy=<strategy>».
 */
export const EMPTY_TEXT_MESSAGE = 'OCR produced empty text';

/** ocrService extractPageTexts: neither a PDF nor an image. Followed by «: <file_type>». */
export const UNSUPPORTED_FILE_MESSAGE = 'Unsupported file_type for OCR';

/**
 * visionOcrAdapter / llmStructurer (openRouterRefusal.js callError): OpenRouter
 * turned the key away — 401 (the key is invalid, disabled or deleted), 402 (the
 * key's limit or the account's balance is spent) or 403 of a spent budget.
 * Every file fails the same until the owner acts in OpenRouter's panel, so the
 * job fails for good at once (ocrService processJob, directive D8 of
 * 28.10.2026). Followed by « (<stage> call): <status> …»; a page's failure is
 * wrapped as «page N of M: …» (ocrService firstPageFailure).
 */
export const KEY_REFUSED_MESSAGE = 'OpenRouter refused the key';

/**
 * The cause as the partner's menu answer names it (`recognition.cause`): the
 * app gives advice by it — a restart helps after a failure of the service,
 * not when the file itself cannot be read.
 */
export const RECOGNITION_FAILURE_CAUSES = Object.freeze({
  unreadable: 'unreadable',
  overLimit: 'over_limit',
  serviceFailure: 'service_failure',
  // The key turned away is a failure of the service too: a restart helps once
  // the key or the balance is back. A code of its own would need a new build
  // of the app, and the advice would be the same.
  unavailable: 'service_failure',
});

/**
 * The messages of a parse that broke its limit (pdfParseRunner limitError):
 * over the time or the memory limit, or the parse's process ended on the file
 * — a crash, any exit but a clean one or a stop signal. The same «ended
 * without a result» after exit code 0 or a stop signal (SIGINT, SIGTERM,
 * SIGHUP — pdfParseRunner STOP_SIGNALS) is the server stopping, not the
 * file: a plain error there, not a limit.
 */
const OVER_LIMIT = /^PDF parse (exceeded its (time|memory) limit|process ended without a result \((?!exit code 0\)|signal SIG(INT|TERM|HUP)\)))/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A file with nothing to read: the messages above, at the start of the message. */
const UNREADABLE = new RegExp(
  `^(${[PAGES_BLANK_MESSAGE, EMPTY_TEXT_MESSAGE, UNSUPPORTED_FILE_MESSAGE].map(escapeRegExp).join('|')})`,
);

/** The key refused: the message above, at the start or behind a page's «page N of M: ». */
const KEY_REFUSED = new RegExp(`^(page \\d+ of \\d+: )?${escapeRegExp(KEY_REFUSED_MESSAGE)}`);

/**
 * The key of MENU_RECOGNITION_FAILURES for a failed job's error_message:
 *   - overLimit — the PDF's parse broke its time or memory limit, or its
 *     process crashed on the file (pdfParseRunner.classifyChildEnd and the
 *     memory sample; PDF_PARSE_LIMIT fails the job for good at once);
 *   - unreadable — the file gave no text: every page of a PDF blank, a photo
 *     read blank, or a file type the recognition does not read;
 *   - unavailable — OpenRouter refused the key (KEY_REFUSED_MESSAGE, also
 *     behind «page N of M: »): spent or revoked, not the file's fault. A job
 *     failed by a 401 or 402 before 28.10.2026 kept the old message and stays
 *     serviceFailure;
 *   - serviceFailure — anything else: the recognition service failed or timed
 *     out, the attempt was cut short (a deploy, a dead process — the
 *     reaper's and the poller's messages). The file itself may be fine.
 * Read at the start of the message: a page's failure is wrapped as
 * «page N of M: …» (ocrService firstPageFailure) and stays the service's.
 *
 * @param {string|null|undefined} errorMessage - ocr_jobs.error_message
 * @returns {'overLimit'|'unreadable'|'unavailable'|'serviceFailure'}
 */
export const failureReasonOf = (errorMessage) => {
  const message = typeof errorMessage === 'string' ? errorMessage : '';
  if (OVER_LIMIT.test(message)) return 'overLimit';
  if (UNREADABLE.test(message)) return 'unreadable';
  if (KEY_REFUSED.test(message)) return 'unavailable';
  return 'serviceFailure';
};

/**
 * The partner's text for a failed job's error_message.
 *
 * @param {string|null|undefined} errorMessage - ocr_jobs.error_message
 * @returns {string}
 */
export const failureTextOf = (errorMessage) => MENU_RECOGNITION_FAILURES[failureReasonOf(errorMessage)];

/**
 * The cause's code for a failed job's error_message (RECOGNITION_FAILURE_CAUSES).
 *
 * @param {string|null|undefined} errorMessage - ocr_jobs.error_message
 * @returns {'unreadable'|'over_limit'|'service_failure'}
 */
export const failureCauseOf = (errorMessage) => RECOGNITION_FAILURE_CAUSES[failureReasonOf(errorMessage)];
