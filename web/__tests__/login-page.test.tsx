/**
 * /login RSC page (Slice 2) — async-RSC pattern: await the page function, then
 * render. Islands are stubbed; the page's own responsibilities are asserted:
 * server-side returnTo guarding, threading the SAME guarded value into every
 * island, the mutual /register link, and the noindex metadata.
 */
import { render, screen } from '@testing-library/react';

jest.mock('@/components/auth/AuthRedirect', () => ({
  AuthRedirect: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="auth-redirect" data-return-to={returnTo} />
  ),
}));
jest.mock('@/components/auth/LoginForm', () => ({
  LoginForm: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="login-form" data-return-to={returnTo} />
  ),
}));
jest.mock('@/components/auth/OAuthButtons', () => ({
  OAuthButtons: ({
    returnTo,
    redirectError,
  }: {
    returnTo: string;
    redirectError?: string | null;
  }) => (
    <div
      data-testid="oauth-buttons"
      data-return-to={returnTo}
      data-error={redirectError ?? ''}
    />
  ),
}));

import LoginPage, { metadata } from '@/app/(public)/login/page';

it('threads a safe returnTo into every island and preserves it in the /register link', async () => {
  const ui = await LoginPage({
    searchParams: Promise.resolve({ returnTo: '/minsk/restorany' }),
  });
  render(ui);

  for (const id of ['auth-redirect', 'login-form', 'oauth-buttons']) {
    expect(screen.getByTestId(id)).toHaveAttribute(
      'data-return-to',
      '/minsk/restorany',
    );
  }
  expect(
    screen.getByRole('link', { name: 'Зарегистрироваться' }),
  ).toHaveAttribute('href', '/register?returnTo=%2Fminsk%2Frestorany');
});

it('collapses an open-redirect returnTo to / server-side', async () => {
  const ui = await LoginPage({
    searchParams: Promise.resolve({ returnTo: '//evil.com' }),
  });
  render(ui);

  expect(screen.getByTestId('login-form')).toHaveAttribute(
    'data-return-to',
    '/',
  );
  expect(
    screen.getByRole('link', { name: 'Зарегистрироваться' }),
  ).toHaveAttribute('href', '/register');
});

it('defaults returnTo to / when absent', async () => {
  const ui = await LoginPage({ searchParams: Promise.resolve({}) });
  render(ui);

  expect(screen.getByTestId('oauth-buttons')).toHaveAttribute(
    'data-return-to',
    '/',
  );
});

it('is noindex (utility page, never a search target)', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

// Сверка находок тестировщика с сайтом, 18.10, Х2: a failed Yandex sign-in
// lands here with ?auth_error= — the page must say why (before, nothing read it).
describe('auth_error from the Yandex callback', () => {
  it('a general failure → the Russian Yandex text under the buttons', async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ auth_error: 'yandex', returnTo: '/minsk' }),
      }),
    );
    expect(screen.getByTestId('oauth-buttons')).toHaveAttribute(
      'data-error',
      'Не удалось войти через Яндекс. Попробуйте ещё раз или войдите другим способом.',
    );
    expect(screen.getByTestId('oauth-buttons')).toHaveAttribute(
      'data-return-to',
      '/minsk',
    );
  });

  it("«Отмена» on Yandex's page → says the sign-in was cancelled", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ auth_error: 'yandex_cancelled' }),
      }),
    );
    expect(screen.getByTestId('oauth-buttons')).toHaveAttribute(
      'data-error',
      'Вход через Яндекс отменён. Попробуйте ещё раз или войдите другим способом.',
    );
  });

  it('a closed account keeps its own text', async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ auth_error: 'ACCOUNT_DEACTIVATED' }),
      }),
    );
    expect(screen.getByTestId('oauth-buttons')).toHaveAttribute(
      'data-error',
      'Учётная запись отключена. Если это ошибка — напишите в поддержку: support@nirivio.by',
    );
  });

  it('an unknown value prints no raw text — only the general Yandex line', async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ auth_error: '<b>любой текст</b>' }),
      }),
    );
    expect(screen.getByTestId('oauth-buttons')).toHaveAttribute(
      'data-error',
      'Не удалось войти через Яндекс. Попробуйте ещё раз или войдите другим способом.',
    );
  });

  it('no auth_error → no error', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId('oauth-buttons')).toHaveAttribute('data-error', '');
  });
});
