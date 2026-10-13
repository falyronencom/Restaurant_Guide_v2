/* eslint-env jest */
/**
 * Unit Tests: utils/refreshTokenStorage.js
 *
 * What refresh_tokens.token holds for a token, and what a presented token is
 * looked up by — including the rows written before hashing, which hold the
 * token itself.
 */

import { createHash } from 'crypto';
import {
  storedRefreshToken,
  refreshTokenLookupValues,
  isStoredBeforeHashing,
} from '../../utils/refreshTokenStorage.js';

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

  test('a token in the shape of the old rows is looked up both ways', () => {
    expect(refreshTokenLookupValues(TOKEN)).toEqual([storedRefreshToken(TOKEN), TOKEN]);
  });

  test('anything else only by its hash — a stored value read out of the table opens nothing', () => {
    const stored = storedRefreshToken(TOKEN);

    expect(refreshTokenLookupValues(stored)).toEqual([storedRefreshToken(stored)]);
    expect(refreshTokenLookupValues('not-a-token-shape')).toEqual([
      storedRefreshToken('not-a-token-shape'),
    ]);
    // Upper-case hex was never generated, so it never names an old row
    expect(refreshTokenLookupValues(TOKEN.toUpperCase())).toHaveLength(1);
  });

  test('tells a row written before hashing from a hashed one', () => {
    expect(isStoredBeforeHashing(TOKEN)).toBe(true);
    expect(isStoredBeforeHashing(storedRefreshToken(TOKEN))).toBe(false);
    expect(isStoredBeforeHashing(undefined)).toBe(false);
    expect(isStoredBeforeHashing(null)).toBe(false);
  });
});
