/**
 * The header over /udalenie-uchetki (brief В1, 18.10.2026). A one-segment path
 * counts as a city page with a photo banner, and the header overlays it:
 * transparent, white wordmark and controls. The deletion page has no banner
 * and a light page — the header there must be the solid one, or it is white
 * on white. A city page keeps its overlay.
 *
 * AuthMenu / MobileNav are stubbed: only the header's own choice is checked.
 */
import { render, screen } from '@testing-library/react';

let mockPathname = '/';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock('@/components/auth/AuthMenu', () => ({
  AuthMenu: ({ overlay }: { overlay?: boolean }) => (
    <div data-testid="auth-menu" data-overlay={String(Boolean(overlay))} />
  ),
}));
jest.mock('@/components/layout/MobileNav', () => ({
  MobileNav: () => null,
}));

import { SiteHeader } from '@/components/layout/SiteHeader';

it('/udalenie-uchetki — the solid header: no banner behind it', () => {
  mockPathname = '/udalenie-uchetki';
  render(<SiteHeader />);

  expect(screen.getByRole('banner')).toHaveClass('bg-background');
  expect(screen.getByRole('banner')).not.toHaveClass('bg-transparent');
  expect(screen.getByTestId('auth-menu')).toHaveAttribute('data-overlay', 'false');
});

it('a city page (/minsk) keeps the overlay over its banner', () => {
  mockPathname = '/minsk';
  render(<SiteHeader />);

  expect(screen.getByRole('banner')).toHaveClass('bg-transparent');
  expect(screen.getByTestId('auth-menu')).toHaveAttribute('data-overlay', 'true');
});
