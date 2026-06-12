/**
 * doRefresh re-stamp (Phase C Slice 1, Segment B — additive change). On refresh,
 * the fresh role/name/email from RefreshData are merged into rg_user (so a
 * user→partner upgrade propagates), while avatarUrl — absent from RefreshData —
 * is preserved from the existing cookie.
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
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { serverFetch } from '@/lib/api/client';
import { refreshSession } from '@/lib/auth/session';

const fetchMock = serverFetch as jest.Mock;

const REFRESH_DATA = {
  user: {
    id: 'u1',
    email: 'new@b.by',
    phone: null,
    name: 'Партнёр',
    role: 'partner',
  },
  accessToken: 'at2',
  refreshToken: 'rt2',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockImplementation((name: string) => {
    if (name === 'rg_rt') return { value: 'rt1' };
    if (name === 'rg_user') {
      return {
        value: JSON.stringify({
          id: 'u1',
          email: 'old@b.by',
          name: 'Иван',
          role: 'user',
          avatarUrl: 'https://cdn.example/a.jpg',
        }),
      };
    }
    return undefined;
  });
});

describe('doRefresh re-stamp', () => {
  it('merges fresh role/name/email into rg_user and preserves avatarUrl', async () => {
    fetchMock.mockResolvedValue(REFRESH_DATA);

    await refreshSession();

    const userCall = mockStore.set.mock.calls.find((c) => c[0] === 'rg_user');
    expect(userCall).toBeTruthy();
    const written = JSON.parse(userCall![1] as string);
    expect(written).toEqual({
      id: 'u1',
      email: 'new@b.by',
      name: 'Партнёр',
      role: 'partner',
      avatarUrl: 'https://cdn.example/a.jpg',
    });
  });
});
