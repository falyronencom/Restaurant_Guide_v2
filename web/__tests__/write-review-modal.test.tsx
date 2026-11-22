/**
 * WriteReviewModal — controlled form: the client-side validation guard, the
 * submit payload (trimmed content), the success callback, and mapped-error
 * rendering. The Server Actions are mocked (their own mapping is covered in
 * reviews-action.test.ts); the real base-ui dialog renders under jsdom via
 * the ResizeObserver/PointerEvent polyfills in jest.setup.
 *
 * Slice 2: edit mode (editTarget prop) — pre-fill, retitle, and routing to
 * updateReviewAction — is covered alongside the unchanged create contract.
 *
 * «Отзыв без текста» (11.2026): the text is optional — a rating alone is a
 * review (В6). Create without text passes no `content` key; an edit with the
 * text erased passes `content: ''` («стереть текст», В5). The two former
 * «text is required» cases are turned around.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockResend = jest.fn();
const mockPush = jest.fn();
jest.mock('@/lib/reviews/actions', () => ({
  createReviewAction: (...args: unknown[]) => mockCreate(...args),
  updateReviewAction: (...args: unknown[]) => mockUpdate(...args),
}));
// The server's refusal EMAIL_NOT_VERIFIED shows «Отправить код»
// (VerifyEmailToReview): the resend action and the router are its boundary.
jest.mock('@/lib/auth/actions', () => ({
  resendVerificationCodeAction: (...args: unknown[]) => mockResend(...args),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
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

it('labels the text optional and keeps the hint under it (В6)', () => {
  renderModal();

  const field = screen.getByLabelText('Отзыв (необязательно)');
  const hintId = field.getAttribute('aria-describedby');
  expect(hintId).toBeTruthy();
  expect(document.getElementById(hintId as string)).toHaveTextContent(
    'Текст можно не писать: достаточно оценки',
  );
});

it('without a rating blocks submit on the rating alone — no text is not an error', async () => {
  renderModal();

  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

  expect(mockCreate).not.toHaveBeenCalled();
  expect(screen.getByText('Поставьте оценку от 1 до 5.')).toBeInTheDocument();
  expect(screen.queryByText('Напишите текст отзыва.')).not.toBeInTheDocument();
  // The hint stays in place of a text error.
  expect(
    screen.getByText('Текст можно не писать: достаточно оценки'),
  ).toBeInTheDocument();
});

it.each([
  ['no text at all', ''],
  ['spaces only', '   '],
])(
  'a rating alone is a review (%s): submits with no `content` key',
  async (_label, typed) => {
    mockCreate.mockResolvedValue({ ok: true });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Оценка 4 из 5' }));
    if (typed) {
      await userEvent.type(screen.getByLabelText('Отзыв (необязательно)'), typed);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sent = mockCreate.mock.calls[0][0];
    // toStrictEqual: an explicit `content: undefined` or '' would not pass.
    expect(sent).toStrictEqual({
      establishmentId: 'est-1',
      rating: 4,
      detailPath: '/minsk/restorany/some-slug',
    });
    expect(sent).not.toHaveProperty('content');
    expect(mockOnSuccess).toHaveBeenCalled();
  },
);

it('submits the rating + trimmed content and fires onSuccess', async () => {
  mockCreate.mockResolvedValue({ ok: true });
  renderModal();

  await userEvent.click(screen.getByRole('button', { name: 'Оценка 5 из 5' }));
  await userEvent.type(screen.getByLabelText('Отзыв (необязательно)'), '  Отлично  ');
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
  await userEvent.type(screen.getByLabelText('Отзыв (необязательно)'), 'Норм');
  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

  expect(
    await screen.findByText('Слишком часто, попробуйте позже.'),
  ).toBeInTheDocument();
  expect(mockOnSuccess).not.toHaveBeenCalled();
});

// The server's refusal of the text itself (мат — reviewValidation, 17.10.2026;
// the length) comes as a field error: it takes the hint's place under the
// field, marks the field invalid, and is what the field's description says.
it('a refusal of the text shows under the field in place of the hint, the field marked invalid', async () => {
  const refusal = 'Текст содержит нецензурные выражения — уберите их, пожалуйста';
  mockCreate.mockResolvedValue({
    ok: false,
    code: 'VALIDATION_ERROR',
    message: 'Проверьте правильность заполнения полей.',
    fieldErrors: { content: refusal },
  });
  renderModal();

  await userEvent.click(screen.getByRole('button', { name: 'Оценка 1 из 5' }));
  await userEvent.type(screen.getByLabelText('Отзыв (необязательно)'), 'текст');
  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

  const field = screen.getByLabelText('Отзыв (необязательно)');
  expect(await screen.findByText(refusal)).toBeInTheDocument();
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(
    document.getElementById(field.getAttribute('aria-describedby') as string),
  ).toHaveTextContent(refusal);
  expect(
    screen.queryByText('Текст можно не писать: достаточно оценки'),
  ).not.toBeInTheDocument();
  expect(mockOnSuccess).not.toHaveBeenCalled();
});

// A new review only with a confirmed address (В9): the server's refusal
// shows the same words as the check before the form, with «Отправить код» —
// the code is sent, then the code page opens with the way back to the card.
it('the refusal EMAIL_NOT_VERIFIED: the В9 words and «Отправить код» → the code page with the way back', async () => {
  const text =
    'Чтобы оставить отзыв, подтвердите почту — пришлём код на guest@example.com';
  mockCreate.mockResolvedValue({
    ok: false,
    code: 'EMAIL_NOT_VERIFIED',
    message: text,
  });
  mockResend.mockResolvedValue({ ok: true, message: 'Мы отправили новый код на вашу почту.' });
  renderModal();

  await userEvent.click(screen.getByRole('button', { name: 'Оценка 2 из 5' }));
  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

  // Once — as the gate's words, not again as a summary error.
  expect(await screen.findAllByText(text)).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Отправить код' }));

  expect(mockResend).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith(
    '/verify-email?returnTo=%2Fminsk%2Frestorany%2Fsome-slug',
  );
  expect(mockOnSuccess).not.toHaveBeenCalled();
});

describe('edit mode (editTarget)', () => {
  it('pre-fills the stars + content and retitles to «Редактировать отзыв» / «Сохранить»', () => {
    renderEditModal();

    expect(screen.getByText('Редактировать отзыв')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Оценка 4 из 5' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Отзыв (необязательно)')).toHaveValue(
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
    const textarea = screen.getByLabelText('Отзыв (необязательно)');
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

  it('erasing the text saves the rating alone: content "" means «стереть текст» (В5)', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    renderEditModal();

    await userEvent.clear(screen.getByLabelText('Отзыв (необязательно)'));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toStrictEqual({
      reviewId: 'r-1',
      rating: 4,
      content: '',
      detailPath: '/minsk/restorany/some-slug',
    });
    expect(screen.queryByText('Напишите текст отзыва.')).not.toBeInTheDocument();
    expect(mockOnSuccess).toHaveBeenCalled();
  });
});
