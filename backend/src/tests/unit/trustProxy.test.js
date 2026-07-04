/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Regression pin for `app.set('trust proxy', 1)` (OSB-G1).
 *
 * Behind Railway's edge proxy, Express with the default trust proxy=false
 * resolves req.ip to the proxy hop, so every per-IP rate-limit bucket
 * collapses into ONE shared bucket and real visitors 429 each other.
 * These tests exercise the REAL app exported by server.js (not a mini-app),
 * so they fail if the setting is ever removed or changed to a value that
 * stops honoring the first X-Forwarded-For hop.
 */
import { jest } from '@jest/globals';

// Mock the whole redis config surface BEFORE importing the app: server.js and
// its import graph bind connectRedis/disconnectRedis and the cache helpers,
// and the limiter needs deterministic counters (no live Redis in unit tests).
const incrementWithExpiry = jest.fn();
const getTTL = jest.fn();

jest.unstable_mockModule('../../config/redis.js', () => ({
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  incrementWithExpiry,
  getCounter: jest.fn(),
  getTTL,
  setWithExpiry: jest.fn(),
  deleteKey: jest.fn(),
  default: {},
}));

const { default: app } = await import('../../server.js');
const { default: request } = await import('supertest');

describe('trust proxy (OSB-G1)', () => {
  beforeEach(() => {
    // jest.config resetMocks:true wipes implementations between tests —
    // (re)arm them here, never at module scope (feedback_jest_resetmocks).
    incrementWithExpiry.mockResolvedValue(1);
    getTTL.mockResolvedValue(3600);
  });

  test('app trusts exactly one proxy hop (integer 1, never true)', () => {
    // `true` would trust the full client-supplied X-Forwarded-For chain,
    // letting an attacker mint unlimited per-IP buckets by spoofing it.
    expect(app.get('trust proxy')).toBe(1);
  });

  test('unauthenticated limiter keys on the forwarded client IP — different clients land in separate buckets', async () => {
    await request(app)
      .get('/rate-limit-probe')
      .set('X-Forwarded-For', '203.0.113.10');
    await request(app)
      .get('/rate-limit-probe')
      .set('X-Forwarded-For', '198.51.100.20');

    expect(incrementWithExpiry).toHaveBeenCalledTimes(2);
    const [keyA] = incrementWithExpiry.mock.calls[0];
    const [keyB] = incrementWithExpiry.mock.calls[1];

    // Each bucket keys on the real client IP from X-Forwarded-For…
    expect(keyA).toContain('ratelimit:ip:203.0.113.10:');
    expect(keyB).toContain('ratelimit:ip:198.51.100.20:');
    // …so two clients never share a bucket (the pre-fix collapse mode).
    expect(keyA).not.toBe(keyB);
  });

  test('same forwarded client hits the same bucket across requests', async () => {
    await request(app)
      .get('/rate-limit-probe')
      .set('X-Forwarded-For', '203.0.113.10');
    await request(app)
      .get('/rate-limit-probe')
      .set('X-Forwarded-For', '203.0.113.10');

    expect(incrementWithExpiry).toHaveBeenCalledTimes(2);
    const [keyFirst] = incrementWithExpiry.mock.calls[0];
    const [keySecond] = incrementWithExpiry.mock.calls[1];
    expect(keyFirst).toBe(keySecond);
  });

  test('only the first (nearest) hop is trusted — spoofed extra hops are ignored', async () => {
    // Client sends a forged chain; Railway appends the real socket peer last.
    // With trust proxy=1 Express must take the LAST entry (the one added by
    // the single trusted proxy), not the attacker-controlled head.
    await request(app)
      .get('/rate-limit-probe')
      .set('X-Forwarded-For', '10.99.99.99, 203.0.113.10');

    expect(incrementWithExpiry).toHaveBeenCalledTimes(1);
    const [key] = incrementWithExpiry.mock.calls[0];
    expect(key).toContain('ratelimit:ip:203.0.113.10:');
    expect(key).not.toContain('10.99.99.99');
  });
});
