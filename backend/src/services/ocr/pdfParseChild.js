/**
 * PDF Parse Child — the process pdfParseRunner starts for one parse.
 *
 * Says { ready: true, oomScoreAdjusted } once it listens, then reads one
 * message { pdf, maxPages, maxChars }, runs pdf-parse, answers once with
 * { ok: true, text, textLength, numpages } or { ok: false, error } and exits.
 * The text is cut to maxChars here, in the child (0 — not cut): the API
 * process receives only what it uses, and textLength is the full length.
 * Imports nothing of the application (no logger, no config): the runner
 * starts it with a bare environment, and everything it needs comes in the
 * message.
 *
 * Uses the deep import (pdf-parse/lib/pdf-parse.js) for the same reason as
 * pdfTextExtractor did: the package's index.js reads a debug file on load.
 */

import { writeFileSync } from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

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
    const parsed = await pdfParse(data, { max: maxPages });
    const text = parsed.text || '';
    answer = {
      ok: true,
      text: maxChars > 0 ? text.slice(0, maxChars) : text,
      textLength: text.length,
      numpages: parsed.numpages || 0,
    };
  } catch (error) {
    answer = { ok: false, error: String(error?.message ?? error) };
  }
  process.send(answer, () => process.exit(0));
});

process.send({ ready: true, oomScoreAdjusted });
