/**
 * С8 (сверка находок тестировщика с сайтом, 18.10): a partner's way to their
 * cards from any page — «Мои заведения» in the account menu (desktop AuthMenu
 * and the phone burger, MobileNav) — and no «Стать партнёром» in the burger.
 * A plain user sees the menu as before.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockUser: { id: string; name: string; email: string; role: string } | null;
jest.mock('next/navigation', () => ({
  usePathname: () => '/minsk',
}));
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: mockUser ? 'authenticated' : 'anonymous',
    user: mockUser,
    logout: jest.fn(),
  }),
}));

import { AuthMenu } from '@/components/auth/AuthMenu';
import { MobileNav } from '@/components/layout/MobileNav';

const user = (role: string) => ({ id: 'u1', name: 'Аня', email: 'a@b.by', role });

beforeEach(() => {
  mockUser = null;
});

describe('AuthMenu (desktop)', () => {
  it('a partner gets «Мои заведения» → /cabinet', async () => {
    mockUser = user('partner');
    render(<AuthMenu />);

    await userEvent.click(screen.getByRole('button', { name: /Аня/ }));

    expect(
      await screen.findByRole('menuitem', { name: 'Мои заведения' }),
    ).toHaveAttribute('href', '/cabinet');
    expect(screen.getByRole('menuitem', { name: 'Профиль' })).toBeInTheDocument();
  });

  it('a plain user does not', async () => {
    mockUser = user('user');
    render(<AuthMenu />);

    await userEvent.click(screen.getByRole('button', { name: /Аня/ }));

    expect(await screen.findByRole('menuitem', { name: 'Профиль' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Мои заведения' })).toBeNull();
  });
});

describe('MobileNav (phone burger)', () => {
  it('a partner: «Мои заведения», no «Стать партнёром»', async () => {
    mockUser = user('partner');
    render(<MobileNav />);

    await userEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));

    expect(
      await screen.findByRole('link', { name: 'Мои заведения' }),
    ).toHaveAttribute('href', '/cabinet');
    expect(screen.queryByRole('link', { name: 'Стать партнёром' })).toBeNull();
  });

  it('a plain user: «Стать партнёром», no «Мои заведения»', async () => {
    mockUser = user('user');
    render(<MobileNav />);

    await userEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));

    expect(
      await screen.findByRole('link', { name: 'Стать партнёром' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Мои заведения' })).toBeNull();
  });
});
