/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: jwt.js
 *
 * Tests JWT token generation and verification utilities.
 * These tests verify:
 * - Access token generation and verification
 * - Refresh token generation
 * - Token extraction from headers
 * - Expiration handling
 */

import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import nodeCrypto, { createHmac } from 'crypto';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  generateAccessToken,
  generateRefreshToken,
  deriveSuccessorRefreshToken,
  verifyAccessToken,
  extractTokenFromHeader,
  getRefreshTokenExpiry,
  accessTokenIssuedAtMs,
} from '../../utils/jwt.js';

describe('jwt utilities', () => {
  // Set up test JWT_SECRET for verification
  const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-chars-long!!';

  describe('generateAccessToken', () => {
    test('should generate valid JWT access token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    test('should include correct claims in token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'partner',
      };

      const token = generateAccessToken(payload);
      const decoded = jwt.decode(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.role).toBe('partner');
      expect(decoded.type).toBe('access');
      expect(decoded.iss).toBe('restaurant-guide-belarus');
      expect(decoded.aud).toBe('restaurant-guide-api');
    });

    test('should include expiration claim', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);
      const decoded = jwt.decode(token);

      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    test('should generate different tokens for same payload at different times', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token1 = generateAccessToken(payload);
      expect(token1).toBeDefined();

      // Wait a few ms to ensure a different issue time (iatMs is per millisecond)
      const token2 = new Promise(resolve => {
        setTimeout(() => resolve(generateAccessToken(payload)), 5);
      });

      return token2.then(t2 => {
        expect(typeof t2).toBe('string');
        expect(t2).not.toBe(token1);
      });
    });
  });

  describe('issue time in milliseconds (revoked sessions, migration 035)', () => {
    const payload = { userId: 'user-123', email: 'test@example.com', role: 'user' };

    test('the token carries iatMs, and iat is the same reading in whole seconds', () => {
      const before = Date.now();
      const decoded = jwt.decode(generateAccessToken(payload));
      const after = Date.now();

      expect(Number.isSafeInteger(decoded.iatMs)).toBe(true);
      expect(decoded.iatMs).toBeGreaterThanOrEqual(before);
      expect(decoded.iatMs).toBeLessThanOrEqual(after);
      expect(decoded.iat).toBe(Math.floor(decoded.iatMs / 1000));
      // exp is still counted from iat: the lifetime did not change.
      expect(decoded.exp - decoded.iat).toBe(4 * 60 * 60);
    });

    test('accessTokenIssuedAtMs reads iatMs when the token has it', () => {
      expect(accessTokenIssuedAtMs({ iat: 1791792208, iatMs: 1791792208137 })).toBe(1791792208137);
    });

    test('a token issued before iatMs existed is placed at the start of its iat second', () => {
      // Never later than the moment it was really issued: against a revocation
      // stamp such a token can only come out older.
      expect(accessTokenIssuedAtMs({ iat: 1791792208 })).toBe(1791792208000);
      expect(accessTokenIssuedAtMs({ iat: 1791792208, iatMs: '1791792208137' })).toBe(1791792208000);
    });

    test('a token with no issue time at all counts as the oldest possible', () => {
      expect(accessTokenIssuedAtMs({})).toBe(0);
    });
  });

  describe('generateRefreshToken', () => {
    test('should generate 64-character hex string', () => {
      const token = generateRefreshToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
      expect(token).toMatch(/^[a-f0-9]{64}$/); // Hex format
    });

    test('should generate unique tokens', () => {
      const token1 = generateRefreshToken();
      const token2 = generateRefreshToken();
      const token3 = generateRefreshToken();

      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).not.toBe(token3);
    });

    // Uniqueness of 100 tokens cannot tell a CSPRNG from Math.random or a
    // counter: that is a separate claim, held by the next test.
    test('100 tokens are all different', () => {
      const tokens = new Set();

      // Generate 100 tokens
      for (let i = 0; i < 100; i++) {
        tokens.add(generateRefreshToken());
      }

      // All should be unique
      expect(tokens.size).toBe(100);
    });

    test('should be cryptographically random: 32 bytes of crypto.randomBytes, hex', () => {
      const randomBytes = jest.spyOn(nodeCrypto, 'randomBytes');

      const token = generateRefreshToken();

      expect(randomBytes).toHaveBeenCalledWith(32);
      expect(token).toBe(randomBytes.mock.results[0].value.toString('hex'));
    });
  });

  describe('deriveSuccessorRefreshToken', () => {
    const predecessor = 'a'.repeat(64);
    const rowId = '7f9c2b4e-1d3a-4c5b-9e8f-0a1b2c3d4e5f';

    test('has the shape of a generated token', () => {
      expect(deriveSuccessorRefreshToken(predecessor, rowId)).toMatch(/^[a-f0-9]{64}$/);
    });

    test('is the same every time for the same predecessor and row — the grace window relies on it', () => {
      expect(deriveSuccessorRefreshToken(predecessor, rowId))
        .toBe(deriveSuccessorRefreshToken(predecessor, rowId));
    });

    test('depends on both the predecessor and the row id', () => {
      const base = deriveSuccessorRefreshToken(predecessor, rowId);
      expect(deriveSuccessorRefreshToken('b'.repeat(64), rowId)).not.toBe(base);
      expect(deriveSuccessorRefreshToken(predecessor, '00000000-0000-4000-8000-000000000000'))
        .not.toBe(base);
    });

    // The key comes from JWT_SECRET, read once when the module loads: the same
    // inputs are derived again in a process of its own, under the same secret
    // (the control) and under another one.
    test('changes with the server secret: another JWT_SECRET gives another successor', () => {
      const jwtModule = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'utils', 'jwt.js');
      const deriveUnder = (secret) => {
        const script = `
          import { deriveSuccessorRefreshToken } from ${JSON.stringify(pathToFileURL(jwtModule).href)};
          console.log('DERIVED=' + deriveSuccessorRefreshToken(${JSON.stringify(predecessor)}, ${JSON.stringify(rowId)}));
        `;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
          env: { ...process.env, JWT_SECRET: secret },
          encoding: 'utf8',
          timeout: 10000,
        });
        expect(child.status).toBe(0);
        return (child.stdout.match(/DERIVED=([0-9a-f]+)/) || [])[1];
      };
      const derived = deriveSuccessorRefreshToken(predecessor, rowId);

      expect(deriveUnder(TEST_JWT_SECRET)).toBe(derived);
      expect(deriveUnder(`${TEST_JWT_SECRET}-rotated`)).not.toBe(derived);
    });

    test('is keyed by the server secret: the inputs alone do not give it', () => {
      // Whatever the database and a burned token reveal — the predecessor and
      // the row id — a hash or an HMAC of them without the key is not the
      // successor.
      const derived = deriveSuccessorRefreshToken(predecessor, rowId);
      const unkeyed = createHmac('sha256', '').update(`${rowId}\n${predecessor}`).digest('hex');
      const keyedBySecretItself = createHmac('sha256', TEST_JWT_SECRET)
        .update(`${rowId}\n${predecessor}`).digest('hex');
      expect(derived).not.toBe(unkeyed);
      // A label of its own: the secret is not used as it is.
      expect(derived).not.toBe(keyedBySecretItself);
    });
  });

  describe('verifyAccessToken', () => {
    test('should verify valid token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);
      const decoded = verifyAccessToken(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.role).toBe('user');
      expect(decoded.type).toBe('access');
    });

    test('should throw error for invalid token', () => {
      expect(() => {
        verifyAccessToken('invalid-token');
      }).toThrow();
    });

    test('should throw error for token with wrong signature', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      // Sign with different secret
      const badToken = jwt.sign(payload, 'wrong-secret-key-32-chars-long!!', {
        expiresIn: '15m',
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(badToken);
      }).toThrow();
    });

    test('should throw error for expired token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      // Create token that expires immediately
      const expiredToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '-1s', // Negative = already expired
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(expiredToken);
      }).toThrow(/expired/i);
    });

    test('should throw error for non-access token type', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'refresh', // Wrong type
      };

      const wrongTypeToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '15m',
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(wrongTypeToken);
      }).toThrow(/Invalid token type/i);
    });

    test('should throw error for token with wrong issuer', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      const badIssuerToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '15m',
        issuer: 'wrong-issuer',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(badIssuerToken);
      }).toThrow();
    });

    test('should throw error for token with wrong audience', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      const badAudienceToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '15m',
        issuer: 'restaurant-guide-belarus',
        audience: 'wrong-audience',
      });

      expect(() => {
        verifyAccessToken(badAudienceToken);
      }).toThrow();
    });
  });

  describe('extractTokenFromHeader', () => {
    test('should extract token from valid Bearer header', () => {
      const token = 'abc123xyz';
      const header = `Bearer ${token}`;

      const extracted = extractTokenFromHeader(header);

      expect(extracted).toBe(token);
    });

    test('should return null for missing header', () => {
      expect(extractTokenFromHeader(null)).toBeNull();
      expect(extractTokenFromHeader(undefined)).toBeNull();
      expect(extractTokenFromHeader('')).toBeNull();
    });

    test('should return null for malformed header (no Bearer prefix)', () => {
      expect(extractTokenFromHeader('abc123xyz')).toBeNull();
      expect(extractTokenFromHeader('Basic abc123xyz')).toBeNull();
    });

    test('should handle token with spaces correctly', () => {
      const header = 'Bearer token-with-content';
      const extracted = extractTokenFromHeader(header);

      expect(extracted).toBe('token-with-content');
    });

    test('should extract JWT format tokens', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ';
      const header = `Bearer ${jwtToken}`;

      const extracted = extractTokenFromHeader(header);

      expect(extracted).toBe(jwtToken);
    });

    test('should handle case-sensitive Bearer prefix', () => {
      expect(extractTokenFromHeader('bearer token123')).toBeNull();
      expect(extractTokenFromHeader('BEARER token123')).toBeNull();
      expect(extractTokenFromHeader('Bearer token123')).toBe('token123');
    });
  });

  describe('getRefreshTokenExpiry', () => {
    test('should return date 30 days in future', () => {
      const now = new Date();
      const expiry = getRefreshTokenExpiry();

      const daysDifference = (expiry - now) / (1000 * 60 * 60 * 24);

      expect(expiry).toBeInstanceOf(Date);
      expect(daysDifference).toBeGreaterThan(29);
      expect(daysDifference).toBeLessThan(31);
    });

    test('should return different timestamps when called multiple times', () => {
      const expiry1 = getRefreshTokenExpiry();

      return new Promise(resolve => {
        setTimeout(() => {
          const expiry2 = getRefreshTokenExpiry();
          expect(expiry2.getTime()).toBeGreaterThanOrEqual(expiry1.getTime());
          resolve();
        }, 10);
      });
    });

    test('should return valid Date object', () => {
      const expiry = getRefreshTokenExpiry();

      expect(expiry).toBeInstanceOf(Date);
      expect(isNaN(expiry.getTime())).toBe(false);
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Token Security', () => {
    test('access tokens should not be modifiable without detection', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);

      // Try to modify the payload (change role to admin)
      const [header, payloadPart, signature] = token.split('.');
      const decodedPayload = JSON.parse(Buffer.from(payloadPart, 'base64').toString());
      decodedPayload.role = 'admin';
      const modifiedPayloadPart = Buffer.from(JSON.stringify(decodedPayload)).toString('base64');
      const modifiedToken = `${header}.${modifiedPayloadPart}.${signature}`;

      // Verification should fail
      expect(() => {
        verifyAccessToken(modifiedToken);
      }).toThrow();
    });

    test('tokens should include all required security claims', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);
      const decoded = jwt.decode(token);

      // Security claims
      expect(decoded.iat).toBeDefined(); // Issued at
      expect(decoded.exp).toBeDefined(); // Expiration
      expect(decoded.iss).toBeDefined(); // Issuer
      expect(decoded.aud).toBeDefined(); // Audience
      expect(decoded.type).toBe('access'); // Token type
    });
  });
});
