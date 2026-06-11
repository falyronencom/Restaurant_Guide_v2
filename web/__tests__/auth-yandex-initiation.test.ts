/**
 * Yandex OAuth — initiation (lib/auth/yandex.ts pure helpers + the
 * startYandexLogin Server Action).
 *
 * Mocks the API-client-free boundaries: next/headers cookies() and
 * next/navigation redirect(). The REAL yandex.ts URL builder + session.ts
 * y_state writer run, so this deterministically pins the authorize-URL shape
 * (the one thing the dev-server sandbox could not observe — the external hop)
 * and the state↔cookie binding.
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

import { redirect } from 'next/navigation';
import { buildAuthorizeUrl, guardReturnTo } from '@/lib/auth/yandex';
import { startYandexLogin } from '@/lib/auth/actions';

const redirectMock = redirect as unknown as jest.Mock;

const ENV_KEYS = ['YANDEX_CLIENT_ID', 'YANDEX_CLIENT_SECRET', 'SITE_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.YANDEX_CLIENT_ID = 'test-client-id';
  process.env.YANDEX_CLIENT_SECRET = 'test-secret';
  process.env.SITE_URL = 'https://nirivio.by';
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockReturnValue(undefined);
});

describe('buildAuthorizeUrl', () => {
  it('builds the authorization-code URL with the registered redirect_uri (no force_confirm)', () => {
    const url = new URL(buildAuthorizeUrl('state-123'));

    expect(`${url.origin}${url.pathname}`).toBe('https://oauth.yandex.ru/authorize');
    expect(url.searchParams.get('response_type')).toBe('code'); // NOT token (R1)
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://nirivio.by/auth/yandex/callback', // built from SITE_URL (D5)
    );
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.has('force_confirm')).toBe(false); // R1
  });

  it('throws when YANDEX_CLIENT_ID is unset (fail-closed, no silent empty client_id)', () => {
    delete process.env.YANDEX_CLIENT_ID;
    expect(() => buildAuthorizeUrl('s')).toThrow(/YANDEX_CLIENT_ID/);
    process.env.YANDEX_CLIENT_ID = 'test-client-id';
  });
});

describe('guardReturnTo', () => {
  it('accepts a same-origin relative path', () => {
    expect(guardReturnTo('/minsk/restorany')).toBe('/minsk/restorany');
  });

  it.each(['//evil.com', '/\\evil.com', '/\\/evil.com', 'https://evil.com', 'http://evil.com', 'evil', '', null, undefined])(
    'collapses %p to /',
    (input) => {
      expect(guardReturnTo(input as string | null | undefined)).toBe('/');
    },
  );
});

describe('startYandexLogin', () => {
  it('stores y_state {n,r} (httpOnly, Lax, 10m) and redirects with state === the stored nonce', async () => {
    const fd = new FormData();
    fd.set('returnTo', '/minsk');

    await startYandexLogin(fd);

    // y_state issued with the expected cookie options.
    expect(mockStore.set).toHaveBeenCalledWith(
      'y_state',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 }),
    );
    const yStateCall = mockStore.set.mock.calls.find((c) => c[0] === 'y_state');
    const stored = JSON.parse(yStateCall![1] as string) as { n: string; r: string };
    expect(stored.r).toBe('/minsk');
    expect(typeof stored.n).toBe('string');
    expect(stored.n.length).toBeGreaterThan(0);

    // The redirect's state param is bound to the stored nonce (state↔cookie seam).
    expect(redirectMock).toHaveBeenCalledTimes(1);
    const redirectedUrl = new URL(redirectMock.mock.calls[0][0] as string);
    expect(redirectedUrl.searchParams.get('state')).toBe(stored.n);
    expect(redirectedUrl.searchParams.get('response_type')).toBe('code');
  });

  it('collapses an unsafe returnTo to / before storing it (open-redirect guard at the source)', async () => {
    const fd = new FormData();
    fd.set('returnTo', '//evil.com');

    await startYandexLogin(fd);

    const yStateCall = mockStore.set.mock.calls.find((c) => c[0] === 'y_state');
    const stored = JSON.parse(yStateCall![1] as string) as { r: string };
    expect(stored.r).toBe('/');
  });

  it('defaults returnTo to / when the form omits it', async () => {
    await startYandexLogin(new FormData());

    const yStateCall = mockStore.set.mock.calls.find((c) => c[0] === 'y_state');
    const stored = JSON.parse(yStateCall![1] as string) as { r: string };
    expect(stored.r).toBe('/');
  });
});
