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

const { createRateLimiter } = await import('../../middleware/rateLimiter.js');

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
        error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
      }),
    );
    expect(res.headers['X-RateLimit-Remaining']).toBe('0');
  });
});

