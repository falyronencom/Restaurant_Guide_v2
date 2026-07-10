/**
 * /verify-email RSC page — static wrapper responsibilities only: the heading,
 * the island, and the noindex metadata. The island is stubbed (its behaviour
 * lives in verify-email-form.test.tsx). No searchParams and no cookies() —
 * the page must stay static-renderable.
 */
import { render, screen } from '@testing-library/react';

jest.mock('@/components/auth/VerifyEmailForm', () => ({
  VerifyEmailForm: () => <div data-testid="verify-email-form" />,
}));

import VerifyEmailPage, { metadata } from '@/app/(public)/verify-email/page';

it('renders the heading and the form island', () => {
  render(<VerifyEmailPage />);

  expect(
    screen.getByRole('heading', { name: 'Подтверждение почты' }),
  ).toBeInTheDocument();
  expect(screen.getByTestId('verify-email-form')).toBeInTheDocument();
});

it('is noindex (utility page, never a search target)', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
