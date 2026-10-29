/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * The `model_key` block of GET /api/v1/search/health
 * (services/openRouterKeyStatus.js, directive D8 of 28.10.2026).
 *
 * The server asks OpenRouter about its own key (GET /key) and answers shares
 * only: the endpoint is public. A failure is `unknown` with a code, never 0;
 * OpenRouter is asked at most once per 10 minutes (a failure — per minute),
 * one request at a time, and the endpoint never waits longer than 3 s.
 * The answers below are the shape of OpenRouter's docs (api-reference/limits,
 * read 28.10.2026): the server's key of 28.10 — $5, ≈ $0.003 spent, no reset.
 * fetch is passed as an argument: no network.
 */

import { jest } from '@jest/globals';

const {
  CACHE_MS,
  FAILURE_CACHE_MS,
  WAIT_MS,
  blockFromAnswer,
  getKeyHealth,
  readKeyBlock,
  resetKeyHealthState,
} = await import('../../services/openRouterKeyStatus.js');

const NOW = new Date('2026-10-30T02:17:00Z');
const KEY = 'sk-or-v1-test-key-6da';

const keyAnswer = (data) => ({ data: { label: 'sk-or-v1-abc...6da', usage: 0.003, is_free_tier: false, ...data } });
const SERVER_KEY_28_10 = keyAnswer({ limit: 5, limit_remaining: 4.997, limit_reset: null });
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let savedKey;
let savedBase;
beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY;
  savedBase = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_API_KEY = KEY;
  delete process.env.OPENROUTER_BASE_URL;
  resetKeyHealthState();
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  if (savedBase === undefined) delete process.env.OPENROUTER_BASE_URL;
  else process.env.OPENROUTER_BASE_URL = savedBase;
  resetKeyHealthState();
});

describe('blockFromAnswer — shares only, never money', () => {
  test('the server\'s key of 28.10: 99 % left (down to a whole percent), no reset', () => {
    const block = blockFromAnswer(SERVER_KEY_28_10, NOW);
    expect(block).toEqual({
      status: 'ok',
      remaining_percent: 99,
      limit_reset: null,
      checked_at: '2026-10-30T02:17:00.000Z',
      unknown_reason: null,
    });
    // Nothing of the answer's money or label goes out.
    expect(JSON.stringify(block)).not.toMatch(/4\.997|0\.003|6da|"limit"|usage/);
  });

  test.each([
    [1.5, 5, 30],
    [1.4999, 5, 29],
    [5, 5, 100],
    [0, 5, 0],
    [-0.2, 5, 0],
    [6, 5, 100],
    [0.29, 1, 29], // 0.29 / 1 * 100 = 28.999… in floating point: still 29
  ])('limit_remaining %p of %p → %p %%', (remaining, limit, percent) => {
    expect(blockFromAnswer(keyAnswer({ limit, limit_remaining: remaining, limit_reset: 'monthly' }), NOW))
      .toMatchObject({ status: 'ok', remaining_percent: percent, limit_reset: 'monthly' });
  });

  test('no limit → unlimited, no percent', () => {
    expect(blockFromAnswer(keyAnswer({ limit: null, limit_remaining: null, limit_reset: null }), NOW))
      .toEqual({ status: 'unlimited', remaining_percent: null, limit_reset: null, checked_at: NOW.toISOString(), unknown_reason: null });
  });

  test('a reset word goes out; anything else is «other», not the provider\'s text', () => {
    expect(blockFromAnswer(keyAnswer({ limit: 5, limit_remaining: 5, limit_reset: 'weekly' }), NOW).limit_reset).toBe('weekly');
    expect(blockFromAnswer(keyAnswer({ limit: 5, limit_remaining: 5, limit_reset: 'Every 30 days <b>' }), NOW).limit_reset).toBe('other');
  });

  test.each([
    ['no data', {}],
    ['data not an object', { data: 'x' }],
    ['limit a string', keyAnswer({ limit: '5', limit_remaining: 5 })],
    ['limit 0', keyAnswer({ limit: 0, limit_remaining: 0 })],
    ['limit missing', keyAnswer({ limit_remaining: 5 })],
    ['limit_remaining missing', keyAnswer({ limit: 5 })],
    ['limit_remaining null with a limit', keyAnswer({ limit: 5, limit_remaining: null })],
    ['limit_reset a number', keyAnswer({ limit: 5, limit_remaining: 5, limit_reset: 30 })],
  ])('%s → unknown bad_answer, not 0', (_label, body) => {
    expect(blockFromAnswer(body, NOW)).toEqual({
      status: 'unknown', remaining_percent: null, limit_reset: null, checked_at: null, unknown_reason: 'bad_answer',
    });
  });
});

describe('readKeyBlock — the server\'s own key, the provider\'s failure as a code', () => {
  test('GET <base>/key, the key in the header, not in the address', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, SERVER_KEY_28_10));
    const block = await readKeyBlock({ fetchImpl, now: () => NOW });

    expect(block.remaining_percent).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect(url).not.toContain(KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeDefined();
  });

  test('no key → no_key, OpenRouter not asked', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchImpl = jest.fn();
    expect(await readKeyBlock({ fetchImpl })).toMatchObject({ status: 'unknown', unknown_reason: 'no_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    ['401 — the key disabled or deleted', async () => jsonResponse(401, { error: { message: 'User not found.' } }), 'http_401'],
    ['500', async () => jsonResponse(500, {}), 'http_500'],
    ['a body that is not JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }), 'bad_answer'],
    ['a timeout', async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }, 'timeout'],
    ['the network', async () => { throw new TypeError('fetch failed'); }, 'network'],
  ])('%s → unknown %s, never an exception', async (_label, fetchImpl, reason) => {
    expect(await readKeyBlock({ fetchImpl })).toEqual({
      status: 'unknown', remaining_percent: null, limit_reset: null, checked_at: null, unknown_reason: reason,
    });
  });
});

describe('getKeyHealth — once per 10 minutes, one request at a time, no long wait', () => {
  const clock = (start = NOW.getTime()) => {
    let t = start;
    return { now: () => new Date(t), advance: (ms) => { t += ms; } };
  };

  test('a read answer stands 10 minutes, then OpenRouter is asked again', async () => {
    const c = clock();
    const fetchImpl = jest.fn(async () => jsonResponse(200, SERVER_KEY_28_10));
    expect((await getKeyHealth({ fetchImpl, now: c.now })).remaining_percent).toBe(99);
    c.advance(CACHE_MS - 1);
    await getKeyHealth({ fetchImpl, now: c.now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    c.advance(1);
    await getKeyHealth({ fetchImpl, now: c.now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('a failure stands a minute, not ten', async () => {
    const c = clock();
    const fetchImpl = jest.fn(async () => jsonResponse(503, {}));
    expect((await getKeyHealth({ fetchImpl, now: c.now })).unknown_reason).toBe('http_503');
    c.advance(FAILURE_CACHE_MS - 1);
    await getKeyHealth({ fetchImpl, now: c.now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    c.advance(1);
    fetchImpl.mockImplementation(async () => jsonResponse(200, SERVER_KEY_28_10));
    expect((await getKeyHealth({ fetchImpl, now: c.now })).status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('many requests at once — one call to OpenRouter', async () => {
    let answer;
    const fetchImpl = jest.fn(() => new Promise((resolve) => { answer = resolve; }));
    const pending = Array.from({ length: 20 }, () => getKeyHealth({ fetchImpl, now: () => NOW, waitMs: 1000 }));
    await Promise.resolve();
    answer(jsonResponse(200, SERVER_KEY_28_10));
    const blocks = await Promise.all(pending);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(blocks.every((b) => b.remaining_percent === 99)).toBe(true);
  });

  test('OpenRouter slower than the wait: «checking» first, the late answer serves the next request', async () => {
    let answer;
    const fetchImpl = jest.fn(() => new Promise((resolve) => { answer = resolve; }));
    const started = Date.now();
    const first = await getKeyHealth({ fetchImpl, now: () => NOW, waitMs: 20 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(first).toMatchObject({ status: 'unknown', unknown_reason: 'checking' });

    answer(jsonResponse(200, SERVER_KEY_28_10));
    await new Promise((resolve) => setImmediate(resolve));
    expect((await getKeyHealth({ fetchImpl, now: () => NOW, waitMs: 20 })).remaining_percent).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('a stale block is answered while its refresh is slow', async () => {
    const c = clock();
    const fetchImpl = jest.fn(async () => jsonResponse(200, SERVER_KEY_28_10));
    await getKeyHealth({ fetchImpl, now: c.now });
    c.advance(CACHE_MS);
    fetchImpl.mockImplementation(() => new Promise(() => {}));
    const block = await getKeyHealth({ fetchImpl, now: c.now, waitMs: 20 });
    expect(block).toMatchObject({ status: 'ok', remaining_percent: 99, checked_at: NOW.toISOString() });
  });

  test('the wait is 3 s by default', () => {
    expect(WAIT_MS).toBe(3000);
    expect(CACHE_MS).toBe(600000);
    expect(FAILURE_CACHE_MS).toBe(60000);
  });
});
