/**
 * Minimal RFC-4180 CSV parser — no external dependency.
 *
 * Handles the cases the Phase-0 review flagged for the real collector workflow:
 *   - a UTF-8 BOM (Excel always prepends one) — stripped, so the first header
 *     is not read as "﻿stable_id";
 *   - delimiter autodetection (',' vs ';') from the header line — ru-locale
 *     Excel exports ';'-delimited CSV;
 *   - quoted fields with embedded delimiters, quotes ("" escape), and newlines;
 *   - CRLF and LF line endings;
 *   - blank trailing lines skipped.
 *
 * Intentionally not streaming — the master sheet is ~500 rows, read whole.
 */

/**
 * Detect the field delimiter from the header line: whichever of ',' or ';'
 * occurs more (outside quotes). Defaults to ',' on a tie/zero.
 * @param {string} headerLine
 * @returns {','|';'}
 */
function detectDelimiter(headerLine) {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ',') commas++;
    else if (!inQuotes && ch === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}

/**
 * Parse CSV text into an array of row objects keyed by header.
 *
 * @param {string} text - Raw file contents (may include a BOM).
 * @returns {{ headers: string[], rows: Array<Record<string,string>>, delimiter: string }}
 * @throws {Error} on a row whose field count differs from the header count
 *   (a structural CSV error — surfaced loudly, never silently padded).
 */
export function parseCsv(text) {
  // Strip UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Find the header line to detect the delimiter (first physical line; headers
  // never contain embedded newlines in practice).
  const firstBreak = text.search(/\r?\n/);
  const headerLine = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const delimiter = detectDelimiter(headerLine);

  const records = tokenize(text, delimiter);
  if (records.length === 0) return { headers: [], rows: [], delimiter };

  const headers = records[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    // Skip a fully-empty line (single empty field, common trailing artifact).
    if (rec.length === 1 && rec[0].trim() === '') continue;
    if (rec.length !== headers.length) {
      throw new Error(
        `CSV row ${r + 1} has ${rec.length} fields, expected ${headers.length} ` +
        `(delimiter '${delimiter}'). Check for an unescaped delimiter or quote.`,
      );
    }
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = rec[c];
    rows.push(obj);
  }
  return { headers, rows, delimiter };
}

/**
 * Split CSV text into an array of records, each an array of raw field strings.
 * State machine over characters — the single source of quote/delimiter truth.
 */
function tokenize(text, delimiter) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => { endField(); records.push(record); record = []; };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { endField(); i++; continue; }
    if (ch === '\r') { // CRLF or lone CR
      endRecord();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') { endRecord(); i++; continue; }
    field += ch; i++;
  }
  // Flush the last field/record if the file does not end with a newline.
  if (field !== '' || record.length > 0) endRecord();
  return records;
}
