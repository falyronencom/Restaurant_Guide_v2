/**
 * ResetPasswordForm — the password rule is visible from the start (сверка
 * находок тестировщика с сайтом, 18.10, п. 21). Before, the «Новый пароль»
 * field had no hint at all: the rule appeared only after a failed submit. It
 * is now the same grey line as on registration, turning into the red
 * per-field text when the rule fails. The action is mocked.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReset = jest.fn();
jest.mock('@/lib/auth/actions', () => ({
  resetPasswordAction: (...args: unknown[]) => mockReset(...args),
}));

import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

const HINT = 'Минимум 8 символов, заглавная и строчная буквы, цифра.';

beforeEach(() => {
  jest.clearAllMocks();
});

it('shows the password rule before any submit, tied to the field', () => {
  render(<ResetPasswordForm token="t" />);

  const hint = screen.getByText(HINT);
  expect(hint).toHaveClass('text-figma-text-dark');
  expect(screen.getByLabelText('Новый пароль')).toHaveAttribute(
    'aria-describedby',
    hint.id,
  );
});

it('a failed rule replaces the hint with the red per-field text', async () => {
  mockReset.mockResolvedValue({
    ok: false,
    code: 'VALIDATION_ERROR',
    message: 'Проверьте правильность заполнения полей.',
    fieldErrors: { password: 'Пароль: минимум 8 символов, заглавная и строчная буквы, цифра.' },
  });
  render(<ResetPasswordForm token="t" />);

  await userEvent.type(screen.getByLabelText('Новый пароль'), 'short');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }));

  await waitFor(() =>
    expect(
      screen.getByText(
        'Пароль: минимум 8 символов, заглавная и строчная буквы, цифра.',
      ),
    ).toHaveClass('text-destructive'),
  );
  expect(screen.queryByText(HINT)).not.toBeInTheDocument();
});
