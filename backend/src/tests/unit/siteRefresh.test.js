/* eslint-env jest */
/**
 * services/siteRefresh.js — the server tells the site that its cached
 * establishment pages are out of date (critic 2Г, item 2.04). The request:
 * POST to the site's /api/revalidate/establishments, no body, and in
 * X-Site-Refresh the time and an HMAC-SHA256 of «revalidate-establishments:
 * <time>» under the shared secret — the secret itself never travels (Phase
 * 3.5, lens review). Not configured, not https, a refusal, no answer —
 * a result and a line in the journal, never a throw: the deletion does not
 * depend on the site.
 *
 * Expected values are literals: the site's route as web/ names it, the
 * header the two services use (siteVisitor.js).
 */
import { createHmac } from 'crypto';
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { refreshEstablishmentPages, SITE_REFRESH_TIMEOUT_MS } = await import('../../services/siteRefresh.js');
const logger = (await import('../../utils/logger.js')).default;

const SECRET = 'k'.repeat(43);
const ok = () => jest.fn().mockResolvedValue({ ok: true, status: 204 });

beforeEach(() => {
  jest.clearAllMocks();
});

test('configured — one POST to the site route, a signature of the time in X-Site-Refresh, no secret, no body, bounded in time', async () => {
  const fetchImpl = ok();
  const now = 1_800_000_000_123;

  const result = await refreshEstablishmentPages({
    env: { SITE_URL: 'https://site.example/', SITE_REQUEST_SECRET: SECRET },
    fetchImpl,
    now: () => now,
  });

  expect(result).toBe('refreshed');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(String(url)).toBe('https://site.example/api/revalidate/establishments');
  const expected = createHmac('sha256', SECRET).update(`revalidate-establishments:${now}`).digest('hex');
  expect(init).toMatchObject({ method: 'POST', headers: { 'x-site-refresh': `${now}.${expected}` } });
  expect(Object.keys(init.headers)).toEqual(['x-site-refresh']);
  expect(JSON.stringify(init)).not.toContain(SECRET);
  expect(init.body).toBeUndefined();
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(SITE_REFRESH_TIMEOUT_MS).toBe(3000);
});

test.each([
  ['no SITE_URL', { SITE_REQUEST_SECRET: SECRET }],
  ['no secret', { SITE_URL: 'https://site.example' }],
  ['a secret shorter than 32 characters', { SITE_URL: 'https://site.example', SITE_REQUEST_SECRET: 'k'.repeat(31) }],
  ['SITE_URL not a whole address', { SITE_URL: 'site.example', SITE_REQUEST_SECRET: SECRET }],
  ['SITE_URL over plain http to another host', { SITE_URL: 'http://site.example', SITE_REQUEST_SECRET: SECRET }],
])('%s — not called, «not_configured», a warning', async (_, env) => {
  const fetchImpl = ok();

  expect(await refreshEstablishmentPages({ env, fetchImpl })).toBe('not_configured');
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledTimes(1);
});

test('plain http to this machine — allowed, as for local runs', async () => {
  const fetchImpl = ok();

  expect(await refreshEstablishmentPages({
    env: { SITE_URL: 'http://localhost:3000', SITE_REQUEST_SECRET: SECRET },
    fetchImpl,
  })).toBe('refreshed');
  expect(String(fetchImpl.mock.calls[0][0])).toBe('http://localhost:3000/api/revalidate/establishments');
});

test('the site refuses — «failed», the status in the journal; no throw', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404 });

  expect(await refreshEstablishmentPages({
    env: { SITE_URL: 'https://site.example', SITE_REQUEST_SECRET: SECRET },
    fetchImpl,
  })).toBe('failed');
  expect(logger.warn).toHaveBeenCalledWith('Site pages not refreshed: the site refused', { status: 404 });
});

test('the site does not answer — «failed»; no throw', async () => {
  const fetchImpl = jest.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'));

  expect(await refreshEstablishmentPages({
    env: { SITE_URL: 'https://site.example', SITE_REQUEST_SECRET: SECRET },
    fetchImpl,
  })).toBe('failed');
  expect(logger.warn).toHaveBeenCalledTimes(1);
});
