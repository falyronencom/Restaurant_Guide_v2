/**
 * The partner's menu on the wire (part 1 of «Кабинет партнёра на сайте»).
 *
 * The answer of GET /api/v1/partner/establishments/:id/menu-items puts the
 * recognition state and the hidden-items fact BESIDE `data`
 * (backend partnerMenuItemController.listMenuItems):
 *   res.json({ success: true, data: items, recognition, hasHiddenItems })
 * and serverFetch used to return `data` only — the two fields would never
 * reach the cabinet. The fixture below is that controller's shape, with a row
 * as the table's own SELECT * gives it (price as node-pg reads NUMERIC — a
 * string). Each layer is pinned on its own: the real serverFetch over a
 * mocked global fetch, authedFetch passing `envelope` through, the endpoint's
 * parse. No test here reaches a real network: fetch is a mock or a thrower.
 */

const CONTROLLER_ANSWER = {
  success: true,
  data: [
    {
      id: 'i1',
      establishment_id: 'e1',
      media_id: 'm1',
      item_name: 'Драники',
      price_byn: '12.50',
      category_raw: 'Горячее',
      confidence: '0.95',
      sanity_flag: { reason: 'price_below_threshold', details: { price: 0.3, threshold: 0.5 } },
      is_hidden_by_admin: false,
      position: 3,
      hidden_reason: null,
      created_at: '2026-11-20T10:00:00.000Z',
      updated_at: '2026-11-20T10:00:00.000Z',
      guest_hidden_reason: null,
    },
    {
      id: 'i2',
      establishment_id: 'e1',
      media_id: 'm2',
      item_name: 'Вино красное',
      price_byn: null,
      category_raw: '',
      confidence: null,
      sanity_flag: null,
      is_hidden_by_admin: false,
      position: 0,
      hidden_reason: null,
      created_at: '2026-11-20T10:00:00.000Z',
      updated_at: '2026-11-20T10:00:00.000Z',
      guest_hidden_reason: 'alcohol',
    },
  ],
  recognition: { status: 'failed', cause: 'service_failure', reason: 'Сбой распознавания — попробуйте позже.', failedAt: '2026-11-20T10:00:00.000Z' },
  hasHiddenItems: true,
};

describe('serverFetch — the whole success body with `envelope`', () => {
  const originalApiUrl = process.env.API_URL;
  const originalFetch = global.fetch;

  beforeAll(() => {
    process.env.API_URL = 'http://api.test';
  });
  afterAll(() => {
    process.env.API_URL = originalApiUrl;
    global.fetch = originalFetch;
  });

  function answer(body: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(body),
    }) as unknown as typeof fetch;
  }

  it('keeps `recognition` and `hasHiddenItems` beside `data`', async () => {
    const { serverFetch } = jest.requireActual('@/lib/api/client') as typeof import('@/lib/api/client');
    answer(CONTROLLER_ANSWER);

    const body = await serverFetch<typeof CONTROLLER_ANSWER>('/x', undefined, { envelope: true });

    expect(body.recognition).toEqual(CONTROLLER_ANSWER.recognition);
    expect(body.hasHiddenItems).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it('without it — `data` only, as every other call reads it', async () => {
    const { serverFetch } = jest.requireActual('@/lib/api/client') as typeof import('@/lib/api/client');
    answer(CONTROLLER_ANSWER);

    const data = await serverFetch<unknown[]>('/x');

    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
  });

  it('with `envelope`, a refusal still throws: the whole body is for a success only', async () => {
    const { serverFetch } = jest.requireActual('@/lib/api/client') as typeof import('@/lib/api/client');
    answer({ success: false, error: { code: 'FORBIDDEN', message: 'Нет доступа к заведению', statusCode: 403 } });

    await expect(serverFetch('/x', undefined, { envelope: true })).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'FORBIDDEN',
    });
  });
});

describe('authedFetch passes `envelope` to the transport', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('as the third option of serverFetch, beside the visitor', async () => {
    const serverFetch = jest.fn().mockResolvedValue(CONTROLLER_ANSWER);
    jest.doMock('@/lib/api/client', () => ({ serverFetch }));
    jest.doMock('@/lib/api/visitor', () => ({ currentVisitor: jest.fn(async () => null) }));
    jest.doMock('next/headers', () => ({
      cookies: jest.fn(async () => ({
        get: (name: string) => (name === 'rg_at' ? { value: 'access-token' } : undefined),
        set: jest.fn(),
        delete: jest.fn(),
        has: jest.fn(),
      })),
    }));
    const { authedFetch } = await import('@/lib/auth/session');

    await authedFetch('/api/v1/partner/establishments/e1/menu-items', undefined, { envelope: true });

    expect(serverFetch).toHaveBeenCalledWith(
      '/api/v1/partner/establishments/e1/menu-items',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token' }) }),
      expect.objectContaining({ envelope: true }),
    );
  });

  /** The session's cookies as a jar the refresh may write. */
  function withSession(serverFetch: jest.Mock) {
    const jar = new Map<string, string>([
      ['rg_at', 'access-token'],
      ['rg_rt', 'refresh-token'],
    ]);
    jest.doMock('@/lib/api/client', () => ({ serverFetch }));
    jest.doMock('@/lib/api/visitor', () => ({ currentVisitor: jest.fn(async () => null) }));
    jest.doMock('next/headers', () => ({
      cookies: jest.fn(async () => ({
        get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
        set: jest.fn((name: string, value: string) => {
          jar.set(name, value);
        }),
        delete: jest.fn((name: string) => {
          jar.delete(name);
        }),
        has: (name: string) => jar.has(name),
      })),
    }));
  }

  it('a call without options passes no `envelope`: every older call keeps reading `data`', async () => {
    const serverFetch = jest.fn().mockResolvedValue({ establishments: [] });
    withSession(serverFetch);
    const { authedFetch } = await import('@/lib/auth/session');

    await authedFetch('/api/v1/partner/establishments');

    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch.mock.calls[0][2]).toEqual({ visitor: null, envelope: undefined });
  });

  it('the retry after a refused access token carries `envelope` too', async () => {
    const MENU = '/api/v1/partner/establishments/e1/menu-items';
    let menuCalls = 0;
    const serverFetch = jest.fn(async (path: string, _init?: RequestInit, _options?: unknown) => {
      if (path === '/api/v1/auth/refresh') {
        return {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresIn: 3600,
          user: { id: 'u1', email: 'p@e.by', name: 'П', role: 'partner' },
        };
      }
      menuCalls += 1;
      if (menuCalls === 1) {
        const { ApiError } = await import('@/lib/api/types');
        throw new ApiError(401, 'Token expired', 'TOKEN_EXPIRED');
      }
      return CONTROLLER_ANSWER;
    });
    withSession(serverFetch);
    const { authedFetch } = await import('@/lib/auth/session');

    const body = await authedFetch(MENU, undefined, { envelope: true });

    const menu = serverFetch.mock.calls.filter((c) => c[0] === MENU);
    expect(menu).toHaveLength(2);
    expect(menu[1][1]).toMatchObject({ headers: { Authorization: 'Bearer new-access-token' } });
    expect(menu[1][2]).toMatchObject({ envelope: true });
    expect(body).toBe(CONTROLLER_ANSWER);
  });
});

describe('endpoints/partner — the menu and its writes', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function withAuthedFetch(result: unknown) {
    const authedFetch = jest.fn().mockResolvedValue(result);
    jest.doMock('@/lib/auth/session', () => ({ authedFetch }));
    const endpoints = await import('@/lib/api/endpoints/partner');
    return { authedFetch, endpoints };
  }

  it('listMenuItems asks for the whole body and parses the controller\'s answer', async () => {
    const { authedFetch, endpoints } = await withAuthedFetch(CONTROLLER_ANSWER);

    const menu = await endpoints.listMenuItems('e1');

    expect(authedFetch).toHaveBeenCalledWith(
      '/api/v1/partner/establishments/e1/menu-items',
      undefined,
      { envelope: true },
    );
    expect(menu.recognition).toEqual({
      status: 'failed',
      cause: 'service_failure',
      reason: 'Сбой распознавания — попробуйте позже.',
    });
    expect(menu.hasHiddenItems).toBe(true);
    expect(menu.items[0]).toEqual({
      id: 'i1',
      establishment_id: 'e1',
      media_id: 'm1',
      item_name: 'Драники',
      price_byn: 12.5,
      category_raw: 'Горячее',
      sanity_flag: { reason: 'price_below_threshold', details: { price: 0.3, threshold: 0.5 } },
      position: 3,
      guest_hidden_reason: null,
    });
    expect(menu.items[1]).toMatchObject({ price_byn: null, category_raw: '', guest_hidden_reason: 'alcohol' });
  });

  it('updateMenuItem PATCHes the changed fields and reads the line of `data`', async () => {
    const { authedFetch, endpoints } = await withAuthedFetch({
      ...CONTROLLER_ANSWER.data[0],
      price_byn: '14.00',
      sanity_flag: null,
    });

    const item = await endpoints.updateMenuItem('i1', { price_byn: 14 });

    expect(authedFetch).toHaveBeenCalledWith('/api/v1/partner/menu-items/i1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_byn: 14 }),
    });
    expect(item).toMatchObject({ id: 'i1', establishment_id: 'e1', price_byn: 14, sanity_flag: null });
  });

  it('updateMenuItem refuses an answer without a line', async () => {
    const { endpoints } = await withAuthedFetch({ unexpected: true });

    // resetModules gives this module its own ApiError class: compare by shape.
    await expect(endpoints.updateMenuItem('i1', { price_byn: 14 })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'UNEXPECTED_ANSWER',
    });
  });

  it('updateMenuItem: `data: null` (the line replaced meanwhile) is MENU_ITEM_NOT_FOUND, not an unexpected answer (Phase 4.5, LOW 6)', async () => {
    const { endpoints } = await withAuthedFetch(null);

    await expect(endpoints.updateMenuItem('i1', { price_byn: 14 })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'MENU_ITEM_NOT_FOUND',
    });
  });

  it('retryOcr returns how many files were queued, of how many', async () => {
    const { endpoints } = await withAuthedFetch({ enqueuedJobs: 2, totalPdfs: 3 });

    await expect(endpoints.retryOcr('e1')).resolves.toEqual({ enqueuedJobs: 2, totalPdfs: 3 });
  });

  it('suspendEstablishment unwraps data.establishment, as resume does', async () => {
    const { authedFetch, endpoints } = await withAuthedFetch({
      establishment: { id: 'e1', status: 'suspended' },
    });

    await expect(endpoints.suspendEstablishment('e1')).resolves.toEqual({ id: 'e1', status: 'suspended' });
    expect(authedFetch).toHaveBeenCalledWith('/api/v1/partner/establishments/e1/suspend', {
      method: 'POST',
    });
  });
});
