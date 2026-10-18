/**
 * /verify-email RSC page — the heading, the island, the noindex metadata, and
 * (since 18.10) the guarded returnTo handed to the island: the place the
 * visitor registered from, where «Продолжить» and «Позже» lead (сверка находок
 * тестировщика с сайтом, п. 11). The island is stubbed (its behaviour lives in
 * verify-email-form.test.tsx).
 */
import { render, screen } from '@testing-library/react';

jest.mock('@/components/auth/VerifyEmailForm', () => ({
  VerifyEmailForm: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="verify-email-form" data-return-to={returnTo} />
  ),
}));

import VerifyEmailPage, { metadata } from '@/app/(public)/verify-email/page';

it('renders the heading and the form island', async () => {
  render(await VerifyEmailPage({ searchParams: Promise.resolve({}) }));

  expect(
    screen.getByRole('heading', { name: 'Подтверждение почты' }),
  ).toBeInTheDocument();
  expect(screen.getByTestId('verify-email-form')).toHaveAttribute(
    'data-return-to',
    '/',
  );
});

it('hands the guarded returnTo to the island', async () => {
  render(
    await VerifyEmailPage({
      searchParams: Promise.resolve({ returnTo: '/minsk/restorany/kafe-1' }),
    }),
  );

  expect(screen.getByTestId('verify-email-form')).toHaveAttribute(
    'data-return-to',
    '/minsk/restorany/kafe-1',
  );
});

it('collapses an open-redirect returnTo to /', async () => {
  render(
    await VerifyEmailPage({
      searchParams: Promise.resolve({ returnTo: '//evil.com' }),
    }),
  );

  expect(screen.getByTestId('verify-email-form')).toHaveAttribute(
    'data-return-to',
    '/',
  );
});

it('is noindex (utility page, never a search target)', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
