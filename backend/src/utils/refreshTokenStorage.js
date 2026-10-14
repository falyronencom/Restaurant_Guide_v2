/**
 * Refresh tokens at rest
 *
 * refresh_tokens.token holds a SHA-256 hash of the token, never the token, so
 * a copy of the database — a backup, a dump, a read through someone else's
 * hands — opens no session. password_reset_tokens follows the same rule
 * (migration 032), and for the same reason a bare SHA-256 is enough: a token
 * is 32 random bytes, there is nothing to guess.
 *
 * Stored form: 'sha256:' followed by 64 hex characters. The prefix is what
 * tells a hashed row from one written before hashing, which holds the token
 * itself — 64 hex characters, no prefix. Those rows are still found by the
 * token, so a session opened before the change survives it, until the session
 * rotates (its successor is stored hashed), expires, or migration 036 hashes
 * the row in place. A presented value is compared as a token only in that old
 * shape: a hash read out of the table is never itself a token here.
 *
 * The column keeps its name and type (VARCHAR(500)): no schema change, so the
 * code works whether or not 036 has run.
 */

import { createHash } from 'crypto';

const STORED_PREFIX = 'sha256:';

/** What generateRefreshToken produced, and what rows written before hashing hold. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/**
 * The value refresh_tokens.token holds for a token.
 *
 * @param {string} token - Refresh token as the client holds it
 * @returns {string} 'sha256:' + 64 hex
 */
export const storedRefreshToken = (token) => (
  STORED_PREFIX + createHash('sha256').update(token, 'utf8').digest('hex')
);

/**
 * Values refresh_tokens.token may hold for a presented token: its hash, and —
 * for a row written before hashing — the token itself, if it has the shape
 * such rows hold. For `WHERE token = ANY($n)`.
 *
 * @param {string} token - Refresh token as presented
 * @returns {string[]}
 */
export const refreshTokenLookupValues = (token) => (
  TOKEN_SHAPE.test(token) ? [storedRefreshToken(token), token] : [storedRefreshToken(token)]
);

/**
 * Whether a stored value is a token written before hashing (no prefix).
 *
 * @param {string} value - refresh_tokens.token
 * @returns {boolean}
 */
export const isStoredBeforeHashing = (value) => typeof value === 'string' && TOKEN_SHAPE.test(value);
