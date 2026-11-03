/**
 * @jest-environment node
 */
/*
 * Geocode proxy (Phase C Slice 1, Segment B — Decision 3; thread «Расходы
 * посторонних», point 4, 03.11.2026). Nominatim response parsing, and who may
 * ask and how much: a same-origin POST with a session the API accepts, a
 * bounded query, an hourly allowance per account, a bounded wait line, one
 * outbound call for the same address asked at once, failures not cached.
 * Node env: the same-origin guard's 403 is a real Response; NextResponse.json
 * is stubbed; the session cookie and the API are mocked.
 */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/auth/session', () => ({ getAccessToken: jest.fn(), refreshSession: jest.fn() }));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { POST, _resetForTests } from '@/app/api/geocode/route';
import { serverFetch } from '@/lib/api/client';
import { getAccessToken, refreshSession } from '@/lib/auth/session';

const mockToken = getAccessToken as jest.Mock;
const mockRefresh = refreshSession as jest.Mock;
const mockApi = serverFetch as jest.Mock;
const realFetch = global.fetch;
let nominatim: jest.Mock;

// A browser's fetch with a string body always sends Content-Length.
const SAME = { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-length': '64' };

function req(
  q: unknown,
  { headers = SAME, signal }: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase() as keyof typeof headers] ?? null },
    json: async () => ({ q }),
    signal,
  } as unknown as Request;
}

const okRows = (rows: unknown[]) => ({ ok: true, json: async () => rows });
const HIT = [{ lat: '53.9', lon: '27.56', display_name: 'Минск, Беларусь' }];

beforeEach(() => {
  _resetForTests();
  jest.clearAllMocks();
  mockToken.mockResolvedValue('token-a');
  mockRefresh.mockResolvedValue(null);
  mockApi.mockResolvedValue({ user: { id: 'user-a' } });
  nominatim = jest.fn().mockResolvedValue(okRows(HIT));
  global.fetch = nominatim as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

describe('who may ask', () => {
  it('a cross-origin POST — 403, nothing asked', async () => {
    const res = await POST(req('Минск Независимости 1', { headers: { origin: 'http://evil.example', host: 'localhost:3000' } }));

    expect(res.status).toBe(403);
    expect(mockApi).not.toHaveBeenCalled();
    expect(nominatim).not.toHaveBeenCalled();
  });

  it('no session at all (no cookie, nothing to refresh) — 401 NO_SESSION, nothing asked', async () => {
    mockToken.mockResolvedValue(null);

    const res = await POST(req('Минск Независимости 1'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ result: null, code: 'NO_SESSION' });
    expect(mockApi).not.toHaveBeenCalled();
    expect(nominatim).not.toHaveBeenCalled();
  });

  it('a token the API refuses and no refresh — 401 NO_SESSION, Nominatim not asked', async () => {
    mockApi.mockRejectedValue(Object.assign(new Error('401'), { statusCode: 401 }));

    const res = await POST(req('Минск Независимости 1'));

    expect(res.status).toBe(401);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(nominatim).not.toHaveBeenCalled();
  });

  it('the access cookie gone after four hours — the session is refreshed once, the lookup goes on', async () => {
    mockToken.mockResolvedValue(null);
    mockRefresh.mockResolvedValue('token-fresh');

    const res = await POST(req('Минск Независимости 1'));

    expect(res.status).toBe(200);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      { headers: { Authorization: 'Bearer token-fresh' } },
      expect.anything(),
    );
  });

  it('the access token refused — refreshed once, then accepted', async () => {
    mockApi
      .mockRejectedValueOnce(Object.assign(new Error('401'), { statusCode: 401 }))
      .mockResolvedValueOnce({ user: { id: 'user-a' } });
    mockRefresh.mockResolvedValue('token-fresh');

    expect((await POST(req('Минск Независимости 1'))).status).toBe(200);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('a body without Content-Length is not read — 400, nothing asked', async () => {
    const res = await POST(req('Минск Независимости 1', { headers: { origin: SAME.origin, host: SAME.host } }));

    expect([res.status, (await res.json()).code]).toEqual([400, 'TOO_LONG']);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('the API unreachable — 503 UNAVAILABLE, Nominatim not asked', async () => {
    mockApi.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 0 }));

    const res = await POST(req('Минск Независимости 1'));

    expect([res.status, (await res.json()).code]).toEqual([503, 'UNAVAILABLE']);
    expect(nominatim).not.toHaveBeenCalled();
  });

  it('the token is checked once and remembered, with the visitor named', async () => {
    await POST(req('Минск Независимости 1'));
    await POST(req('Минск Независимости 1'));

    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      { headers: { Authorization: 'Bearer token-a' } },
      expect.objectContaining({ visitor: null }),
    );
  });
});

describe('the query', () => {
  it('too short — null without calling Nominatim', async () => {
    const res = await POST(req('ab'));

    expect(await res.json()).toEqual({ result: null });
    expect(nominatim).not.toHaveBeenCalled();
  });

  it('200 characters taken, 201 — 400 TOO_LONG before the session is checked', async () => {
    expect((await POST(req('а'.repeat(200)))).status).toBe(200);
    mockApi.mockClear();

    const res = await POST(req('а'.repeat(201)));

    expect([res.status, (await res.json()).code]).toEqual([400, 'TOO_LONG']);
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('Nominatim', () => {
  it('parses the first hit into {lat, lng}', async () => {
    const res = await POST(req('Минск проспект Независимости 1'));
    const body = (await res.json()) as { result: { lat: number; lng: number } };

    expect(body.result).toMatchObject({ lat: 53.9, lng: 27.56 });
  });

  it('no rows — null, and the miss is cached', async () => {
    nominatim.mockResolvedValue(okRows([]));

    expect((await (await POST(req('несуществующий адрес 9999'))).json()).result).toBeNull();
    expect((await (await POST(req('несуществующий адрес 9999'))).json()).result).toBeNull();
    expect(nominatim).toHaveBeenCalledTimes(1);
  });

  it('a failed call — 503 UNAVAILABLE and not cached: asked again next time', async () => {
    jest.useFakeTimers();
    nominatim.mockRejectedValueOnce(new Error('network'));

    const first = await POST(req('Гомель Советская 5'));
    expect([first.status, (await first.json()).code]).toEqual([503, 'UNAVAILABLE']);

    const second = POST(req('Гомель Советская 5'));
    await jest.advanceTimersByTimeAsync(1100);
    expect((await (await second).json()).result).toMatchObject({ lat: 53.9 });
    expect(nominatim).toHaveBeenCalledTimes(2);
  });

  it('the same address asked twice at once — one outbound call', async () => {
    const [a, b] = await Promise.all([POST(req('Брест Советская 1')), POST(req('Брест Советская 1'))]);

    expect((await a.json()).result).toMatchObject({ lat: 53.9 });
    expect((await b.json()).result).toMatchObject({ lat: 53.9 });
    expect(nominatim).toHaveBeenCalledTimes(1);
  });

  it('a request dropped before its turn — Nominatim not asked', async () => {
    const controller = new AbortController();
    controller.abort();

    await POST(req('Витебск Ленина 1', { signal: controller.signal }));

    expect(nominatim).not.toHaveBeenCalled();
  });
});

describe('how much', () => {
  it('30 lookups an hour per account; the 31st — 429 RATE_LIMITED', async () => {
    jest.useFakeTimers();
    for (let i = 0; i < 30; i += 1) {
      const pending = POST(req(`Минск улица ${i}`));
      await jest.advanceTimersByTimeAsync(1100);
      expect((await pending).status).toBe(200);
    }

    const refused = await POST(req('Минск улица 30'));

    expect([refused.status, (await refused.json()).code]).toEqual([429, 'RATE_LIMITED']);
    expect(nominatim).toHaveBeenCalledTimes(30);
  });

  it('the wait line holds 10; past it — 503 BUSY, and only those in line are asked', async () => {
    jest.useFakeTimers();
    const pending = Array.from({ length: 15 }, (_, i) => POST(req(`Гродно улица ${i}`)));
    await jest.advanceTimersByTimeAsync(20 * 1100);
    const answers = await Promise.all(pending);
    const codes = await Promise.all(answers.map(async (r) => (await r.json()).code ?? r.status));

    const busy = codes.filter((c) => c === 'BUSY').length;
    expect(busy).toBeGreaterThanOrEqual(4);
    expect(nominatim).toHaveBeenCalledTimes(15 - busy);
  });
});
