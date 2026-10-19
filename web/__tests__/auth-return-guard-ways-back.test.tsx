/**
 * The ways back after sign-in, end to end within the web tier: a returnTo
 * that leads off the site, handed in where a visitor's link puts it, never
 * reaches a navigation. Two sinks:
 *   - the server redirect after Yandex (success AND the cancel branch — a
 *     visitor who never signs in still lands there);
 *   - AuthRedirect's router.replace, fed by the /login and /register pages
 *     (e-mail, Google, an already signed-in visit). AuthRedirect hands its
 *     prop to router.replace unchanged, so what is checked here is the prop
 *     the page gives it — router.replace itself is not run.
 * The guard's own fixture lives in auth-return-guard.test.ts; here only the
 * classes that leave the site raw are replayed through the real pages and
 * route, so a consumer that stopped calling the guard would fail.
 */
import { render, screen } from '@testing-library/react';

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
jest.mock('@/components/auth/AuthRedirect', () => ({
  AuthRedirect: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="auth-redirect" data-return-to={returnTo} />
  ),
}));
jest.mock('@/components/auth/LoginForm', () => ({ LoginForm: () => null }));
jest.mock('@/components/auth/RegisterForm', () => ({ RegisterForm: () => null }));
jest.mock('@/components/auth/OAuthButtons', () => ({ OAuthButtons: () => null }));

import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api/client';
import { GET } from '@/app/auth/yandex/callback/route';
import LoginPage from '@/app/(public)/login/page';
import RegisterPage from '@/app/(public)/register/page';

const redirectMock = redirect as unknown as jest.Mock;
const backendFetch = serverFetch as jest.Mock;
const exchangeFetch = jest.fn();

const SITE = 'https://nirivio.by';

// Values that leave the site when navigated to as they are.
const OFF_SITE = [
  '//evil.example',
  '/\\evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r/evil.example',
];

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

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.YANDEX_CLIENT_ID = 'cid';
  process.env.YANDEX_CLIENT_SECRET = 'secret';
  process.env.SITE_URL = SITE;
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
});

function callbackRequest(params: Record<string, string>): Request {
  const url = new URL(`${SITE}/auth/yandex/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString() } as unknown as Request;
}

function withYState(r: string): void {
  mockStore.get.mockImplementation((name: string) =>
    name === 'y_state' ? { value: JSON.stringify({ n: 'state-s', r }) } : undefined,
  );
}

/** Where the browser lands when it follows `target` from the callback URL. */
function landsOn(target: string): URL {
  return new URL(target, `${SITE}/auth/yandex/callback?code=c&state=state-s`);
}

describe('Yandex callback — the redirect stays on the site', () => {
  it.each(OFF_SITE)('success with stored returnTo %p lands on /', async (r) => {
    withYState(r);
    exchangeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'ya-token' }),
    } as unknown as Response);
    backendFetch.mockResolvedValue(LOGIN_DATA);

    await GET(callbackRequest({ code: 'auth-code', state: 'state-s' }));

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith('/');
  });

  // The cancel branch's exact address belongs to the auth_error contract,
  // which other work reshapes; what this file owns is the origin.
  it.each(OFF_SITE)('cancel with stored returnTo %p stays on the site', async (r) => {
    withYState(r);

    await GET(callbackRequest({ error: 'access_denied', state: 'state-s' }));

    expect(redirectMock).toHaveBeenCalledTimes(1);
    const landed = landsOn(redirectMock.mock.calls[0][0] as string);
    expect(landed.origin).toBe(SITE);
    expect(landed.pathname).not.toContain('evil');
  });
});

describe('/login and /register — AuthRedirect receives only an on-site path', () => {
  it.each(OFF_SITE)('/login?returnTo=%p → AuthRedirect gets /', async (returnTo) => {
    render(await LoginPage({ searchParams: Promise.resolve({ returnTo }) }));

    expect(screen.getByTestId('auth-redirect')).toHaveAttribute('data-return-to', '/');
  });

  it.each(OFF_SITE)('/register?returnTo=%p → AuthRedirect gets /', async (returnTo) => {
    render(await RegisterPage({ searchParams: Promise.resolve({ returnTo }) }));

    expect(screen.getByTestId('auth-redirect')).toHaveAttribute('data-return-to', '/');
  });

  it('a card address still comes back as given', async () => {
    const card = '/minsk/restorany/kafe-1';
    render(await LoginPage({ searchParams: Promise.resolve({ returnTo: card }) }));

    expect(screen.getByTestId('auth-redirect')).toHaveAttribute('data-return-to', card);
  });
});
