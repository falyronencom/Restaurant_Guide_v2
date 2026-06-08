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
