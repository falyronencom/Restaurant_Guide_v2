/**
 * PDF Parse Child — the process pdfParseRunner starts for one parse.
 *
 * Says { ready: true, oomScoreAdjusted } once it listens, then reads one
 * message { pdf, maxPages, maxChars }, runs pdf-parse, answers once with
 * { ok: true, text, textLength, numpages, lastPageFound } or
 * { ok: false, error } and exits.
 * The text is cut to maxChars here, in the child (0 — not cut): the API
 * process receives only what it uses, and textLength is the full length.
 * numpages is the count the file declares; lastPageFound — the last of the
 * pages read that the file actually holds (renderPageText says why).
 * Imports nothing of the application (no logger, no config): the runner
 * starts it with a bare environment, and everything it needs comes in the
 * message.
 *
 * Uses the deep import (pdf-parse/lib/pdf-parse.js) for the same reason as
 * pdfTextExtractor did: the package's index.js reads a debug file on load.
 */

import { writeFileSync } from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/**
 * The text of one page, built as pdf-parse 1.1.4 builds it (its render_page in
 * lib/pdf-parse.js, which the library does not export; copied, only the syntax
 * brought to this project's lint rules): the text layer must not change by
 * being read here.
 *
 * Why the parse renders its pages itself: to see which pages exist. The page
 * count pdf-parse reports is the one the file declares (pdf.js 1.10 reads the
 * /Count of its page tree, or the /N of a linearized file) — a file can declare
 * twenty pages and hold one. A page past the pages the file holds does not load
 * («Page index N not found»), pdf-parse takes that for an empty page and calls
 * no renderer for it. Without this, such a file had all its declared pages read
 * as images and counted in the day's pages, three attempts over, while only the
 * pages it held could be drawn (thread «Потолок распознавания: малые правки»,
 * finding 10).
 *
 * @param {Object} pageData - pdf.js PDFPageProxy
 * @returns {Promise<string>}
 */
const renderPageText = (pageData) => pageData.getTextContent({
  // whitespace is not replaced by spaces; same-line items are combined — pdf-parse's choice
  normalizeWhitespace: false,
  disableCombineTextItems: false,
}).then((textContent) => {
  let lastY;
  let text = '';
  for (const item of textContent.items) {
    // Loose equality, as in pdf-parse: both are numbers, or lastY is not set yet.
    if (lastY == item.transform[5] || !lastY) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }
    lastY = item.transform[5];
  }
  return text;
});

// Linux: offer this process first to the kernel's OOM killer, so that a
// container short of memory ends the parse rather than the API. Raising
// one's own score needs no privilege; elsewhere the file does not exist.
let oomScoreAdjusted = false;
try {
  writeFileSync('/proc/self/oom_score_adj', '1000');
  oomScoreAdjusted = true;
} catch {
  // not Linux, or /proc is read-only — the runner's limits still hold
}

// The parent went away (shut down or killed): nobody waits for the answer.
process.on('disconnect', () => process.exit(0));

process.once('message', async ({ pdf, maxPages, maxChars }) => {
  let answer;
  try {
    // A plain Uint8Array copy, not a Buffer (the message arrives as a Buffer
    // view at an offset into a larger ArrayBuffer). pdf.js v1.10 inside
    // pdf-parse 1.1.4 fails a small Buffer as the first document of its
    // process — "bad XRef entry"; measured 18.10.2026: files of 1.4 and 2.8 KB
    // failed, 5.9 KB and larger parsed, and a Uint8Array of the same bytes
    // always parsed. This process parses one document, always its first.
    const data = new Uint8Array(pdf);
    // pdf-parse loads the pages one after another and renders the ones that
    // loaded: the last page rendered is the last page the file holds, of those read.
    let lastPageFound = 0;
    const parsed = await pdfParse(data, {
      max: maxPages,
      pagerender: (pageData) => {
        lastPageFound = Math.max(lastPageFound, pageData.pageNumber);
        return renderPageText(pageData);
      },
    });
    const text = parsed.text || '';
    answer = {
      ok: true,
      text: maxChars > 0 ? text.slice(0, maxChars) : text,
      textLength: text.length,
      numpages: parsed.numpages || 0,
      lastPageFound,
    };
  } catch (error) {
    answer = { ok: false, error: String(error?.message ?? error) };
  }
  process.send(answer, () => process.exit(0));
});

process.send({ ready: true, oomScoreAdjusted });
