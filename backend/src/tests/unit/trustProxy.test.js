/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Regression pin for `trust proxy` — whose address req.ip is.
 *
 * Behind Railway's edge the right-most X-Forwarded-For entry is a Railway hop
 * and the client is the entry left of it (config/trustProxy.js). Until 25.10.2026 the app trusted one
 * hop (OSB-G1), took that Railway hop for the client, and every client
 * passing through the same hop shared every per-address limit — the
 * production probe saw one machine in four counters within a minute.
 * These tests exercise the REAL app exported by server.js (not a mini-app),
 * with the chain shaped as the edge sends it, so they fail if the setting
 * slips back to 1 (the hop becomes the key) or grows past 2 (a forged entry
 * left of the client becomes the key).
 */
import { jest } from '@jest/globals';

// Mock the whole redis config surface BEFORE importing the app: server.js and
// its import graph bind connectRedis/disconnectRedis and the cache helpers,
// and the limiter needs deterministic counters (no live Redis in unit tests).
const incrementWithExpiry = jest.fn();
const getTTL = jest.fn();

const redisMock = () => ({
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  incrementWithExpiry,
  decrement: jest.fn(),
  getCounter: jest.fn(),
  getTTL,
  setWithExpiry: jest.fn(),
  deleteKey: jest.fn(),
  withRedisDeadline: (command) => command,
  default: {},
});
jest.unstable_mockModule('../../config/redis.js', redisMock);

const { default: app } = await import('../../server.js');
const { default: request } = await import('supertest');
const {
  DEFAULT_TRUST_PROXY_HOPS,
  FALLBACK_TRUST_PROXY_HOPS,
  resolveTrustProxyHops,
} = await import('../../config/trustProxy.js');

// Two Railway hops as the probe of 25.10 saw them: a request goes out through
// one of several, and the right-most X-Forwarded-For entry is that hop.
const HOP_A = '152.233.10.1';
const HOP_B = '152.233.20.2';
const CLIENT_A = '203.0.113.10';
const CLIENT_B = '198.51.100.20';

/** The global limiter's key for one probe request with the given headers. */
const limiterKeyFor = async (headers) => {
  incrementWithExpiry.mockClear();
  let call = request(app).get('/rate-limit-probe');
  for (const [name, value] of Object.entries(headers)) {
    call = call.set(name, value);
  }
  await call;
  expect(incrementWithExpiry).toHaveBeenCalledTimes(1);
  return incrementWithExpiry.mock.calls[0][0];
};

describe('trust proxy — Railway edge chain (D5 step 0)', () => {
  beforeEach(() => {
    // jest.config resetMocks:true wipes implementations between tests —
    // (re)arm them here, never at module scope (feedback_jest_resetmocks).
    incrementWithExpiry.mockResolvedValue(1);
    getTTL.mockResolvedValue(3600);
  });

  test('app trusts exactly two hops by default (an integer, never true)', () => {
    // `true` would trust the full client-supplied X-Forwarded-For chain,
    // letting an attacker mint unlimited per-IP buckets by spoofing it.
    expect(DEFAULT_TRUST_PROXY_HOPS).toBe(2);
    expect(app.get('trust proxy')).toBe(2);
  });

  test('two clients through the same Railway hop land in separate buckets, keyed on the client', async () => {
    const keyA = await limiterKeyFor({ 'X-Forwarded-For': `${CLIENT_A}, ${HOP_A}` });
    const keyB = await limiterKeyFor({ 'X-Forwarded-For': `${CLIENT_B}, ${HOP_A}` });

    expect(keyA).toContain(`ratelimit:ip:${CLIENT_A}:`);
    expect(keyB).toContain(`ratelimit:ip:${CLIENT_B}:`);
    // The hop is nobody's key — with one trusted hop both were `HOP_A`.
    expect(keyA).not.toContain(HOP_A);
    expect(keyA).not.toBe(keyB);
  });

  test('one client through different Railway hops stays in one bucket', async () => {
    const viaA = await limiterKeyFor({ 'X-Forwarded-For': `${CLIENT_A}, ${HOP_A}` });
    const viaB = await limiterKeyFor({ 'X-Forwarded-For': `${CLIENT_A}, ${HOP_B}` });

    expect(viaA).toBe(viaB);
    expect(viaA).toContain(`ratelimit:ip:${CLIENT_A}:`);
  });

  test.each([
    ['one forged entry', '10.99.99.99'],
    ['two forged entries', '198.51.100.23, 203.0.113.61'],
    ['three forged entries', '203.0.113.64, 198.51.100.24, 203.0.113.65'],
  ])('%s ahead of the edge chain never becomes the key', async (_label, forged) => {
    // Were the edge to keep what the client sent and append its own two
    // entries, the forged head must still lose to the client the edge wrote.
    const key = await limiterKeyFor({
      'X-Forwarded-For': `${forged}, ${CLIENT_A}, ${HOP_A}`,
    });

    expect(key).toContain(`ratelimit:ip:${CLIENT_A}:`);
    for (const entry of forged.split(', ')) {
      expect(key).not.toContain(entry);
    }
  });

  test('a lone entry is taken as the client — what the edge never sends, pinned so a change is seen', async () => {
    const key = await limiterKeyFor({ 'X-Forwarded-For': CLIENT_A });

    expect(key).toContain(`ratelimit:ip:${CLIENT_A}:`);
  });

  // A guard for future code, not proof about the edge: Express never reads
  // X-Real-IP, so this passes under any hop count. It fails the day someone
  // keys on the header without the edge having been probed for it.
  test('X-Real-IP is not a key source', async () => {
    const plain = await limiterKeyFor({});
    const withRealIp = await limiterKeyFor({ 'X-Real-IP': '203.0.113.7' });

    expect(withRealIp).toBe(plain);
    expect(withRealIp).not.toContain('203.0.113.7');
  });
});

describe('resolveTrustProxyHops', () => {
  test.each([
    [undefined, 2],
    ['', 2],
    ['   ', 2],
    ['1', 1],
    ['2', 2],
    [' 3 ', 3],
  ])('%p → %p hops, no warning', (raw, hops) => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: raw })).toEqual({ hops, warning: null });
  });

  test('no env object → the default', () => {
    expect(resolveTrustProxyHops()).toEqual({ hops: 2, warning: null });
  });

  test.each(['0', '4', '10', 'true', '2.0', '-1', '1e0', 'two', '1;', '"1"'])(
    '%p → one hop with a warning: a botched rollback still lands on the unforgeable rule',
    (raw) => {
      const { hops, warning } = resolveTrustProxyHops({ TRUST_PROXY_HOPS: raw });
      expect(FALLBACK_TRUST_PROXY_HOPS).toBe(1);
      expect(hops).toBe(1);
      expect(warning).toContain('TRUST_PROXY_HOPS');
      expect(warning).toContain(raw);
    },
  );
});

describe('TRUST_PROXY_HOPS reaches the app — the rollback lever', () => {
  const saved = process.env.TRUST_PROXY_HOPS;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TRUST_PROXY_HOPS;
    } else {
      process.env.TRUST_PROXY_HOPS = saved;
    }
  });

  test.each([
    ['1', 1],
    ['true', 1],
    ['3', 3],
  ])('TRUST_PROXY_HOPS=%p → trust proxy %p in the app itself', async (raw, hops) => {
    process.env.TRUST_PROXY_HOPS = raw;
    jest.resetModules();
    jest.unstable_mockModule('../../config/redis.js', redisMock);
    const { default: reloaded } = await import('../../server.js');

    expect(reloaded.get('trust proxy')).toBe(hops);
  });
});
