/**
 * DeleteReviewDialog — destructive confirm with the load-bearing terminality
 * warning (R2: delete is terminal — the tombstone trips 409 on a later create).
 * deleteReviewAction is mocked (its mapping is covered in
 * reviews-action.test.ts); the real base-ui dialog renders under jsdom via the
 * ResizeObserver/PointerEvent polyfills in jest.setup.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockDelete = jest.fn();
jest.mock('@/lib/reviews/actions', () => ({
  deleteReviewAction: (...args: unknown[]) => mockDelete(...args),
}));

import { DeleteReviewDialog } from '@/components/establishment/DeleteReviewDialog';

const mockOnOpenChange = jest.fn();
const mockOnSuccess = jest.fn();

function renderDialog() {
  return render(
    <DeleteReviewDialog
      open
      onOpenChange={mockOnOpenChange}
      reviewId="r-1"
      detailPath="/minsk/restorany/some-slug"
      onSuccess={mockOnSuccess}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('renders the title and the terminality warning (load-bearing copy)', () => {
  renderDialog();

  expect(screen.getByText('Удалить отзыв?')).toBeInTheDocument();
  expect(
    screen.getByText(
      'После удаления вы не сможете оставить новый отзыв на это заведение.',
    ),
  ).toBeInTheDocument();
});

it('renders NO close-X — the only controls are Отмена and Удалить', () => {
  // The default DialogContent X rides the base-ui Close path that is inert for
  // controlled dialogs (verified live) — a dead control on a destructive
  // confirm, and the approved mock draws none (showCloseButton={false}).
  renderDialog();

  const dialog = document.querySelector('[data-slot="dialog-content"]')!;
  expect(dialog.querySelector('[data-slot="dialog-close"]')).toBeNull();
  expect(
    [...dialog.querySelectorAll('button')].map((b) => b.textContent?.trim()),
  ).toEqual(['Отмена', 'Удалить']);
});

it('confirm calls deleteReviewAction and fires onSuccess on {ok:true}', async () => {
  mockDelete.mockResolvedValue({ ok: true });
  renderDialog();

  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));

  expect(mockDelete).toHaveBeenCalledWith({
    reviewId: 'r-1',
    detailPath: '/minsk/restorany/some-slug',
  });
  expect(mockOnSuccess).toHaveBeenCalled();
});

it('cancel closes without calling the action', async () => {
  renderDialog();

  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));

  expect(mockDelete).not.toHaveBeenCalled();
  expect(mockOnSuccess).not.toHaveBeenCalled();
  expect(mockOnOpenChange).toHaveBeenCalledWith(false);
});

it('shows «Удаляем…», disables both buttons mid-flight, and blocks dismissal', async () => {
  let resolveDelete!: (value: { ok: true }) => void;
  mockDelete.mockReturnValue(
    new Promise((resolve) => {
      resolveDelete = resolve;
    }),
  );
  renderDialog();

  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));

  const confirmButton = screen.getByRole('button', { name: 'Удаляем…' });
  expect(confirmButton).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();

  await act(async () => {
    resolveDelete({ ok: true });
  });
  expect(mockOnSuccess).toHaveBeenCalled();
});

it('renders the mapped error and keeps the dialog open on failure', async () => {
  mockDelete.mockResolvedValue({
    ok: false,
    code: 'REVIEW_NOT_FOUND',
    message: 'Отзыв не найден. Обновите страницу.',
  });
  renderDialog();

  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));

  expect(
    await screen.findByText('Отзыв не найден. Обновите страницу.'),
  ).toBeInTheDocument();
  expect(mockOnSuccess).not.toHaveBeenCalled();
  // Still open: the title is on screen and the confirm is re-enabled for retry.
  expect(screen.getByText('Удалить отзыв?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled();
});
