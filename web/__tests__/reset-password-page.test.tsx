/**
 * /reset-password?token=… — the link from the reset email. The token travels
 * search param → page → ResetPasswordForm prop → hidden input → Server
 * Action. auth-form-field-names.test.tsx pins the input's NAME; component and
 * action tests mock their neighbours. This file pins the VALUE along the
 * chain: the token the email carried is the token the form will post — a
 * blank or stale value there turns every reset into «ссылка недействительна».
 *
 * Async RSC pattern (feedback_web_async_rsc_testing): await the page as a
 * function, then render the element.
 */
import { render, screen } from '@testing-library/react';

jest.mock('@/lib/auth/actions', () => ({ resetPasswordAction: jest.fn() }));

import ResetPasswordPage from '@/app/(public)/reset-password/page';

const page = async (params: Record<string, string | string[] | undefined>) =>
  render(await ResetPasswordPage({ searchParams: Promise.resolve(params) }));

it('the token from the link is the value the form posts', async () => {
  const { container } = await page({
    token: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  });

  const hidden = container.querySelector('input[name="token"]');
  expect(hidden).toHaveValue(
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  );
});

it('without a token there is no form — the page offers a new link instead', async () => {
  const { container } = await page({});

  expect(container.querySelector('input[name="token"]')).toBeNull();
  expect(screen.getByRole('link', { name: 'Запросить новую ссылку' })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
});
