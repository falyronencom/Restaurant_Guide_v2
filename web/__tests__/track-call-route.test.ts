/**
 * @jest-environment node
 */
/*
 * The site's half of the partner's «Звонки»: the Route Handler a phone tap posts
 * to. Pinned: another site's page cannot drive the counter, a malformed id never
 * reaches the API, the API is asked with the VISITOR's address (its limit on
 * these counters would otherwise treat the whole site as one person) and over
 * POST, and an API failure stays an answer, not a crash.
 */

import { POST } from '@/app/api/establishments/[id]/track-call/route';
import { serverFetch } from '@/lib/api/client';

jest.mock('@/lib/api/client', () => ({
  serverFetch: jest.fn(),
}));

const serverFetchMock = serverFetch as jest.MockedFunction<typeof serverFetch>;

const ID = '11111111-1111-4111-8111-111111111111';
const SAME = { origin: 'http://localhost:3000', host: 'localhost:3000' };
const CROSS = { origin: 'http://evil.example', host: 'localhost:3000' };

function requestWith(headers: Record<string, string>): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Request;
}

const call = (headers: Record<string, string>, id = ID) =>
  POST(requestWith(headers), { params: Promise.resolve({ id }) });

beforeEach(() => {
  serverFetchMock.mockReset();
  serverFetchMock.mockResolvedValue({ message: 'Call event recorded' });
});

describe('POST /api/establishments/:id/track-call', () => {
  it('asks the API over POST and answers 204', async () => {
    const res = await call(SAME);

    expect(res.status).toBe(204);
    expect(serverFetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = serverFetchMock.mock.calls[0];
    expect(path).toBe(`/api/v1/establishments/${ID}/track-call`);
    expect(init?.method).toBe('POST');
  });

  it('names the visitor to the API, by the same rule as every other route', async () => {
    await call({
      ...SAME,
      'x-forwarded-for': '203.0.113.7, 100.64.0.2',
    });

    expect(serverFetchMock.mock.calls[0][2]).toEqual({ visitor: '203.0.113.7' });
  });

  it('refuses another site’s page before anything else', async () => {
    const res = await call(CROSS);

    expect(res.status).toBe(403);
    expect(serverFetchMock).not.toHaveBeenCalled();
  });

  it('refuses a request without Origin — not a browser POST', async () => {
    const res = await call({ host: 'localhost:3000' });

    expect(res.status).toBe(403);
    expect(serverFetchMock).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', '../../admin', `${ID}/../x`, ''])(
    'never takes %p to the API',
    async (id) => {
      const res = await call(SAME, id);

      expect(res.status).toBe(400);
      expect(serverFetchMock).not.toHaveBeenCalled();
    },
  );

  it('an API failure is an answer, not a crash', async () => {
    serverFetchMock.mockRejectedValue(new Error('down'));

    const res = await call(SAME);

    expect(res.status).toBe(502);
  });
});
