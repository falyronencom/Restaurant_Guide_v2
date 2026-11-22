/**
 * The author's own review of one rating on the establishment card (Trunk's
 * decision 22.11.2026, bringing В1 and В5 together), end to end through the
 * real islands: ReviewCarousel → OnlyForAuthor → ReviewCard + OwnReviewControls
 * (→ WriteReviewModal / DeleteReviewDialog), and WriteReviewCta. Only the
 * session (useAuth), the router and the Server Actions are mocked.
 *
 * The four checks Trunk named:
 *   1. the author sees the review on the card, with «Редактировать» and
 *      «Удалить», and «Ваш отзыв» in place of the review button;
 *   2. any other visitor does not see it there;
 *   3. after «стёр текст и сохранил» it stays on the author's card and can be
 *      edited and deleted (the state after the save: content null,
 *      is_edited — the refreshed page puts it among `authorOnly`, which
 *      establishment-reviews-failure.test.tsx pins for the page);
 *   4. the author gets no second «Оставить отзыв».
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PublicReview } from '@/lib/api/types';

let mockUser: { id: string; email: string } | null = null;
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: mockUser !== null,
    requestLogin: jest.fn(),
  }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/lib/reviews/actions', () => ({
  createReviewAction: jest.fn(),
  updateReviewAction: jest.fn(),
  deleteReviewAction: jest.fn(),
}));
jest.mock('@/lib/auth/actions', () => ({
  resendVerificationCodeAction: jest.fn(),
}));
jest.mock('@/lib/account/client', () => ({ loadProfile: jest.fn() }));

import { ReviewCarousel } from '@/components/establishment/ReviewCarousel';

function review(
  id: string,
  content: string | null,
  extra: Partial<PublicReview> = {},
): PublicReview {
  return {
    id,
    establishment_id: 'est-1',
    rating: 5,
    content,
    partner_response: null,
    partner_response_at: null,
    is_edited: false,
    created_at: '2026-11-20T10:00:00.000Z',
    updated_at: '2026-11-20T10:00:00.000Z',
    author: { id: `u-${id}`, name: `Автор ${id}`, avatar_url: null },
    ...extra,
  };
}

// The author's review after «стёр текст и сохранил»: rating kept, no text,
// marked edited.
const OWN = review('own', null, { rating: 3, is_edited: true });
const WITH_TEXT = review('a', 'Вкусно и уютно');

const CARD = {
  totalCount: 2,
  averageRating: 4,
  reviewsHref: '/minsk/restorany/test/reviews',
  establishmentId: 'est-1',
  establishmentName: 'Тестовое заведение',
  detailPath: '/minsk/restorany/test',
};

const renderCard = (reviews: PublicReview[] = [WITH_TEXT]) =>
  render(<ReviewCarousel reviews={reviews} authorOnly={[OWN]} {...CARD} />);

const ownCard = () => screen.getByText('Автор own').closest('article') as HTMLElement;

beforeEach(() => {
  mockUser = null;
});

it('1, 4: the author sees their own review of one rating with «Редактировать» and «Удалить», and «Ваш отзыв» — no second «Оставить отзыв»', () => {
  mockUser = { id: 'u-own', email: 'own@example.com' };
  renderCard();

  expect(within(ownCard()).getByRole('button', { name: 'Редактировать' })).toBeInTheDocument();
  expect(within(ownCard()).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  expect(screen.getByText('Ваш отзыв')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Оставить отзыв/ }),
  ).not.toBeInTheDocument();
  // The review with text is there for the author too, without the buttons.
  const other = screen.getByText('Автор a').closest('article') as HTMLElement;
  expect(within(other).queryByRole('button', { name: 'Редактировать' })).not.toBeInTheDocument();
});

it('2: another signed-in visitor and a guest do not see it — the card by В1, «Оставить отзыв» as usual', () => {
  mockUser = { id: 'u-someone', email: 'someone@example.com' };
  const { unmount } = renderCard();

  expect(screen.queryByText('Автор own')).not.toBeInTheDocument();
  expect(screen.getByText('Автор a')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Оставить отзыв/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Редактировать' })).not.toBeInTheDocument();
  unmount();

  mockUser = null;
  renderCard();
  expect(screen.queryByText('Автор own')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Оставить отзыв/ })).toBeInTheDocument();
});

it('3: after «стёр текст и сохранил» it stays on the author\'s card — the edit opens with the rating and no text, the delete asks', async () => {
  mockUser = { id: 'u-own', email: 'own@example.com' };
  renderCard();

  expect(within(ownCard()).getByText(/изменён/)).toBeInTheDocument();
  await userEvent.click(within(ownCard()).getByRole('button', { name: 'Редактировать' }));
  expect(await screen.findByText('Редактировать отзыв')).toBeInTheDocument();
  expect(screen.getByLabelText('Отзыв (необязательно)')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'Оценка 3 из 5' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  await userEvent.click(within(ownCard()).getByRole('button', { name: 'Удалить' }));
  expect(await screen.findByText('Удалить отзыв?')).toBeInTheDocument();
});

it('ratings only: the author sees «Пока только оценки» and, under it, their own review with the buttons', () => {
  mockUser = { id: 'u-own', email: 'own@example.com' };
  render(<ReviewCarousel reviews={[]} authorOnly={[OWN]} {...CARD} totalCount={1} />);

  expect(screen.getByText('Пока только оценки')).toBeInTheDocument();
  expect(within(ownCard()).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  expect(screen.getByText('Ваш отзыв')).toBeInTheDocument();
});
