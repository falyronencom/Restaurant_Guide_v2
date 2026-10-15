/**
 * Refresh tokens at rest
 *
 * refresh_tokens.token holds a SHA-256 hash of the token, never the token, so
 * a copy of the database — a backup, a dump, a read through someone else's
 * hands — opens no session. password_reset_tokens follows the same rule
 * (migration 032), and for the same reason a bare SHA-256 is enough: a token
 * is 32 random bytes, there is nothing to guess.
 *
 * Stored form: 'sha256:' followed by 64 hex characters. A presented token is
 * looked up by its hash and nothing else, so a value read out of the table is
 * never itself a token here. Rows written before hashing held the token
 * itself; migration 036 hashed them in place, and a row in that shape opens
 * no session any more.
 *
 * The column keeps its name and type (VARCHAR(500)): hashing changed the
 * data, not the schema.
 */

import { createHash } from 'crypto';

const STORED_PREFIX = 'sha256:';

/**
 * The value refresh_tokens.token holds for a token — and the only value a
 * presented token is looked up by.
 *
 * @param {string} token - Refresh token as the client holds it
 * @returns {string} 'sha256:' + 64 hex
 */
export const storedRefreshToken = (token) => (
  STORED_PREFIX + createHash('sha256').update(token, 'utf8').digest('hex')
);
