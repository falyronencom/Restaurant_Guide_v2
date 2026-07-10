/**
 * WriteReviewModal — controlled form: the client-side validation guard, the
 * submit payload (trimmed content), the success callback, and mapped-error
 * rendering. The Server Actions are mocked (their own mapping is covered in
 * reviews-action.test.ts); the real base-ui dialog renders under jsdom via
 * the ResizeObserver/PointerEvent polyfills in jest.setup.
 *
 * Slice 2: edit mode (editTarget prop) — pre-fill, retitle, and routing to
 * updateReviewAction — is covered alongside the unchanged create contract.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/reviews/actions', () => ({
  createReviewAction: (...args: unknown[]) => mockCreate(...args),
  updateReviewAction: (...args: unknown[]) => mockUpdate(...args),
}));

import { WriteReviewModal } from '@/components/establishment/WriteReviewModal';

const mockOnOpenChange = jest.fn();
const mockOnSuccess = jest.fn();

function renderModal() {
  return render(
    <WriteReviewModal
      open
      onOpenChange={mockOnOpenChange}
      establishmentId="est-1"
      establishmentName="Цифровой мир"
      detailPath="/minsk/restorany/some-slug"
      onSuccess={mockOnSuccess}
    />,
  );
}

const EDIT_TARGET = {
  reviewId: 'r-1',
  rating: 4,
  content: 'Отличное место, вернёмся ещё.',
};

function renderEditModal() {
  return render(
    <WriteReviewModal
      open
      onOpenChange={mockOnOpenChange}
      establishmentId="est-1"
      establishmentName="Цифровой мир"
      detailPath="/minsk/restorany/some-slug"
      onSuccess={mockOnSuccess}
      editTarget={EDIT_TARGET}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('renders the establishment name and the character counter', () => {
  renderModal();
  expect(screen.getByText(/Заведение: «Цифровой мир»/)).toBeInTheDocument();
  expect(screen.getByText('0 / 1000')).toBeInTheDocument();
});

it('blocks submit with no rating / empty content and does NOT call the action', async () => {
  renderModal();

  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

  expect(mockCreate).not.toHaveBeenCalled();
  expect(screen.getByText('Поставьте оценку от 1 до 5.')).toBeInTheDocument();
  expect(screen.getByText('Напишите текст отзыва.')).toBeInTheDocument();
});

it('submits the rating + trimmed content and fires onSuccess', async () => {
  mockCreate.mockResolvedValue({ ok: true });
  renderModal();

  await userEvent.click(screen.getByRole('button', { name: 'Оценка 5 из 5' }));
  await userEvent.type(screen.getByLabelText('Отзыв'), '  Отлично  ');
  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

  expect(mockCreate).toHaveBeenCalledWith({
    establishmentId: 'est-1',
    rating: 5,
    content: 'Отлично',
    detailPath: '/minsk/restorany/some-slug',
  });
  expect(mockOnSuccess).toHaveBeenCalled();
});

it('renders a mapped summary error and keeps the modal open on failure', async () => {
  mockCreate.mockResolvedValue({
    ok: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Слишком часто, попробуйте позже.',
  });
  renderModal();

  await userEvent.click(screen.getByRole('button', { name: 'Оценка 4 из 5' }));
  await userEvent.type(screen.getByLabelText('Отзыв'), 'Норм');
  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

  expect(
    await screen.findByText('Слишком часто, попробуйте позже.'),
  ).toBeInTheDocument();
  expect(mockOnSuccess).not.toHaveBeenCalled();
});

describe('edit mode (editTarget)', () => {
  it('pre-fills the stars + content and retitles to «Редактировать отзыв» / «Сохранить»', () => {
    renderEditModal();

    expect(screen.getByText('Редактировать отзыв')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Оценка 4 из 5' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Отзыв')).toHaveValue(
      'Отличное место, вернёмся ещё.',
    );
    // Live counter reflects the pre-filled length, not 0.
    expect(
      screen.getByText(`${EDIT_TARGET.content.length} / 1000`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Сохранить' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Опубликовать' }),
    ).not.toBeInTheDocument();
  });

  it('routes submit to updateReviewAction with the review id (create action untouched)', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    renderEditModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'Оценка 5 из 5' }),
    );
    const textarea = screen.getByLabelText('Отзыв');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, '  Стало ещё лучше  ');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      reviewId: 'r-1',
      rating: 5,
      content: 'Стало ещё лучше',
      detailPath: '/minsk/restorany/some-slug',
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockOnSuccess).toHaveBeenCalled();
  });

  it('keeps the client guard in edit mode: clearing the content blocks submit', async () => {
    renderEditModal();

    await userEvent.clear(screen.getByLabelText('Отзыв'));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Напишите текст отзыва.')).toBeInTheDocument();
  });
});
