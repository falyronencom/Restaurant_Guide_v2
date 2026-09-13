/**
 * serverFetch (public transport) regression guard. Uses the REAL serverFetch
 * with a mocked global fetch to pin that the public transport NEVER adds an
 * Authorization header on its own — protecting both Bearer secrecy and the
 * public catalog's anonymous ISR posture (only authedFetch injects auth).
 */
import { serverFetch } from '@/lib/api/client';

const originalApiUrl = process.env.API_URL;
const originalFetch = global.fetch;

beforeAll(() => {
  process.env.API_URL = 'http://api.test';
});

afterAll(() => {
  process.env.API_URL = originalApiUrl;
  global.fetch = originalFetch;
});

describe('serverFetch — public transport stays anonymous', () => {
  it('sends only Accept and never an Authorization header for a public call', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ success: true, data: { ok: 1 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await serverFetch('/api/v1/public/establishments');

    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers.Authorization).toBeUndefined();
  });
});

/**
 * The transport never retries — the second factor of the refresh boundary.
 *
 * A refresh cycle presents the single-use token AT MOST TWICE (session.ts
 * doRefresh). Outside the backend's grace window (REFRESH_REUSE_GRACE_SECONDS,
 * default 60s) a re-presentation is read as theft: 403 TOKEN_REUSE_DETECTED
 * and every session the user has is revoked. So "at most twice" is a hard
 * boundary, not a preference.
 *
 * That boundary is a PRODUCT of two factors, and each needs its own pin:
 *
 *   presentations = (serverFetch calls per cycle) x (fetches per serverFetch)
 *                 =            2                  x          1
 *
 * The left factor is pinned in auth-refresh.test.ts — but those tests mock
 * `@/lib/api/client` wholesale, so the real serverFetch never runs there and
 * their counts say NOTHING about the right factor. The right factor is pinned
 * here, and only here.
 *
 * Why it can drift: a retry ladder in the transport is the natural cure for
 * Railway edge 502s, and both Dart clients already have one. There it had to
 * be taken off the refresh path by an explicit predicate (`1b146bf`) precisely
 * because it MULTIPLIED presentations — a fresh attempt restarts the ladder's
 * counter from zero. Web is safe today only because the ladder does not exist,
 * and absence is the kind of protection that disappears without a sound. These
 * two tests are that sound.
 */
describe('serverFetch — the transport does not retry', () => {
  it('makes exactly one fetch per call when the backend answers 5xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 500,
      json: () =>
        Promise.resolve({
          success: false,
          error: { message: 'upstream is down', statusCode: 500 },
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(serverFetch('/api/v1/auth/refresh')).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one fetch per call when the connection fails', async () => {
    // The other half a ladder would cover: a transport that retries only
    // network failures would sail past the 5xx test above.
    const fetchMock = jest.fn().mockRejectedValue(new Error('socket hang up'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(serverFetch('/api/v1/auth/refresh')).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
