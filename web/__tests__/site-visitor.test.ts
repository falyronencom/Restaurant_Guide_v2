/**
 * @jest-environment node
 */
/**
 * The visitor the site names to the API, and the secret that proves the
 * request is the site's (registry v4.35, v4.44; directive D5, 25.10.2026).
 *
 * Pinned here:
 *   - which X-Forwarded-For entry is the visitor — Railway's chain is
 *     `visitor, hop` (the API's own rule, backend config/trustProxy.js);
 *   - serverFetch carries the secret on every call when one is set, and the
 *     visitor only when the caller passes one — it reads nothing from the
 *     request itself (headers() there would make ISR pages dynamic);
 *   - the sign-in action and the map's Route Handler pass the visitor of the
 *     request they serve.
 */
const headerStore = new Headers();
const mockStore = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), has: jest.fn() };

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockStore)),
  headers: jest.fn(() => Promise.resolve(headerStore)),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

import { headers } from 'next/headers';

import { serverFetch } from '@/lib/api/client';
import {
  currentVisitor,
  siteRequestHeaders,
  trustedHops,
  visitorAddressFrom,
} from '@/lib/api/visitor';

const SECRET = 'k'.repeat(44);
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

const chain = (value: string | null) => ({
  get: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? value : null),
});

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  headerStore.delete('x-forwarded-for');
});

describe('trustedHops', () => {
  it.each([
    [undefined, 2],
    ['', 2],
    ['1', 1],
    ['3', 3],
    ['0', 1],
    ['4', 1],
    ['true', 1],
    ['2.0', 1],
  ])('SITE_TRUST_PROXY_HOPS=%p → %p (a malformed value is the unforgeable 1)', (raw, hops) => {
    expect(trustedHops({ SITE_TRUST_PROXY_HOPS: raw })).toBe(hops);
  });
});

describe('visitorAddressFrom', () => {
  it('Railway’s chain `visitor, hop` — the visitor', () => {
    expect(visitorAddressFrom(chain('203.0.113.10, 152.233.10.1'))).toBe('203.0.113.10');
  });

  it('a forged head in front of the edge’s chain is not the visitor', () => {
    expect(visitorAddressFrom(chain('10.9.9.9, 198.51.100.1, 203.0.113.10, 152.233.10.1')))
      .toBe('203.0.113.10');
  });

  it('a lone entry — taken as the visitor (fewer entries than hops: the leftmost)', () => {
    expect(visitorAddressFrom(chain('203.0.113.10'))).toBe('203.0.113.10');
  });

  it('one trusted hop — the right-most entry', () => {
    expect(visitorAddressFrom(
      chain('203.0.113.10, 152.233.10.1'),
      { SITE_TRUST_PROXY_HOPS: '1' },
    )).toBe('152.233.10.1');
  });

  it('IPv6 is passed as it is — the API cuts it to its /64', () => {
    expect(visitorAddressFrom(chain('2001:db8:1:2::5, 152.233.10.1'))).toBe('2001:db8:1:2::5');
  });

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['not an address', 'example.com, 152.233.10.1'],
    ['an address with a port', '203.0.113.10:443, 152.233.10.1'],
  ])('%s — no visitor', (_label, value) => {
    expect(visitorAddressFrom(chain(value))).toBeNull();
  });

  it('no headers object at all — no visitor, no throw', () => {
    expect(visitorAddressFrom(undefined)).toBeNull();
  });
});

describe('siteRequestHeaders', () => {
  it('with a secret and a visitor — both headers', () => {
    expect(siteRequestHeaders('203.0.113.10', { SITE_REQUEST_SECRET: SECRET }))
      .toEqual({ 'X-Site-Secret': SECRET, 'X-Site-Visitor': '203.0.113.10' });
  });

  it('with a secret and no visitor — the secret alone: the site’s own request', () => {
    expect(siteRequestHeaders(null, { SITE_REQUEST_SECRET: SECRET }))
      .toEqual({ 'X-Site-Secret': SECRET });
  });

  it.each([undefined, '', 'short'])('secret %p — no header at all, not even the visitor', (secret) => {
    expect(siteRequestHeaders('203.0.113.10', { SITE_REQUEST_SECRET: secret }))
      .toEqual({});
  });
});

describe('serverFetch', () => {
  const fetchOk = () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ success: true, data: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };
  const sentHeaders = (fetchMock: jest.Mock) =>
    (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;

  beforeEach(() => {
    process.env.API_URL = 'http://api.test';
  });

  it('carries the secret on every call, and the visitor only when the caller passes one', async () => {
    process.env.SITE_REQUEST_SECRET = SECRET;
    const fetchMock = fetchOk();

    await serverFetch('/api/v1/public/metadata');
    await serverFetch('/api/v1/auth/login', { method: 'POST' }, { visitor: '203.0.113.10' });

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'application/json', 'X-Site-Secret': SECRET });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      'X-Site-Secret': SECRET, 'X-Site-Visitor': '203.0.113.10',
    });
  });

  it('never reads the request itself — headers() stays untouched (ISR pages stay static)', async () => {
    process.env.SITE_REQUEST_SECRET = SECRET;
    headerStore.set('x-forwarded-for', '203.0.113.99, 152.233.10.1');
    const fetchMock = fetchOk();

    await serverFetch('/api/v1/public/establishments');

    expect(headers).not.toHaveBeenCalled();
    expect(sentHeaders(fetchMock)['X-Site-Visitor']).toBeUndefined();
  });

  it('the metadata is held in the data cache for an hour — no API call per results view', async () => {
    const fetchMock = fetchOk();
    const { getMetadata } = await import('@/lib/api/endpoints/metadata');

    await getMetadata();

    expect(fetchMock.mock.calls[0][1].next).toEqual({ revalidate: 3600 });
  });

  it('without a secret — what it sent before: Accept only', async () => {
    delete process.env.SITE_REQUEST_SECRET;
    const fetchMock = fetchOk();

    await serverFetch('/api/v1/auth/login', undefined, { visitor: '203.0.113.10' });

    expect(sentHeaders(fetchMock)).toEqual({ Accept: 'application/json' });
  });
});

describe('the callers that serve a visitor pass the visitor', () => {
  beforeEach(() => {
    process.env.API_URL = 'http://api.test';
    process.env.SITE_REQUEST_SECRET = SECRET;
  });

  it('currentVisitor reads the request being served', async () => {
    headerStore.set('x-forwarded-for', '203.0.113.42, 152.233.10.1');
    await expect(currentVisitor()).resolves.toBe('203.0.113.42');
  });

  it('currentVisitor outside a request — no visitor, no throw', async () => {
    (headers as jest.Mock).mockImplementationOnce(() => {
      throw new Error('`headers` was called outside a request scope');
    });
    await expect(currentVisitor()).resolves.toBeNull();
  });

  it('the sign-in action sends the visitor of its request to the API', async () => {
    headerStore.set('x-forwarded-for', '203.0.113.42, 152.233.10.1');
    const fetchMock = jest.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ success: false, error: { code: 'INVALID_CREDENTIALS' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { loginAction } = await import('@/lib/auth/actions');
    const fd = new FormData();
    fd.set('email', 'user@test.by');
    fd.set('password', 'Passw0rd');

    await loginAction({ status: 'idle' } as never, fd);

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/v1/auth/login'));
    expect(call?.[1].headers).toMatchObject({
      'X-Site-Secret': SECRET, 'X-Site-Visitor': '203.0.113.42',
    });
  });

  it('the map’s Route Handler sends the visitor of its request', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ success: true, data: { establishments: [] } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { GET } = await import('@/app/api/map/route');

    await GET(new Request('http://site.test/api/map?neLat=54&neLon=28&swLat=53&swLon=27', {
      headers: { 'x-forwarded-for': '203.0.113.43, 152.233.10.1' },
    }));

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'X-Site-Secret': SECRET, 'X-Site-Visitor': '203.0.113.43',
    });
  });
});
