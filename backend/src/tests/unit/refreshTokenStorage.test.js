/* eslint-env jest */
/**
 * Unit Tests: utils/refreshTokenStorage.js
 *
 * What refresh_tokens.token holds for a token — which is also the only value
 * a presented token is looked up by (unit/authService.test.js and
 * integration/refresh-token-storage.test.js hold the lookup to that).
 */

import { createHash } from 'crypto';
import { storedRefreshToken } from '../../utils/refreshTokenStorage.js';

const TOKEN = '0123456789abcdef'.repeat(4); // the shape generateRefreshToken produces

describe('refreshTokenStorage', () => {
  test('stores the SHA-256 of the token behind a prefix, never the token', () => {
    const stored = storedRefreshToken(TOKEN);

    expect(stored).toBe(`sha256:${createHash('sha256').update(TOKEN).digest('hex')}`);
    expect(stored).not.toContain(TOKEN);
    // Fits the column (VARCHAR(500)) with room to spare
    expect(stored).toHaveLength(71);
  });

  test('matches what migration 036 writes: SHA-256 of the UTF-8 bytes, lowercase hex', () => {
    // encode(sha256(convert_to(token, 'UTF8')), 'hex') in SQL
    expect(storedRefreshToken('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
