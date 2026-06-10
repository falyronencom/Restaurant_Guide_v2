/**
 * Yandex OAuth — callback Route Handler (app/auth/yandex/callback/route.ts).
 *
 * Exercises the strict R2 ladder against mocked boundaries: next/headers
 * cookies(), next/navigation redirect(), the backend serverFetch, and
 * global.fetch (the real exchangeCodeForToken runs against it). The REAL
 * consumeYState / state check / persistOAuthSession / guardReturnTo run.
 *
 * Key invariants asserted: the anti-abuse property (error / bad-state paths make
 * ZERO outbound calls), single-use state consume, session-cookie issuance on
 * success only, and the open-redirect guard on returnTo.
 */
const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
};

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockStore)),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api/client';
import { GET } from '@/app/auth/yandex/callback/route';

const redirectMock = redirect as unknown as jest.Mock;
const backendFetch = serverFetch as jest.Mock;
const exchangeFetch = jest.fn();

const TOKEN_URL = 'https://oauth.yandex.ru/token';

const LOGIN_DATA = {
  user: {
    id: 'u1',
    email: 'a@b.co',
    phone: null,
    name: 'Аня',
    role: 'user',
    authMethod: 'yandex',
    avatarUrl: null,
    lastLoginAt: null,
  },
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

const ENV_KEYS = ['YANDEX_CLIENT_ID', 'YANDEX_CLIENT_SECRET', 'SITE_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};
let savedFetch: typeof global.fetch;

function callbackRequest(params: Record<string, string>): Request {
  const url = new URL('https://nirivio.by/auth/yandex/callback');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // The handler only reads request.url — pass a minimal stand-in so the test
  // does not depend on a global Request constructor (absent under jsdom).
  return { url: url.toString() } as unknown as Request;
}

/** Make consumeYState observe a given cookie (or none). */
function withYState(value: { n: string; r: string } | null): void {
  mockStore.get.mockImplementation((name: string) =>
    name === 'y_state' && value ? { value: JSON.stringify(value) } : undefined,
  );
}

function okExchange(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'ya-token' }),
  } as unknown as Response;
}

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.YANDEX_CLIENT_ID = 'cid';
  process.env.YANDEX_CLIENT_SECRET = 'secret';
  process.env.SITE_URL = 'https://nirivio.by';
  savedFetch = global.fetch;
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = savedFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = exchangeFetch as unknown as typeof global.fetch;
  mockStore.get.mockReturnValue(undefined);
});

describe('Yandex callback — happy path', () => {
  it('exchanges the code, calls the frozen backend, issues session cookies, and redirects to returnTo', async () => {
    withYState({ n: 'state-s', r: '/minsk' });
    exchangeFetch.mockResolvedValue(okExchange());
    backendFetch.mockResolvedValue(LOGIN_DATA);

    await GET(callbackRequest({ code: 'auth-code', state: 'state-s' }));

    // (3) exchange hit the Yandex token endpoint with the code.
    expect(exchangeFetch).toHaveBeenCalledWith(
      TOKEN_URL,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('code=auth-code'),
      }),
    );
    // (4) frozen backend contract — identical to mobile.
    expect(backendFetch).toHaveBeenCalledWith(
      '/api/v1/auth/oauth',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ provider: 'yandex', token: 'ya-token' }),
      }),
    );
    // (5) session cookies issued (P2: set then redirect).
    expect(mockStore.set).toHaveBeenCalledWith('rg_at', 'access-1', expect.objectContaining({ httpOnly: true, maxAge: 14400 }));
    expect(mockStore.set).toHaveBeenCalledWith('rg_rt', 'refresh-1', expect.objectContaining({ httpOnly: true }));
    expect(mockStore.set).toHaveBeenCalledWith('rg_user', expect.any(String), expect.objectContaining({ httpOnly: true }));
    // state cookie consumed (single-use).
    expect(mockStore.delete).toHaveBeenCalledWith('y_state');
    // (6) land back on returnTo.
    expect(redirectMock).toHaveBeenCalledWith('/minsk');
  });

  it('collapses an unsafe stored returnTo to / on success (open-redirect guard)', async () => {
    withYState({ n: 'state-s', r: '//evil.com' });
    exchangeFetch.mockResolvedValue(okExchange());
    backendFetch.mockResolvedValue(LOGIN_DATA);

    await GET(callbackRequest({ code: 'auth-code', state: 'state-s' }));

    expect(redirectMock).toHaveBeenCalledWith('/');
  });
});

describe('Yandex callback — rejects WITHOUT any outbound call (anti-abuse)', () => {
  it('(1) Yandex error param → auth_error, no exchange, no backend', async () => {
    withYState({ n: 'state-s', r: '/minsk' });

    await GET(callbackRequest({ error: 'access_denied', state: 'state-s' }));

    expect(exchangeFetch).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith('/minsk?auth_error=1');
  });

  it('appends auth_error with & when the stored returnTo already has a query string', async () => {
    withYState({ n: 'state-s', r: '/minsk?from=card' });

    await GET(callbackRequest({ error: 'access_denied', state: 'state-s' }));

    expect(redirectMock).toHaveBeenCalledWith('/minsk?from=card&auth_error=1');
  });

  it('(2a) missing state cookie → auth_error on default /, no outbound', async () => {
    withYState(null);

    await GET(callbackRequest({ code: 'auth-code', state: 'state-s' }));

    expect(exchangeFetch).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith('/?auth_error=1');
  });

  it('(2b) state mismatch → auth_error, no outbound, cookie still consumed', async () => {
    withYState({ n: 'expected', r: '/minsk' });

    await GET(callbackRequest({ code: 'auth-code', state: 'attacker' }));

    expect(exchangeFetch).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
    expect(mockStore.delete).toHaveBeenCalledWith('y_state');
    expect(redirectMock).toHaveBeenCalledWith('/minsk?auth_error=1');
  });

  it('missing code with valid state → auth_error, no outbound', async () => {
    withYState({ n: 'state-s', r: '/minsk' });

    await GET(callbackRequest({ state: 'state-s' }));

    expect(exchangeFetch).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith('/minsk?auth_error=1');
  });
});

describe('Yandex callback — downstream failures collapse to auth_error', () => {
  it('exchange failure → auth_error, backend never reached, no session cookie', async () => {
    withYState({ n: 'state-s', r: '/minsk' });
    exchangeFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) } as unknown as Response);

    await GET(callbackRequest({ code: 'auth-code', state: 'state-s' }));

    expect(backendFetch).not.toHaveBeenCalled();
    expect(mockStore.set).not.toHaveBeenCalledWith('rg_at', expect.anything(), expect.anything());
    expect(redirectMock).toHaveBeenCalledWith('/minsk?auth_error=1');
  });

  it('backend 4xx → auth_error, no session cookie issued', async () => {
    withYState({ n: 'state-s', r: '/minsk' });
    exchangeFetch.mockResolvedValue(okExchange());
    backendFetch.mockRejectedValue(new Error('backend 403'));

    await GET(callbackRequest({ code: 'auth-code', state: 'state-s' }));

    expect(mockStore.set).not.toHaveBeenCalledWith('rg_at', expect.anything(), expect.anything());
    expect(redirectMock).toHaveBeenCalledWith('/minsk?auth_error=1');
  });
});
