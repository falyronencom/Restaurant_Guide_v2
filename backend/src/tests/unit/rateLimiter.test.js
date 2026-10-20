/* eslint-env jest */
/* eslint comma-dangle: 0 */
import { jest } from '@jest/globals';

// Mock Redis helpers before importing middleware
const incrementWithExpiry = jest.fn();
const getTTL = jest.fn();

jest.unstable_mockModule('../../config/redis.js', () => ({
  incrementWithExpiry,
  getTTL,
  default: {},
}));

const {
  createRateLimiter,
  createGlobalRateLimiter,
  rateLimiter,
  resolveRateLimitTiers,
} = await import('../../middleware/rateLimiter.js');
const { generateAccessToken } = await import('../../utils/jwt.js');
const { default: jwt } = await import('jsonwebtoken');

// The app shows a 429's message as is (decision of the Coordinator,
// 15.10.2026): one Russian text for both limiters, a literal here.
const RATE_LIMIT_TEXT = 'Слишком много запросов. Попробуйте позже.';

const buildResponse = () => {
  const res = {};
  res.headers = {};
  res.set = jest.fn((obj) => Object.assign(res.headers, obj));
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('rateLimiter middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows request when under limit', async () => {
    incrementWithExpiry.mockResolvedValueOnce(1);
    getTTL.mockResolvedValueOnce(50);

    const limiter = createRateLimiter({ limit: 5, windowSeconds: 60, keyPrefix: 'test' });
    const req = { ip: '1.1.1.1', method: 'POST', path: '/login' };
    const res = buildResponse();
    let nextCalled = false;

    await limiter(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.headers['X-RateLimit-Remaining']).toBe('4');
  });

  test('blocks request when limit exceeded', async () => {
    incrementWithExpiry.mockResolvedValueOnce(6);
    getTTL.mockResolvedValueOnce(12);

    const limiter = createRateLimiter({ limit: 5, windowSeconds: 60, keyPrefix: 'test' });
    const req = { ip: '9.9.9.9', method: 'POST', path: '/login' };
    const res = buildResponse();
    let nextCalled = false;

    await limiter(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: RATE_LIMIT_TEXT,
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
          details: expect.objectContaining({ limit: 5, window: '60 seconds', retry_after: 12 }),
        }),
      }),
    );
    expect(res.headers['X-RateLimit-Remaining']).toBe('0');
    expect(res.headers['Retry-After']).toBe('12');
  });

  test('under the limit — no Retry-After', async () => {
    incrementWithExpiry.mockResolvedValueOnce(1);
    getTTL.mockResolvedValueOnce(50);

    const limiter = createRateLimiter({ limit: 5, windowSeconds: 60, keyPrefix: 'test' });
    const res = buildResponse();
    await limiter({ ip: '1.1.1.1', method: 'POST', path: '/login' }, res, jest.fn());

    expect(res.headers).not.toHaveProperty('Retry-After');
  });
});

// A route limiter's counter lives until its bucket ends, not a whole window
// from the first request: its time to live is what retry_after and Retry-After
// name. Until 20.10.2026 a day's limit (the menu recognition restart, 86400 s)
// lived 24 h from the first request while the bucket rolled over at 00:00 UTC.
describe('createRateLimiter: the counter expires when its bucket ends', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [86400, '2026-10-20T23:30:00.000Z', 1800],
    [3600, '2026-10-20T14:59:50.000Z', 10],
    [60, '2026-10-20T14:00:00.500Z', 60],
  ])('window %i s at %s — expiry %i s, key of that bucket', async (windowSeconds, at, expiry) => {
    const nowMs = Date.parse(at);
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    incrementWithExpiry.mockResolvedValueOnce(1);
    getTTL.mockResolvedValueOnce(expiry);

    const limiter = createRateLimiter({ limit: 5, windowSeconds, keyPrefix: 'test' });
    await limiter({ ip: '1.1.1.1', method: 'POST', path: '/x' }, buildResponse(), jest.fn());

    expect(incrementWithExpiry).toHaveBeenLastCalledWith(
      `ratelimit:test:1.1.1.1:${Math.floor(nowMs / (windowSeconds * 1000))}`,
      expiry,
    );
  });
});

// Retry-After on a 429: whole seconds above zero only (RFC 9110), as the daily
// allowances set it; Redis answers -1 / -2 for a key with no life left.
describe('Retry-After on a 429, both limiters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const refuse = async (limiter, ttl) => {
    incrementWithExpiry.mockResolvedValueOnce(1000000);
    getTTL.mockResolvedValueOnce(ttl);
    const res = buildResponse();
    await limiter({ ip: '9.9.9.9', method: 'GET', path: '/api/v1/x' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(429);
    return { header: res.headers['Retry-After'], retryAfter: res.json.mock.calls[0][0].error.details.retry_after };
  };

  test.each([
    ['global', () => rateLimiter],
    ['createRateLimiter', () => createRateLimiter({ limit: 5, windowSeconds: 60, keyPrefix: 'test' })],
  ])('%s: the header is the body\'s retry_after; none for -1 and -2', async (_label, limiterOf) => {
    expect(await refuse(limiterOf(), 30)).toEqual({ header: '30', retryAfter: 30 });
    expect(await refuse(limiterOf(), -1)).toEqual({ header: undefined, retryAfter: -1 });
    expect(await refuse(limiterOf(), -2)).toEqual({ header: undefined, retryAfter: -2 });
  });
});

/** A request as a signed-in client sends it: a genuine access token in the header. */
const signedIn = (userId) => ({
  headers: {
    authorization: `Bearer ${generateAccessToken({ userId, email: `${userId}@test.com`, role: 'user' })}`,
  },
});

describe('global rateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // server.js mounts it before any route's authenticate, so req.user is never
  // set there: a signed-in request is told by its token.
  test.each([
    ['an anonymous request, keyed by IP', { ip: '9.9.9.9' }, 'ratelimit:ip:9.9.9.9:', '1 hour'],
    ['a signed-in request, keyed by account', { ip: '9.9.9.9', ...signedIn('u-1') }, 'ratelimit:user:u-1:', '1 minute'],
  ])('over the limit: %s — 429 with the Russian text, the same code', async (_label, who, keyPrefix, window) => {
    incrementWithExpiry.mockResolvedValueOnce(1000000);
    getTTL.mockResolvedValueOnce(30);

    const req = { ...who, method: 'POST', path: '/api/v1/partner/establishments' };
    const res = buildResponse();
    const next = jest.fn();

    await rateLimiter(req, res, next);

    expect(incrementWithExpiry.mock.calls[0][0].startsWith(keyPrefix)).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: RATE_LIMIT_TEXT,
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
          details: expect.objectContaining({ window, retry_after: 30 }),
        }),
      }),
    );
  });

  test.each([
    ['without an account id', {}],
    ['with an empty account id', { userId: '' }],
  ])('a genuine token %s is counted by address', async (_label, account) => {
    const token = jwt.sign({ ...account, email: 'x@test.com', role: 'user', type: 'access' }, process.env.JWT_SECRET, {
      issuer: 'restaurant-guide-belarus',
      audience: 'restaurant-guide-api',
      expiresIn: '4h',
    });
    incrementWithExpiry.mockResolvedValueOnce(1);
    getTTL.mockResolvedValueOnce(30);

    const req = { ip: '9.9.9.9', headers: { authorization: `Bearer ${token}` }, method: 'GET', path: '/api/v1/auth/me' };
    await rateLimiter(req, buildResponse(), jest.fn());

    expect(incrementWithExpiry.mock.calls[0][0].startsWith('ratelimit:ip:9.9.9.9:')).toBe(true);
  });
});

describe('global limiter: the window decides the bucket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * One request at the moment `iso`: the key it was counted under and the
   * expiry its counter got. `who` is called once the clock is set, so a token
   * is issued at that moment, whatever the real clock says.
   */
  const countAt = async (limiter, iso, who) => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));
    incrementWithExpiry.mockResolvedValueOnce(1);
    getTTL.mockResolvedValueOnce(1);
    const before = incrementWithExpiry.mock.calls.length;

    await limiter({ ip: '9.9.9.9', method: 'GET', path: '/api/v1/auth/me', ...who() }, buildResponse(), jest.fn());

    const [key, expirySeconds] = incrementWithExpiry.mock.calls[before];
    return { key, expirySeconds };
  };

  // Buckets are windows laid end to end from the epoch: a bucket's first moment,
  // its last, and the first of the next. The counter of a bucket expires when
  // the bucket ends, whenever the bucket's first request came.
  test.each([
    ['signed in, 60 s', 'user', 60, 'ratelimit:user:u-1:',
      ['2026-10-16T14:35:00.000Z', '2026-10-16T14:35:59.999Z', '2026-10-16T14:36:00.000Z'], [60, 1, 60]],
    ['signed in, 120 s', 'user', 120, 'ratelimit:user:u-1:',
      ['2026-10-16T14:34:00.000Z', '2026-10-16T14:35:59.400Z', '2026-10-16T14:36:00.000Z'], [120, 1, 120]],
    ['by address, 3600 s', 'ip', 3600, 'ratelimit:ip:9.9.9.9:',
      ['2026-10-16T14:00:00.000Z', '2026-10-16T14:59:59.999Z', '2026-10-16T15:00:00.000Z'], [3600, 1, 3600]],
    ['by address, 7200 s', 'ip', 7200, 'ratelimit:ip:9.9.9.9:',
      ['2026-10-16T14:00:00.000Z', '2026-10-16T15:59:59.500Z', '2026-10-16T16:00:00.000Z'], [7200, 1, 7200]],
  ])('%s: one counter from the first to the last moment of a bucket, a new one after; expiry at the bucket end', async (
    _label, tier, windowSeconds, keyPrefix, [first, last, next], expiries,
  ) => {
    const limiter = createGlobalRateLimiter({
      user: { limit: 100, windowSeconds: tier === 'user' ? windowSeconds : 60 },
      ip: { limit: 300, windowSeconds: tier === 'ip' ? windowSeconds : 3600 },
    });
    const who = tier === 'user' ? () => signedIn('u-1') : () => ({});

    const counted = [
      await countAt(limiter, first, who),
      await countAt(limiter, last, who),
      await countAt(limiter, next, who),
    ];

    expect(counted.every(({ key }) => key.startsWith(keyPrefix))).toBe(true);
    expect(counted[1].key).toBe(counted[0].key);
    expect(counted[2].key).not.toBe(counted[0].key);
    expect(counted.map(({ expirySeconds }) => expirySeconds)).toEqual(expiries);
  });

  test.each([
    [60, '1 minute'],
    [3600, '1 hour'],
    [120, '120 seconds'],
  ])('a %i s window is named %p in the 429', async (windowSeconds, name) => {
    const limiter = createGlobalRateLimiter({
      user: { limit: 1, windowSeconds },
      ip: { limit: 1, windowSeconds },
    });
    incrementWithExpiry.mockResolvedValueOnce(2);
    getTTL.mockResolvedValueOnce(5);
    const res = buildResponse();

    await limiter({ ip: '9.9.9.9', method: 'GET', path: '/api/v1/auth/me' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].error.details.window).toBe(name);
  });
});

describe('resolveRateLimitTiers', () => {
  const DEFAULTS = { user: { limit: 100, windowSeconds: 60 }, ip: { limit: 300, windowSeconds: 3600 } };

  test('unset or empty: 100 a minute per account, 300 an hour per address', () => {
    expect(resolveRateLimitTiers({})).toEqual({ tiers: DEFAULTS, warnings: [] });
    expect(resolveRateLimitTiers({
      RATE_LIMIT_AUTHENTICATED: '',
      RATE_LIMIT_WINDOW_AUTHENTICATED: '',
      RATE_LIMIT_UNAUTHENTICATED: '',
      RATE_LIMIT_WINDOW_UNAUTHENTICATED: '',
    })).toEqual({ tiers: DEFAULTS, warnings: [] });
  });

  test('whole numbers above zero are taken as given; a window up to a day, a limit without a ceiling', () => {
    expect(resolveRateLimitTiers({
      RATE_LIMIT_AUTHENTICATED: ' 250 ',
      RATE_LIMIT_WINDOW_AUTHENTICATED: '120',
      RATE_LIMIT_UNAUTHENTICATED: '1000000',
      RATE_LIMIT_WINDOW_UNAUTHENTICATED: '86400',
    })).toEqual({
      tiers: { user: { limit: 250, windowSeconds: 120 }, ip: { limit: 1000000, windowSeconds: 86400 } },
      warnings: [],
    });
  });

  // Read as before 16.10.2026 (the number a value starts with), so a value that
  // worked keeps its meaning — production's anonymous limit included.
  test('the number a value starts with is taken, and a warning names what was dropped', () => {
    expect(resolveRateLimitTiers({
      RATE_LIMIT_AUTHENTICATED: '1.5',
      RATE_LIMIT_WINDOW_AUTHENTICATED: '60s',
      RATE_LIMIT_UNAUTHENTICATED: '3000 # prod',
    })).toEqual({
      tiers: { user: { limit: 1, windowSeconds: 60 }, ip: { limit: 3000, windowSeconds: 3600 } },
      warnings: [
        'RATE_LIMIT_AUTHENTICATED="1.5" is read as 1',
        'RATE_LIMIT_WINDOW_AUTHENTICATED="60s" is read as 60',
        'RATE_LIMIT_UNAUTHENTICATED="3000 # prod" is read as 3000',
      ],
    });
  });

  test('anything else, or a window above a day: the default, and a warning naming the variable', () => {
    expect(resolveRateLimitTiers({
      RATE_LIMIT_AUTHENTICATED: '-5',
      RATE_LIMIT_WINDOW_AUTHENTICATED: '0',
      RATE_LIMIT_UNAUTHENTICATED: 'abc',
      RATE_LIMIT_WINDOW_UNAUTHENTICATED: '3600000',
    })).toEqual({
      tiers: DEFAULTS,
      warnings: [
        'RATE_LIMIT_AUTHENTICATED="-5" is not a whole number above zero; 100 is used',
        'RATE_LIMIT_WINDOW_AUTHENTICATED="0" is not a whole number above zero; 60 is used',
        'RATE_LIMIT_UNAUTHENTICATED="abc" is not a whole number above zero; 300 is used',
        'RATE_LIMIT_WINDOW_UNAUTHENTICATED="3600000" is above 86400; 3600 is used',
      ],
    });
  });
});
