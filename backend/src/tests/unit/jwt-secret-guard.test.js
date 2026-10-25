/* eslint-env jest */
/**
 * The server does not start with a JWT_SECRET anyone could know (Railway
 * incident 21–24.10.2026, finding 6). Until then the start-up check was the
 * length only: the placeholder of the root .env.example (52 characters)
 * passed it, and a server deployed with it would sign tokens with a key the
 * public repository prints.
 *
 * What the check refuses; the start-up itself — jwt-secret-startup.test.js.
 */
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  MAX_REPEATED_PIECE,
  MIN_DISTINCT_CHARACTERS,
  PUBLISHED_PLACEHOLDER_SECRETS,
  jwtSecretProblem,
} from '../../utils/jwt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..', '..', '..');
const REPO = resolve(BACKEND, '..');

/** The JWT_SECRET values the repository publishes, read from the files themselves. */
const publishedSecrets = () => [
  join(REPO, '.env.example'),
  join(BACKEND, '.env.example'),
  join(REPO, '.github', 'workflows', 'ci.yml'),
].flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/^\s*JWT_SECRET\s*=\s*(\S+)\s*$/gm)]
  .map((m) => ({ file, value: m[1] })));

const randomHex = (bytes) => randomBytes(bytes).toString('hex');

describe('jwtSecretProblem', () => {
  test('every JWT_SECRET the repository publishes is refused — the list follows the files', () => {
    const published = publishedSecrets();
    // The root .env.example, backend/.env.example and ci.yml: one each
    expect(published).toHaveLength(3);
    published.forEach(({ file, value }) => {
      expect({ file, problem: jwtSecretProblem(value) }).toEqual({ file, problem: expect.any(String) });
    });
  });

  test('a published placeholder is refused whatever its case, and with spaces around it', () => {
    PUBLISHED_PLACEHOLDER_SECRETS.forEach((placeholder) => {
      expect(jwtSecretProblem(placeholder)).toMatch(/placeholder/);
      expect(jwtSecretProblem(placeholder.toUpperCase())).toMatch(/placeholder/);
      expect(jwtSecretProblem(` ${placeholder} `)).toMatch(/placeholder/);
    });
    // The root .env.example's placeholder is 52 characters: the length alone let it through
    expect(PUBLISHED_PLACEHOLDER_SECRETS[0].length).toBeGreaterThanOrEqual(32);
  });

  test('"test-…" is refused, whatever its case', () => {
    expect(jwtSecretProblem(`test-${randomHex(32)}`)).toMatch(/test-/);
    expect(jwtSecretProblem(`TEST-${randomHex(32)}`)).toMatch(/test-/);
    // Only at the start: a random secret that happens to contain it is fine
    expect(jwtSecretProblem(`${randomHex(16)}test-${randomHex(16)}`)).toBeNull();
  });

  test('a plainly hand-made secret is refused: few distinct characters, or a short piece repeated', () => {
    expect(jwtSecretProblem('a'.repeat(40))).toMatch(/not random/);
    expect(jwtSecretProblem('ab'.repeat(20))).toMatch(/not random/);
    expect(jwtSecretProblem('1234567890'.repeat(4))).toMatch(/not random/);
    expect(jwtSecretProblem('qwertyuiopasdfgh'.repeat(3))).toMatch(/not random/);
    // The edges: 7 distinct characters refused, 8 not; a piece of 16 repeated refused, of 17 not
    const seven = 'abcdefg';
    const eight = 'abcdefgh';
    expect(MIN_DISTINCT_CHARACTERS).toBe(8);
    expect(jwtSecretProblem(`${seven}${'gfedcba'}${seven.split('').reverse().join('')}aabbccddeeffgg`))
      .toMatch(/not random/);
    expect(jwtSecretProblem(`${eight}hgfedcba${eight}aabbccddeeffgghh`)).toBeNull();
    expect(MAX_REPEATED_PIECE).toBe(16);
    const piece16 = '0123456789abcdef';
    const piece17 = '0123456789abcdefx';
    expect(jwtSecretProblem(piece16.repeat(3))).toMatch(/not random/);
    expect(jwtSecretProblem(piece17.repeat(2))).toBeNull();
  });

  test('a short secret is refused, as before', () => {
    expect(jwtSecretProblem(undefined)).toMatch(/32/);
    expect(jwtSecretProblem('')).toMatch(/32/);
    expect(jwtSecretProblem(randomHex(15))).toMatch(/32/);
  });

  test('a generated secret passes — the thresholds never refuse one', () => {
    // The poorest a generator gives: 32 hex characters (openssl rand -hex 16)
    for (let i = 0; i < 1000; i += 1) {
      expect(jwtSecretProblem(randomHex(16))).toBeNull();
    }
    expect(jwtSecretProblem(randomHex(32))).toBeNull();
    expect(jwtSecretProblem(randomBytes(32).toString('base64'))).toBeNull();
    expect(jwtSecretProblem(randomBytes(48).toString('base64url'))).toBeNull();
  });
});
