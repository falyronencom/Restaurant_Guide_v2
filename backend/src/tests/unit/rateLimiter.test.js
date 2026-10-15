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

const { createRateLimiter, rateLimiter } = await import('../../middleware/rateLimiter.js');

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
  });
});

describe('global rateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // server.js mounts it before any route's authenticate, so in production
  // req.user is never set and only the IP branch runs; both are held here.
  test.each([
    ['an anonymous request, keyed by IP', { ip: '9.9.9.9' }, 'ratelimit:ip:9.9.9.9:', '1 hour'],
    ['a signed-in request, keyed by account', { ip: '9.9.9.9', user: { userId: 'u-1' } }, 'ratelimit:user:u-1:', '1 minute'],
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
});

