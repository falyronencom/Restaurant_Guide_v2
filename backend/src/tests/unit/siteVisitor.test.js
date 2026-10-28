/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * The site's visitor across the trust boundary (registry v4.35, v4.44;
 * directive D5, 25.10.2026) — through the REAL app exported by server.js, not
 * a forged req: the limiters count by middleware/siteVisitor.js and
 * rateLimiter.requesterOf.
 *
 * Redis is a counting stand-in: incrementWithExpiry keeps real counts per key,
 * so a limiter refuses exactly as it would in production, and the keys show
 * whom each request was counted against.
 */
import { jest } from '@jest/globals';

const counts = new Map();
const incrementWithExpiry = jest.fn();
const getTTL = jest.fn();

jest.unstable_mockModule('../../config/redis.js', () => ({
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  incrementWithExpiry,
  decrement: jest.fn(),
  getCounter: jest.fn(),
  getTTL,
  setWithExpiry: jest.fn(),
  deleteKey: jest.fn(),
  withRedisDeadline: (command) => command,
  default: { isReady: false },
}));

const { default: app } = await import('../../server.js');
const { default: request } = await import('supertest');
const { resetSiteRequestTallies, siteRequestTallies, MIN_SECRET_LENGTH } = await import('../../middleware/siteVisitor.js');
const { generateAccessToken } = await import('../../utils/jwt.js');

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH + 11);
const OLD_SECRET = 'b'.repeat(MIN_SECRET_LENGTH);
// The site's own address as the edge passes it: [site, Railway hop].
const SITE_CHAIN = '198.51.100.200, 152.233.10.1';
const VISITOR_A = '203.0.113.10';
const VISITOR_B = '203.0.113.11';

const ROUTES = {
  global: { method: 'get', path: '/rate-limit-probe', prefix: 'ratelimit:' },
  login: { method: 'post', path: '/api/v1/auth/login', prefix: 'ratelimit:login:' },
  refresh: { method: 'post', path: '/api/v1/auth/refresh', prefix: 'ratelimit:refresh:' },
  smart: { method: 'post', path: '/api/v1/search/smart', prefix: 'ratelimit:smart_search:' },
};

const send = (route, headers = {}) => {
  let call = request(app)[route.method](route.path).set('X-Forwarded-For', SITE_CHAIN);
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
  return route.method === 'post' ? call.send({}) : call;
};

/** The keys the request was counted under: the global limiter's, then the route's. */
const keysOf = async (route, headers) => {
  incrementWithExpiry.mockClear();
  await send(route, headers);
  return incrementWithExpiry.mock.calls.map(([key]) => key);
};

/** The route limiter's key (or the global one for the probe). */
const routeKey = async (route, headers) => {
  const keys = await keysOf(route, headers);
  return route === ROUTES.global ? keys[0] : keys.find((key) => key.startsWith(route.prefix));
};

const siteHeaders = (visitor, secret = SECRET) => ({
  'X-Site-Secret': secret,
  ...(visitor === undefined ? {} : { 'X-Site-Visitor': visitor }),
});

const saved = {};
beforeEach(() => {
  saved.SITE_REQUEST_SECRET = process.env.SITE_REQUEST_SECRET;
  saved.SITE_REQUEST_SECRET_PREVIOUS = process.env.SITE_REQUEST_SECRET_PREVIOUS;
  process.env.SITE_REQUEST_SECRET = SECRET;
  process.env.SITE_REQUEST_SECRET_PREVIOUS = '';
  counts.clear();
  // jest.config resetMocks:true wipes implementations — re-arm them here.
  incrementWithExpiry.mockImplementation(async (key, _ttl, amount = 1) => {
    const next = (counts.get(key) ?? 0) + amount;
    counts.set(key, next);
    return next;
  });
  getTTL.mockResolvedValue(60);
  resetSiteRequestTallies();
});

afterEach(() => {
  process.env.SITE_REQUEST_SECRET = saved.SITE_REQUEST_SECRET;
  process.env.SITE_REQUEST_SECRET_PREVIOUS = saved.SITE_REQUEST_SECRET_PREVIOUS;
});

describe.each(Object.entries(ROUTES))('%s limiter', (name, route) => {
  test('with the secret — counted against the visitor the site names', async () => {
    const key = await routeKey(route, siteHeaders(VISITOR_A));
    expect(key).toContain(`:${VISITOR_A}:`);
    expect(key).not.toContain('198.51.100.200');
  });

  test.each([
    ['without a secret', { 'X-Site-Visitor': VISITOR_A }],
    ['with a wrong secret', siteHeaders(VISITOR_A, 'c'.repeat(MIN_SECRET_LENGTH + 11))],
    ['with an empty secret', siteHeaders(VISITOR_A, '')],
    ['with the secret one character short', siteHeaders(VISITOR_A, SECRET.slice(0, -1))],
  ])('a forged visitor %s changes nothing — the key of a request without the headers', async (_label, headers) => {
    const plain = await routeKey(route, {});
    const forged = await routeKey(route, headers);
    expect(forged).toBe(plain);
    expect(forged).toContain(':198.51.100.200:');
  });

  test('no headers at all (mobile, admin-web) — counted by the address it came from', async () => {
    const key = await routeKey(route, {});
    expect(key).toContain(':198.51.100.200:');
  });
});

describe('the global limiter', () => {
  test('the site without a visitor (pre-rendering, sitemap) — its own tier and key', async () => {
    const [key] = await keysOf(ROUTES.global, siteHeaders(undefined));
    expect(key).toMatch(/^ratelimit:site:site:\d+$/);
  });

  test('the site tier is 6000 an hour, not the anonymous 300', async () => {
    const response = await send(ROUTES.global, siteHeaders(undefined));
    expect(response.headers['x-ratelimit-limit']).toBe('6000');
    const visitor = await send(ROUTES.global, siteHeaders(VISITOR_A));
    expect(visitor.headers['x-ratelimit-limit']).toBe('300');
  });

  test.each([
    ['two addresses', `${VISITOR_A}, ${VISITOR_B}`],
    ['not an address', 'example.com'],
    ['an address with a port', `${VISITOR_A}:443`],
    ['a very long value', `${'1'.repeat(70)}`],
  ])('a visitor value that is %s — the site without a visitor', async (_label, value) => {
    const [key] = await keysOf(ROUTES.global, siteHeaders(value));
    expect(key).toMatch(/^ratelimit:site:site:\d+$/);
  });

  test('a signed-in request through the site still counts its account', async () => {
    const token = generateAccessToken({ userId: 'user-42', email: 'a@b.c', role: 'user' });
    const [key] = await keysOf(ROUTES.global, {
      ...siteHeaders(VISITOR_A),
      Authorization: `Bearer ${token}`,
    });
    expect(key).toMatch(/^ratelimit:user:user-42:\d+$/);
  });

  test('a visitor through the site and the same person directly hold one key', async () => {
    const viaSite = await routeKey(ROUTES.global, siteHeaders(VISITOR_A));
    incrementWithExpiry.mockClear();
    await request(app).get('/rate-limit-probe').set('X-Forwarded-For', `${VISITOR_A}, 152.233.10.1`);
    const direct = incrementWithExpiry.mock.calls[0][0];
    expect(direct).toBe(viaSite);
  });

  test('an IPv4 written as IPv6 is the same key; an IPv6 counts by its /64', async () => {
    const mapped = await routeKey(ROUTES.global, siteHeaders(`::ffff:${VISITOR_A}`));
    expect(mapped).toContain(`:${VISITOR_A}:`);
    const one = await routeKey(ROUTES.global, siteHeaders('2001:db8:1:2::1'));
    const other = await routeKey(ROUTES.global, siteHeaders('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    const nextNet = await routeKey(ROUTES.global, siteHeaders('2001:db8:1:3::1'));
    expect(one).toBe(other);
    expect(one).toContain(':2001:db8:1:2::/64:');
    expect(nextNet).not.toBe(one);
  });

  test('a direct client over IPv6 counts by its /64 too — one person, one key', async () => {
    const direct = async (address) => {
      incrementWithExpiry.mockClear();
      await request(app).get('/rate-limit-probe').set('X-Forwarded-For', `${address}, 152.233.10.1`);
      return incrementWithExpiry.mock.calls[0][0];
    };
    const one = await direct('2001:db8:aa:bb::1');
    const other = await direct('2001:db8:aa:bb:1234:5678:9abc:def0');
    expect(one).toBe(other);
    expect(one).toMatch(/^ratelimit:ip:2001:db8:aa:bb::\/64:\d+$/);
    expect(await direct('2001:db8:aa:bc::1')).not.toBe(one);
  });

  test('the previous secret is accepted while it is being changed', async () => {
    process.env.SITE_REQUEST_SECRET_PREVIOUS = OLD_SECRET;
    const key = await routeKey(ROUTES.global, siteHeaders(VISITOR_B, OLD_SECRET));
    expect(key).toContain(`:${VISITOR_B}:`);
  });

  test('a secret on the server shorter than the minimum is no secret — the matching header is refused', async () => {
    const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
    process.env.SITE_REQUEST_SECRET = short;
    const key = await routeKey(ROUTES.global, siteHeaders(VISITOR_A, short));
    expect(key).toContain(':198.51.100.200:');
  });

  test('no secret on the server — an empty header does not match an empty secret', async () => {
    process.env.SITE_REQUEST_SECRET = '';
    const key = await routeKey(ROUTES.global, siteHeaders(VISITOR_A, ''));
    expect(key).toContain(':198.51.100.200:');
  });

  test('a wrong secret gets the same answer as no secret: status and limit headers', async () => {
    const plain = await send(ROUTES.global, {});
    const wrong = await send(ROUTES.global, siteHeaders(VISITOR_A, 'z'.repeat(MIN_SECRET_LENGTH + 11)));
    expect(wrong.status).toBe(plain.status);
    expect(wrong.headers['x-ratelimit-limit']).toBe(plain.headers['x-ratelimit-limit']);
  });

  test('the tallies count accepted, without a visitor and refused', async () => {
    await send(ROUTES.global, siteHeaders(VISITOR_A));
    await send(ROUTES.global, siteHeaders(undefined));
    await send(ROUTES.global, siteHeaders(VISITOR_A, 'w'.repeat(MIN_SECRET_LENGTH)));
    await send(ROUTES.global, { 'X-Site-Visitor': VISITOR_A });
    expect(siteRequestTallies()).toMatchObject({ accepted: 1, without_visitor: 1, rejected_secret: 1 });
  });

  test('a visitor named but unreadable is counted apart from «no visitor»', async () => {
    await send(ROUTES.global, siteHeaders('example.com'));
    await send(ROUTES.global, siteHeaders(undefined));
    expect(siteRequestTallies()).toMatchObject({ visitor_unusable: 1, without_visitor: 1, accepted: 0 });
  });

  test('a repeated header (Node joins repeats with «, ») — no secret match, no visitor', async () => {
    const plain = await routeKey(ROUTES.global, {});
    incrementWithExpiry.mockClear();
    await request(app).get('/rate-limit-probe')
      .set('X-Forwarded-For', SITE_CHAIN)
      .set('X-Site-Secret', [SECRET, SECRET])
      .set('X-Site-Visitor', VISITOR_A);
    expect(incrementWithExpiry.mock.calls[0][0]).toBe(plain);

    incrementWithExpiry.mockClear();
    await request(app).get('/rate-limit-probe')
      .set('X-Forwarded-For', SITE_CHAIN)
      .set('X-Site-Secret', SECRET)
      .set('X-Site-Visitor', [VISITOR_A, VISITOR_B]);
    expect(incrementWithExpiry.mock.calls[0][0]).toMatch(/^ratelimit:site:site:\d+$/);
  });
});

describe('v4.44 — visitors of the site do not share the sign-in limit', () => {
  test('ten wrong attempts by one visitor refuse that visitor, not another one behind the same site', async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await send(ROUTES.login, siteHeaders(VISITOR_A));
      expect(response.status).not.toBe(429);
    }
    const eleventh = await send(ROUTES.login, siteHeaders(VISITOR_A));
    expect(eleventh.status).toBe(429);

    const other = await send(ROUTES.login, siteHeaders(VISITOR_B));
    expect(other.status).not.toBe(429);
  });

  test('a genuine token does not open a fresh sign-in budget per account', async () => {
    const tokenOf = (userId) => generateAccessToken({ userId, email: `${userId}@b.c`, role: 'user' });
    const keys = [];
    for (const userId of ['throwaway-1', 'throwaway-2']) {
      keys.push(await routeKey(ROUTES.login, { Authorization: `Bearer ${tokenOf(userId)}` }));
    }
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain(':198.51.100.200:');
  });

  test('sign-in attempts from one address with genuine tokens of different accounts share one budget', async () => {
    const tokenOf = (userId) => generateAccessToken({ userId, email: `${userId}@b.c`, role: 'user' });
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await send(ROUTES.login, { Authorization: `Bearer ${tokenOf(`throwaway-${attempt}`)}` });
      expect(response.status).not.toBe(429);
    }
    const eleventh = await send(ROUTES.login, { Authorization: `Bearer ${tokenOf('throwaway-11')}` });
    expect(eleventh.status).toBe(429);
  });
});

describe('/smart', () => {
  test('a signed-in user counts by account — a genuine token is enough on the public route', async () => {
    const token = generateAccessToken({ userId: 'user-7', email: 'a@b.c', role: 'user' });
    const key = await routeKey(ROUTES.smart, { Authorization: `Bearer ${token}` });
    expect(key).toMatch(/^ratelimit:smart_search:user-7:\d+$/);
  });

  test('a forged token counts by address', async () => {
    const key = await routeKey(ROUTES.smart, { Authorization: 'Bearer not.a.token' });
    expect(key).toContain(':198.51.100.200:');
  });

  test('120 requests a minute', async () => {
    const response = await send(ROUTES.smart, siteHeaders(VISITOR_A));
    expect(response.headers['x-ratelimit-limit']).toBe('120');
  });
});

describe('addressKey', () => {
  test.each([
    ['203.0.113.10', '203.0.113.10'],
    ['::ffff:203.0.113.10', '203.0.113.10'],
    ['::FFFF:203.0.113.10', '203.0.113.10'],
    ['2001:0db8:0000:0001:0000:0000:0000:0001', '2001:db8:0:1::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::198.51.100.1', '64:ff9b:0:0::/64'],
    ['0:0:0:0:0:ffff:203.0.113.10', '203.0.113.10'],
    ['::ffff:cb00:710a', '203.0.113.10'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4::/64'],
    ['example.com', null],
    ['203.0.113.10:443', null],
    ['', null],
    [undefined, null],
    ['1'.repeat(65), null],
  ])('%p → %p', async (value, key) => {
    const { addressKey } = await import('../../utils/clientAddress.js');
    expect(addressKey(value)).toBe(key);
  });
});

describe('what the log keeps', () => {
  test('a site visitor is written as a digest, never by address; an account and a direct client as before', async () => {
    const { loggedRequester } = await import('../../middleware/rateLimiter.js');
    const visitor = loggedRequester({ tier: 'ip', identifier: VISITOR_A, viaSite: true });
    expect(visitor).toMatch(/^site-visitor:[0-9a-f]{12}$/);
    expect(visitor).not.toContain(VISITOR_A);
    expect(loggedRequester({ tier: 'ip', identifier: VISITOR_B, viaSite: true })).not.toBe(visitor);
    expect(loggedRequester({ tier: 'ip', identifier: '198.51.100.200' })).toBe('198.51.100.200');
    expect(loggedRequester({ tier: 'user', identifier: 'user-1' })).toBe('user-1');
  });
});

describe('what the request keeps', () => {
  test('req.ip stays the address the request came from; both headers are gone after the check', async () => {
    const { siteVisitor } = await import('../../middleware/siteVisitor.js');
    const req = {
      ip: '198.51.100.200',
      headers: { 'x-site-secret': SECRET, 'x-site-visitor': VISITOR_A },
    };
    siteVisitor(req, {}, () => {});
    expect(req.ip).toBe('198.51.100.200');
    expect(req.siteRequest).toEqual({ visitorKey: VISITOR_A });
    expect(req.headers).toEqual({});
  });
});
