/**
 * PDF Parse Child — the process pdfParseRunner starts for one parse.
 *
 * Says { ready: true, oomScoreAdjusted } once it listens, then reads one
 * message { pdf, maxPages, maxChars }, runs pdf-parse, answers once with
 * { ok: true, text, textLength, numpages, lastPageFound, pagesInTree } or
 * { ok: false, error } and exits.
 * The text is cut to maxChars here, in the child (0 — not cut): the API
 * process receives only what it uses, and textLength is the full length.
 * numpages is the count the file declares; lastPageFound — the last of the
 * pages read that loaded; pagesInTree — the pages the file holds, when its page
 * tree ends before the pages read, otherwise null (renderPageText and
 * pastPageTree say why).
 * Imports nothing of the application (no logger, no config): the runner
 * starts it with a bare environment, and everything it needs comes in the
 * message.
 *
 * Uses the deep import (pdf-parse/lib/pdf-parse.js) for the same reason as
 * pdfTextExtractor did: the package's index.js reads a debug file on load.
 */

import { writeFileSync } from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
// The build of pdf.js pdf-parse runs (its default, named below for both reads).
import PDFJS from 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js';

const PDFJS_VERSION = 'v1.10.100';

/**
 * The text of one page, built as pdf-parse 1.1.4 builds it (its render_page in
 * lib/pdf-parse.js, which the library does not export; copied, only the syntax
 * brought to this project's lint rules): the text layer must not change by
 * being read here.
 *
 * Why the parse renders its pages itself: to see which pages load. The page
 * count pdf-parse reports is the one the file declares (pdf.js 1.10 reads the
 * /Count of its page tree, or the /N of a linearized file — read in pdf.js; the
 * tests build /Count only) — a file can declare twenty pages and hold one.
 * pdf-parse takes a page that does not load for an empty one and calls no
 * renderer for it. Without this, such a file had all its declared pages read
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

/** What pdf.js 1.10 says for a page past the file's page tree (measured 08.11.2026). */
const PAST_PAGE_TREE = /^Page index \d+ not found\.?$/;

/**
 * Whether page `pageNumber` is past the file's page tree, rather than in it and
 * unreadable. A page that does not load is not always missing: a page the tree
 * names but pdf.js 1.10 cannot read (a tree entry pointing nowhere — «page
 * dictionary kid reference points to wrong type of object») fails the same way
 * for pdf-parse, and another reader — the cloud that draws the pages — may
 * still draw it (review of the thread, finding M1). pdf-parse keeps no page's
 * error and has closed the file, so the file is opened again and asked for that
 * page only. Any other answer — the page loads, another error, the file does
 * not open — reads as «not past»: the declared count stands, as before.
 *
 * @param {Uint8Array} bytes - A copy of the file of its own: pdf.js keeps what it is given
 * @param {number} pageNumber
 * @returns {Promise<boolean>}
 */
const pastPageTree = async (bytes, pageNumber) => {
  let doc = null;
  try {
    PDFJS.disableWorker = true;
    doc = await PDFJS.getDocument(bytes);
    await doc.getPage(pageNumber);
    return false;
  } catch (error) {
    return PAST_PAGE_TREE.test(String(error?.message ?? ''));
  } finally {
    doc?.destroy();
  }
};

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
    // always parsed.
    const data = new Uint8Array(pdf);
    // pdf-parse loads the pages one after another and renders the ones that loaded.
    let lastPageFound = 0;
    const parsed = await pdfParse(data, {
      max: maxPages,
      version: PDFJS_VERSION,
      pagerender: (pageData) => {
        lastPageFound = Math.max(lastPageFound, pageData.pageNumber);
        return renderPageText(pageData);
      },
    });
    const text = parsed.text || '';
    const numpages = parsed.numpages || 0;
    // The pages that loaded end before the pages read: the file may hold no more.
    const lastPageToRead = maxPages > 0 ? Math.min(numpages, maxPages) : numpages;
    const pagesInTree = lastPageFound > 0 && lastPageFound < lastPageToRead
      && await pastPageTree(new Uint8Array(pdf), lastPageFound + 1)
      ? lastPageFound
      : null;
    answer = {
      ok: true,
      text: maxChars > 0 ? text.slice(0, maxChars) : text,
      textLength: text.length,
      numpages,
      lastPageFound,
      pagesInTree,
    };
  } catch (error) {
    answer = { ok: false, error: String(error?.message ?? error) };
  }
  process.send(answer, () => process.exit(0));
});

process.send({ ready: true, oomScoreAdjusted });
