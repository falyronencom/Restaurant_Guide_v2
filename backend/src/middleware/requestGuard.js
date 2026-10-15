/**
 * Request Guard
 *
 * Refuses, before any route runs, request input that no handler can carry to
 * PostgreSQL. Until 2026-10 both classes below reached the database from every
 * client of the API and came back as a 500 with an error-level stack in the
 * production log (stand probe 12.10.2026: catalog and map, reviews by slug, the
 * card and its menu by slug, both searches):
 *
 * - U+0000 (NUL). A Postgres text value cannot hold it, so any parameter that
 *   carries one fails with 22021 («invalid byte sequence for encoding "UTF8":
 *   0x00») whatever the operator — `= ANY`, `ILIKE`, `attributes -> $n`,
 *   `slug = $1`. Refused with 400 INVALID_FORMAT, never stripped: stripping
 *   would quietly change what was asked (a password, a slug) instead of saying
 *   no. The other control characters (U+0001–U+001F, U+007F) are valid text for
 *   the database and stay with the handlers (smart search's sanitizeQuery).
 *
 * - A page number with no page behind it. OFFSET = (page − 1) × limit leaves
 *   bigint from about page 4.6·10^17 (22003 → 500); a longer number makes
 *   JavaScript print the product in exponent form, which Postgres cannot read
 *   (22P02 → 400, still logged as a server error). About twenty paginated
 *   endpoints in twelve controllers read `page` with no upper bound, and the
 *   classic search and partner bookings read `offset` the same way, so the
 *   upper bound of both lives here, for the endpoints that do not exist yet as
 *   well. Refused with 422 VALIDATION_ERROR, like the handlers' own «Page must
 *   be a positive integer». Lower bounds and `limit` stay with each endpoint.
 *
 * A refusal goes through errorHandler as a 4xx: a warning without a stack.
 *
 * Not covered: multipart fields. multer parses them inside the route, after
 * this guard — every multipart route sits behind authenticate.
 */

import { AppError } from './errorHandler.js';

/**
 * The highest page number the API serves — the site's ceiling
 * (web/src/lib/catalog-params.ts MAX_PAGE; unit/requestGuard holds the two
 * equal). 10 000 pages hold 200 000 cards at the catalog's 20 a page — all of
 * Belarus's catering is 16 699 places (Belstat, 1.01.2026) — and 100 000
 * reviews of one place at 10. Up to the ceiling a page past the last one stays
 * honestly empty; above it the number is not a page of any listing that can
 * exist.
 */
export const MAX_PAGE = 10_000;

/**
 * The highest `offset` (classic search, partner bookings): a million rows into
 * a listing — sixty times all of Belarus's catering.
 */
export const MAX_OFFSET = 1_000_000;

const NUL = String.fromCharCode(0);

/**
 * `%00` is the only way U+0000 gets into a URL: a raw NUL byte does not get
 * past Node's HTTP parser, and the overlong `%C0%80` fails decodeURIComponent.
 * The query parser and the router decode `%00` into the value a handler reads
 * (`req.query`, `req.params`), so the encoded URL answers for both.
 *
 * @param {string} url - req.originalUrl (path and query string, still encoded)
 * @returns {boolean}
 */
export function urlHasNul(url) {
  return typeof url === 'string' && url.includes('%00');
}

/**
 * Every string of a parsed body, keys included — a key can reach a jsonb
 * column (establishment attributes). Walked with an explicit stack, so a
 * deeply nested JSON body cannot overflow the call stack; a string is checked
 * where it is found and only containers wait on the stack, so a 10 MB array of
 * numbers costs one pass instead of a stack entry and an index string per
 * element (review 13.10: 1.2 s and ~300 MB against 0.1 s of JSON.parse).
 *
 * @param {*} body - req.body as express.json / express.urlencoded left it
 * @returns {boolean}
 */
export function bodyHasNul(body) {
  const pending = [];
  const holdsNul = (value) => {
    if (typeof value === 'string') return value.includes(NUL);
    if (value !== null && typeof value === 'object') pending.push(value);
    return false;
  };

  if (holdsNul(body)) return true;
  while (pending.length > 0) {
    const container = pending.pop();
    if (Array.isArray(container)) {
      for (let i = 0; i < container.length; i += 1) {
        if (holdsNul(container[i])) return true;
      }
    } else {
      for (const key of Object.keys(container)) {
        if (key.includes(NUL) || holdsNul(container[key])) return true;
      }
    }
  }
  return false;
}

/**
 * A pagination value read the way the handlers read it — parseInt(value, 10),
 * which is also express-validator's toInt() — or null when that reading
 * throws. It throws on an object whose toString is not a function
 * (`?page[toString]=x` in the query string, `{"page":{"toString":1}}` in
 * JSON): such a value has no text form, and the handler reading it would
 * answer 500 (review 13.10).
 *
 * @param {*} value
 * @returns {number|null} NaN when the handlers would not read a number either
 */
function readInteger(value) {
  try {
    return Number.parseInt(value, 10);
  } catch {
    return null;
  }
}

/**
 * The refusal for one pagination field, or null when the value may pass.
 *
 * @param {'page'|'offset'} field
 * @param {*} value
 * @param {number} ceiling
 * @returns {AppError|null}
 */
function paginationRefusal(field, value, ceiling) {
  const name = field === 'page' ? 'Page' : 'Offset';
  const read = readInteger(value);
  let message = null;
  if (read === null) message = `${name} must be a number`;
  else if (read > ceiling) message = `${name} must not exceed ${ceiling}`;
  return message === null
    ? null
    : new AppError(message, 422, 'VALIDATION_ERROR', [{ field, message }]);
}

/**
 * Express middleware, mounted on /api before the routes (server.js).
 *
 * `1e18` is page 1 here, as it is in the handlers, and a value they read as no
 * number at all (`abc`, an empty string, `{a: 1}`) passes untouched:
 * defaulting or refusing it stays each endpoint's own rule, as before. `page`
 * comes from the query string (every listing) or from a JSON body (smart
 * search).
 */
export const requestGuard = (req, res, next) => {
  if (urlHasNul(req.originalUrl)) {
    return next(new AppError('Request URL contains a NUL character (U+0000)', 400, 'INVALID_FORMAT'));
  }
  if (bodyHasNul(req.body)) {
    return next(new AppError('Request body contains a NUL character (U+0000)', 400, 'INVALID_FORMAT'));
  }

  for (const source of [req.query, req.body]) {
    if (source === null || typeof source !== 'object') continue;

    const refusal = paginationRefusal('page', source.page, MAX_PAGE)
      || paginationRefusal('offset', source.offset, MAX_OFFSET);
    if (refusal) return next(refusal);
  }

  return next();
};
