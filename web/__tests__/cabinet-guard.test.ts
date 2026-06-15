/**
 * (cabinet) layout guard (Phase C Slice 1, Segment B — Decision 6). No session →
 * redirect to /login?returnTo=/cabinet; a session → render through.
 */
jest.mock('@/lib/auth/session', () => ({ getSessionUser: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));

import { redirect } from 'next/navigation';

import CabinetLayout from '@/app/(cabinet)/layout';
import { getSessionUser } from '@/lib/auth/session';

const getUserMock = getSessionUser as jest.Mock;
// redirect() returns `never`, which does not overlap jest.Mock — widen via unknown.
const redirectMock = redirect as unknown as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('CabinetLayout guard', () => {
  it('redirects to /login?returnTo=/cabinet when there is no session', async () => {
    getUserMock.mockResolvedValue(null);
    await CabinetLayout({ children: null });
    expect(redirectMock).toHaveBeenCalledWith('/login?returnTo=/cabinet');
  });

  it('does not redirect when a session exists', async () => {
    getUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.by',
      name: 'Иван',
      role: 'user',
      avatarUrl: null,
    });
    await CabinetLayout({ children: null });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
