/**
 * @jest-environment node
 *
 * Profile endpoints on the wire (lib/api/endpoints/profile).
 *
 * Its only importer, lib/account/operations, is tested with this module mocked
 * whole (account-operations.test.ts), so the request itself was seen by no
 * test: a method or a path the backend does not route would leave every suite
 * green while saving the name 404s. The expectation comes from the backend:
 * authRoutes.js routes PUT /api/v1/auth/profile and GET /api/v1/auth/me;
 * authController.updateProfile reads `name` from the body and echoes
 * data.user.
 */
jest.mock('@/lib/auth/session', () => ({ authedFetch: jest.fn() }));

import { authedFetch } from '@/lib/auth/session';
import { getMe, putProfileName } from '@/lib/api/endpoints/profile';

const mockAuthedFetch = authedFetch as jest.Mock;

const USER = {
  id: 'u1',
  email: 'v@example.by',
  phone: null,
  name: 'Анна',
  role: 'user',
  authMethod: 'email',
  avatarUrl: null,
  emailVerified: true,
  phoneVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  mockAuthedFetch.mockReset();
  mockAuthedFetch.mockResolvedValue({ user: USER });
});

describe('profile endpoints — the request the backend routes', () => {
  it('saving the name is PUT /api/v1/auth/profile with { name }, and the echo is data.user', async () => {
    await expect(putProfileName('Анна')).resolves.toEqual(USER);

    const [path, init] = mockAuthedFetch.mock.calls[0];
    expect(path).toBe('/api/v1/auth/profile');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ name: 'Анна' });
  });

  it('the profile is GET /api/v1/auth/me, and the answer is data.user', async () => {
    await expect(getMe()).resolves.toEqual(USER);

    const [path, init] = mockAuthedFetch.mock.calls[0];
    expect(path).toBe('/api/v1/auth/me');
    expect(init?.method ?? 'GET').toBe('GET');
  });
});
