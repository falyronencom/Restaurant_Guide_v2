/**
 * @jest-environment node
 */
/**
 * Media streaming proxy (lib/partner/media-proxy.ts) — the session side. A
 * consumed upload stream cannot be retried after a 401, so the proxy refreshes
 * the access token up front; what it answers when that refresh fails decides
 * whether the cabinet says «Сессия истекла» or «сервер недоступен».
 */
import { ApiError } from '@/lib/api/types';

const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
};

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockStore)),
}));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { serverFetch } from '@/lib/api/client';
import { proxyMediaUpload } from '@/lib/partner/media-proxy';

const mockServerFetch = serverFetch as jest.Mock;
const upstreamFetch = jest.fn();
const realFetch = global.fetch;

/** An access JWT whose exp has passed — the proxy must refresh before streaming. */
const EXPIRED_ACCESS = [
  'h',
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString(
    'base64url',
  ),
  's',
].join('.');

function cookies(jar: Record<string, string>) {
  mockStore.get.mockImplementation((name: string) =>
    name in jar ? { value: jar[name] } : undefined,
  );
}

function upload(): Request {
  return new Request('http://localhost/api/partner/media', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body: '--x--',
  });
}

async function errorOf(res: Response): Promise<{ code?: string }> {
  const body = (await res.json()) as { error: { code?: string } };
  return body.error;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockServerFetch.mockReset();
  process.env.API_URL = 'http://backend.test';
  global.fetch = upstreamFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('proxyMediaUpload — refreshing the access token', () => {
  it.each([
    ['no access cookie', { rg_rt: 'rt' }],
    ['an expired access cookie', { rg_at: EXPIRED_ACCESS, rg_rt: 'rt' }],
  ])(
    '%s and a refresh that fails transiently: 503 SESSION_REFRESH_UNAVAILABLE, cookies kept',
    async (_label, jar) => {
      cookies(jar);
      mockServerFetch
        .mockRejectedValueOnce(new ApiError(503, 'unavailable')) // refresh
        .mockRejectedValueOnce(new ApiError(0, 'timeout')); // the cycle's single retry

      const res = await proxyMediaUpload(upload(), '/api/v1/partner/media/upload');

      // Not 401 NO_SESSION: the cabinet reads that as «Сессия истекла».
      expect(res.status).toBe(503);
      expect(await errorOf(res)).toMatchObject({
        code: 'SESSION_REFRESH_UNAVAILABLE',
      });
      expect(mockServerFetch).toHaveBeenCalledTimes(2);
      for (const [path] of mockServerFetch.mock.calls) {
        expect(path).toBe('/api/v1/auth/refresh');
      }
      expect(mockStore.delete).not.toHaveBeenCalled();
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );

  it('a refresh the server refuses: 401 NO_SESSION, cookies cleared', async () => {
    cookies({ rg_rt: 'rt' });
    mockServerFetch.mockRejectedValueOnce(
      new ApiError(401, 'refused', 'TOKEN_REVOKED'),
    );

    const res = await proxyMediaUpload(upload(), '/api/v1/partner/media/upload');

    expect(res.status).toBe(401);
    expect(await errorOf(res)).toMatchObject({ code: 'NO_SESSION' });
    expect(mockServerFetch).toHaveBeenCalledTimes(1);
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('no tokens at all: 401 NO_SESSION without asking the backend', async () => {
    cookies({});

    const res = await proxyMediaUpload(upload(), '/api/v1/partner/media/upload');

    expect(res.status).toBe(401);
    expect(await errorOf(res)).toMatchObject({ code: 'NO_SESSION' });
    expect(mockServerFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('a refreshed token goes upstream as the Bearer', async () => {
    cookies({ rg_rt: 'rt' });
    mockServerFetch.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a', phone: null, name: 'n', role: 'partner' },
      accessToken: 'fresh',
      refreshToken: 'rt2',
      tokenType: 'Bearer',
      expiresIn: 14400,
    });
    upstreamFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { url: 'u' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await proxyMediaUpload(upload(), '/api/v1/partner/media/upload');

    expect(res.status).toBe(201);
    const [url, init] = upstreamFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('http://backend.test/api/v1/partner/media/upload');
    expect(init.headers.authorization).toBe('Bearer fresh');
  });
});
