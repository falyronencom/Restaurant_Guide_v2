/**
 * (public)/error.tsx — the public error boundary (сверка находок тестировщика
 * с сайтом, 18.10). It printed `error.message`: for a Server Component failure
 * Next puts an English production notice there, and a client exception text
 * is not for visitors either. The page now always speaks Russian; the real
 * error still goes to the operator beacon.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReport = jest.fn();
jest.mock('@/lib/client-error-reporter', () => ({
  reportClientError: (...args: unknown[]) => mockReport(...args),
}));

import PublicError from '@/app/(public)/error';

const NEXT_PROD_MESSAGE =
  'An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockReport.mockClear();
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

it('shows its own Russian text, never the error message', () => {
  render(
    <PublicError error={new Error(NEXT_PROD_MESSAGE)} unstable_retry={jest.fn()} />,
  );

  expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Не удалось загрузить страницу. Попробуйте ещё раз — обычно это помогает.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/An error occurred/)).not.toBeInTheDocument();
});

it('still reports the real error and retries on the button', async () => {
  const retry = jest.fn();
  const error = new Error('TypeError: x is undefined');
  render(<PublicError error={error} unstable_retry={retry} />);

  expect(screen.queryByText(/TypeError/)).not.toBeInTheDocument();
  expect(mockReport).toHaveBeenCalledWith(error);

  await userEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }));
  expect(retry).toHaveBeenCalled();
});
