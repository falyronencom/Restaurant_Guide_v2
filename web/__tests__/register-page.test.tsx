/**
 * /register RSC page (Slice 2) — mirror of login-page.test.tsx: returnTo
 * guarding + threading, the mutual /login link, noindex metadata.
 */
import { render, screen } from '@testing-library/react';

jest.mock('@/components/auth/AuthRedirect', () => ({
  AuthRedirect: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="auth-redirect" data-return-to={returnTo} />
  ),
}));
jest.mock('@/components/auth/RegisterForm', () => ({
  RegisterForm: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="register-form" data-return-to={returnTo} />
  ),
}));
jest.mock('@/components/auth/OAuthButtons', () => ({
  OAuthButtons: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="oauth-buttons" data-return-to={returnTo} />
  ),
}));

import RegisterPage, { metadata } from '@/app/(public)/register/page';

it('threads a safe returnTo into every island and preserves it in the /login link', async () => {
  const ui = await RegisterPage({
    searchParams: Promise.resolve({ returnTo: '/minsk' }),
  });
  render(ui);

  for (const id of ['auth-redirect', 'register-form', 'oauth-buttons']) {
    expect(screen.getByTestId(id)).toHaveAttribute('data-return-to', '/minsk');
  }
  expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute(
    'href',
    '/login?returnTo=%2Fminsk',
  );
});

it('collapses an open-redirect returnTo to / server-side', async () => {
  const ui = await RegisterPage({
    searchParams: Promise.resolve({ returnTo: '/\\evil.com' }),
  });
  render(ui);

  expect(screen.getByTestId('register-form')).toHaveAttribute(
    'data-return-to',
    '/',
  );
  expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute(
    'href',
    '/login',
  );
});

it('is noindex', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
