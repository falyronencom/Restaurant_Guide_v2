/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * The global limiter counts a signed-in request against its account and any
 * other request against its address (middleware/rateLimiter.js, 16.10.2026).
 *
 * server.js mounts it ahead of every route, so before any route's authenticate.
 * Until 16.10.2026 it read req.user, which is never set there, and counted
 * every request by address: the signed-in tier never ran, and people behind
 * one address — a household, an office, a mobile carrier's NAT — shared one
 * budget with every open app polling its notifications. The notification
 * routes had the same flaw in their own limiters, which stood before
 * authenticate.
 *
 * Through the real app with a real Redis; tokens presented exactly as clients
 * send them (Authorization: Bearer). Small limits, so that a budget runs out in
 * a few requests; every test starts at the start of a bucket of both tiers, so
 * none crosses a bucket boundary halfway — the one about the bucket's end
 * starts 9.5 s before it.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import redisClient, { connectRedis } from '../../config/redis.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

// Read once, when middleware/rateLimiter.js loads — so before the app does.
process.env.RATE_LIMIT_AUTHENTICATED = '3';
process.env.RATE_LIMIT_WINDOW_AUTHENTICATED = '60';
process.env.RATE_LIMIT_UNAUTHENTICATED = '5';
process.env.RATE_LIMIT_WINDOW_UNAUTHENTICATED = '3600';
const { default: app } = await import('../../server.js');
const { default: notificationRouter } = await import('../../routes/v1/notificationRoutes.js');
const { authenticate } = await import('../../middleware/auth.js');

// What the app shows on a 429 (decision of the Coordinator, 15.10.2026).
const RATE_LIMIT_TEXT = 'Слишком много запросов. Попробуйте позже.';

const realNow = Date.now;

/**
 * From here on Date.now runs as usual, but from `offsetMs` past the start of
 * the current UTC hour. Every bucket of both tiers (60 s and 3600 s) starts on
 * a UTC minute, so 500 ms puts a test at the start of a bucket of each.
 *
 * @returns {number} The start of that hour, ms since the epoch
 */
const startClockAt = (offsetMs) => {
  const realStart = realNow.call(Date);
  const hourStart = Math.floor(realStart / 3600000) * 3600000;
  const origin = hourStart + offsetMs;
  jest.spyOn(Date, 'now').mockImplementation(() => origin + (realNow.call(Date) - realStart));
  return hourStart;
};

const newAccount = () => createUserAndGetTokens({
  email: `limit-${randomUUID()}@test.com`,
  phone: null,
  password: 'User123!@#',
  name: 'Проверка лимита',
  role: 'user',
  authMethod: 'email',
});

/** A signed-in request with no route limiter of its own: only the global one answers. */
const me = (account) => request(app)
  .get('/api/v1/auth/me')
  .set('Authorization', `Bearer ${account.accessToken}`);

const meWith = (authorization) => request(app)
  .get('/api/v1/auth/me')
  .set('Authorization', authorization);

const anonymousMe = () => request(app).get('/api/v1/auth/me');

const limitOf = (response) => ({
  status: response.status,
  limit: response.headers['x-ratelimit-limit'],
  remaining: response.headers['x-ratelimit-remaining'],
});

const sweepRateLimitKeys = async () => {
  const keys = await redisClient.keys('ratelimit:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required for rate limit tests');
    }
  }
  await clearAllData();
});

beforeEach(async () => {
  startClockAt(500);
  await sweepRateLimitKeys();
});

afterAll(async () => {
  await sweepRateLimitKeys();
  await clearAllData();
});

describe('global limiter: a signed-in request spends its account budget', () => {
  test('a signed-in account is held to its own budget; the address budget stays whole', async () => {
    const account = await newAccount();

    const allowed = [];
    for (let i = 0; i < 3; i += 1) {
      allowed.push(limitOf(await me(account)));
    }
    expect(allowed).toEqual([
      { status: 200, limit: '3', remaining: '2' },
      { status: 200, limit: '3', remaining: '1' },
      { status: 200, limit: '3', remaining: '0' },
    ]);

    const refused = await me(account);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({
      success: false,
      message: RATE_LIMIT_TEXT,
      error: { code: 'RATE_LIMIT_EXCEEDED', details: { limit: 3, window: '1 minute' } },
    });

    // An anonymous request from the same address: its budget is untouched.
    expect(limitOf(await anonymousMe())).toEqual({ status: 401, limit: '5', remaining: '4' });
  });

  test('two accounts behind one address do not share a counter', async () => {
    const first = await newAccount();
    const second = await newAccount();

    for (let i = 0; i < 3; i += 1) {
      expect((await me(first)).status).toBe(200);
    }
    expect((await me(first)).status).toBe(429);

    expect(limitOf(await me(second))).toEqual({ status: 200, limit: '3', remaining: '2' });
    expect(limitOf(await me(second))).toEqual({ status: 200, limit: '3', remaining: '1' });
  });

  test('a counter expires when its bucket ends: X-RateLimit-Reset names the top of the hour for both tiers', async () => {
    // 9.5 s before the next hour, when the minute's bucket and the hour's both end.
    const hourStart = startClockAt(3600000 - 9500);
    const bucketEnd = (hourStart + 3600000) / 1000;
    const account = await newAccount();

    const signedIn = await me(account);
    const anonymous = await anonymousMe();

    expect([signedIn.status, anonymous.status]).toEqual([200, 401]);
    // Redis counts a key's time to live in whole seconds: the end, or a second short of it.
    expect([bucketEnd - 1, bucketEnd]).toContain(Number(signedIn.headers['x-ratelimit-reset']));
    expect([bucketEnd - 1, bucketEnd]).toContain(Number(anonymous.headers['x-ratelimit-reset']));
  });
});

describe('global limiter: a token that does not verify is counted by address', () => {
  test('forged, unsigned, expired, other-type and garbage tokens spend the address budget and open no fresh one', async () => {
    const victim = await newAccount();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const claims = {
      userId: victim.user.id,
      email: victim.user.email,
      role: 'user',
      type: 'access',
    };
    const signOptions = { issuer: 'restaurant-guide-belarus', audience: 'restaurant-guide-api' };
    const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

    const notGenuine = [
      ['signed with another key', jwt.sign(claims, 'k'.repeat(48), { ...signOptions, expiresIn: '4h' })],
      ['unsigned (alg none)', `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
        ...claims, iss: signOptions.issuer, aud: signOptions.audience, iat: nowSeconds, exp: nowSeconds + 3600,
      })}.`],
      ['expired', jwt.sign(
        { ...claims, iat: nowSeconds - 4 * 3600 - 60, exp: nowSeconds - 60 },
        process.env.JWT_SECRET,
        signOptions,
      )],
      ['not an access token', jwt.sign(
        { ...claims, type: 'refresh' },
        process.env.JWT_SECRET,
        { ...signOptions, expiresIn: '4h' },
      )],
      ['not a token at all', 'not-a-token'],
    ];

    const seen = [];
    for (const [label, token] of notGenuine) {
      seen.push({ label, ...limitOf(await meWith(`Bearer ${token}`)) });
    }
    // Each one refused by authenticate (fixture guard: none of them is genuine),
    // each counted against the address.
    expect(seen).toEqual([
      { label: 'signed with another key', status: 401, limit: '5', remaining: '4' },
      { label: 'unsigned (alg none)', status: 401, limit: '5', remaining: '3' },
      { label: 'expired', status: 401, limit: '5', remaining: '2' },
      { label: 'not an access token', status: 401, limit: '5', remaining: '1' },
      { label: 'not a token at all', status: 401, limit: '5', remaining: '0' },
    ]);

    // The address budget is spent: a token that does not verify gets no fresh one.
    const refused = await meWith(`Bearer ${notGenuine[0][1]}`);
    expect(refused.status).toBe(429);
    expect(refused.body.error.details).toMatchObject({ limit: 5, window: '1 hour' });

    // The account those tokens named was never charged.
    expect(limitOf(await me(victim))).toEqual({ status: 200, limit: '3', remaining: '2' });
  });
});

describe('notification limiters count the signed-in account', () => {
  test('one account\'s polling and marking read do not spend another account\'s budgets at the same address', async () => {
    const first = await newAccount();
    const second = await newAccount();
    const unreadCount = (account) => request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${account.accessToken}`);
    const readAll = (account) => request(app)
      .put('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${account.accessToken}`);

    expect((await unreadCount(first)).status).toBe(200);
    expect((await readAll(first)).status).toBe(200);

    // The route limiter answers last, so its numbers are the ones in the headers.
    expect(limitOf(await unreadCount(second))).toEqual({ status: 200, limit: '100', remaining: '99' });
    expect(limitOf(await readAll(second))).toEqual({ status: 200, limit: '50', remaining: '49' });
  });

  test('every notification route starts with authenticate, so its limiter sees the account', () => {
    const routes = notificationRouter.stack.filter((layer) => layer.route);
    const name = ({ route }) => `${Object.keys(route.methods)[0].toUpperCase()} ${route.path}`;

    // Fixture guard: all eight routes of the router are here.
    expect(routes.map(name)).toEqual([
      'GET /',
      'GET /unread-count',
      'GET /preferences',
      'PUT /read-all',
      'PUT /device-token',
      'PUT /preferences',
      'DELETE /device-token',
      'PUT /:id/read',
    ]);
    expect(routes.filter(({ route }) => route.stack[0].handle !== authenticate).map(name)).toEqual([]);
  });
});
