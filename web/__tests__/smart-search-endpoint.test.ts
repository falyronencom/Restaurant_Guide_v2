/**
 * smartSearch — the wire call itself, through the REAL serverFetch with a
 * mocked global fetch (same seam as api-client-transport.test.ts).
 *
 * Pinned: POST to /api/v1/search/smart with a JSON body; the body carries no
 * key for an untouched filter (JSON.stringify drops undefined — the whole
 * mechanism behind «absent, not a default» in SmartSearchBody); the call stays
 * anonymous (no Authorization — the public transport never adds one); the
 * success envelope is unwrapped to the data payload the pages render; and the
 * call outlasts a cold AI start (the backend budgets its parse 20 s), where the
 * transport's default 10 s would show «Ничего не найдено» for «терраса».
 */
import { smartSearch } from '@/lib/api/endpoints/search';

const originalApiUrl = process.env.API_URL;
const originalFetch = global.fetch;

beforeAll(() => {
  process.env.API_URL = 'http://api.test';
});

afterAll(() => {
  process.env.API_URL = originalApiUrl;
  global.fetch = originalFetch;
});

const DATA = {
  intent: null,
  establishments: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrevious: false },
  fallback: true,
};

function mockFetch() {
  const fetchMock = jest.fn().mockResolvedValue({
    status: 200,
    json: () => Promise.resolve({ success: true, data: DATA }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('smartSearch — wire call', () => {
  it('POSTs JSON to the smart endpoint and unwraps the envelope', async () => {
    const fetchMock = mockFetch();

    const data = await smartSearch({ query: 'терраса', city: 'Минск' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('http://api.test/api/v1/search/smart');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({ query: 'терраса', city: 'Минск' });
    expect(data).toEqual(DATA);
  });

  it('waits out a cold model start: not aborted at the transport’s 10 s, aborted at 25 s', async () => {
    jest.useFakeTimers();
    try {
      // A fetch that never answers on its own — only the abort signal ends it.
      global.fetch = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ) as unknown as typeof fetch;

      let outcome: unknown = 'pending';
      const call = smartSearch({ query: 'терраса', city: 'Минск' }).then(
        () => (outcome = 'resolved'),
        (err) => (outcome = err),
      );

      await jest.advanceTimersByTimeAsync(15_000); // past 10 s, inside the backend's 20 s parse budget
      expect(outcome).toBe('pending');

      await jest.advanceTimersByTimeAsync(10_001); // past 25 s
      await call;
      expect(outcome).toMatchObject({ name: 'ApiError', statusCode: 0 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('an untouched filter never reaches the wire as a key', async () => {
    const fetchMock = mockFetch();

    await smartSearch({ query: 'бургер недорого', city: 'Минск', sort_by: undefined, page: undefined });

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).not.toContain('sort_by');
    expect(body).not.toContain('page');
  });
});
