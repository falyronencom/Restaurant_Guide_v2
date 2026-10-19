/**
 * SiteHeader — two things from the сверка находок тестировщика с сайтом, 18.10.
 *
 * 1. White on white. A one-segment path counts as a city page with a photo
 *    banner, and the header overlays it: transparent, white wordmark and
 *    controls. «Забыли пароль», «Новый пароль» and «Подтверждение почты» are
 *    one segment deep too, have no banner and a white page — the header was
 *    invisible there. Every static page next to [city] must be listed in
 *    NO_BANNER_PAGES; the folder check below fails when a new one is added
 *    without it.
 * 2. С8. A partner is not offered «Стать партнёром».
 *
 * AuthMenu / MobileNav are stubbed (own tests: account-menu-partner.test.tsx).
 */
import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';

let mockPathname = '/';
let mockUser: { role: string } | null = null;
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));
jest.mock('@/components/auth/AuthMenu', () => ({
  AuthMenu: ({ overlay }: { overlay?: boolean }) => (
    <div data-testid="auth-menu" data-overlay={String(Boolean(overlay))} />
  ),
}));
jest.mock('@/components/layout/MobileNav', () => ({
  MobileNav: () => null,
}));

import { NO_BANNER_PAGES, SiteHeader } from '@/components/layout/SiteHeader';

beforeEach(() => {
  mockPathname = '/';
  mockUser = null;
});

describe('banner overlay vs solid header', () => {
  it.each(['/forgot-password', '/reset-password', '/verify-email', '/login', '/register'])(
    '%s — solid header (no banner behind it)',
    (p) => {
      mockPathname = p;
      render(<SiteHeader />);

      expect(screen.getByRole('banner')).toHaveClass('bg-background');
      expect(screen.getByRole('banner')).not.toHaveClass('bg-transparent');
      expect(screen.getByTestId('auth-menu')).toHaveAttribute('data-overlay', 'false');
    },
  );

  it('a city page (/minsk) keeps the overlay over its banner', () => {
    mockPathname = '/minsk';
    render(<SiteHeader />);

    expect(screen.getByRole('banner')).toHaveClass('bg-transparent');
    expect(screen.getByTestId('auth-menu')).toHaveAttribute('data-overlay', 'true');
  });

  it('every static page folder next to [city] is listed as having no banner', () => {
    const dir = path.join(__dirname, '..', 'src', 'app', '(public)');
    const staticPages = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('['))
      .filter((d) => fs.existsSync(path.join(dir, d.name, 'page.tsx')))
      .map((d) => d.name)
      .sort();

    expect(staticPages.length).toBeGreaterThan(0);
    expect([...NO_BANNER_PAGES].sort()).toEqual(staticPages);
  });
});

describe('С8 — «Стать партнёром» only for those who are not partners yet', () => {
  it('a guest sees it', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('link', { name: 'Стать партнёром' })).toBeInTheDocument();
  });

  it('a signed-in user (not a partner) sees it', () => {
    mockUser = { role: 'user' };
    render(<SiteHeader />);
    expect(screen.getByRole('link', { name: 'Стать партнёром' })).toBeInTheDocument();
  });

  it('a partner does not', () => {
    mockUser = { role: 'partner' };
    render(<SiteHeader />);
    expect(screen.queryByRole('link', { name: 'Стать партнёром' })).toBeNull();
  });
});
