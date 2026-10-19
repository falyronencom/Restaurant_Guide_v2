/**
 * ReviewsLoadFailed — the detail page's reviews section after the page's own
 * reviews fetch failed (сверка находок тестировщика с сайтом, 18.10, Х5 / Х23).
 *
 * It must (1) try again by itself and show the regular carousel when the
 * reviews arrive, (2) say «Не удалось загрузить отзывы» with «Повторить» when
 * they do not — and never «Пока нет отзывов»: whether there are any is exactly
 * what it does not know. The action and the carousel are mocked (the
 * carousel's own rendering lives in review-carousel.test.tsx).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReload = jest.fn();
jest.mock('@/lib/reviews/actions', () => ({
  reloadReviewsAction: (...args: unknown[]) => mockReload(...args),
}));
jest.mock('@/components/establishment/ReviewCarousel', () => ({
  ReviewCarousel: ({
    reviews,
    totalCount,
  }: {
    reviews: unknown[];
    totalCount: number;
  }) => (
    <div data-testid="carousel">
      {reviews.length}/{totalCount}
    </div>
  ),
}));

import { ReviewsLoadFailed } from '@/components/establishment/ReviewsLoadFailed';

const PROPS = {
  slug: 'kafe-1',
  averageRating: 4.5,
  reviewsHref: '/minsk/restaurants/kafe-1/reviews',
  establishmentId: 'est-1',
  establishmentName: 'Кафе',
  detailPath: '/minsk/restaurants/kafe-1',
};

const REVIEW = { id: 'r1' };

beforeEach(() => {
  jest.clearAllMocks();
});

it('loads the reviews itself and then shows the regular carousel', async () => {
  mockReload.mockResolvedValue({ ok: true, reviews: [REVIEW], total: 9 });
  render(<ReviewsLoadFailed {...PROPS} />);

  expect(screen.getByText('Загружаем отзывы…')).toBeInTheDocument();
  expect(await screen.findByTestId('carousel')).toHaveTextContent('1/9');
  expect(mockReload).toHaveBeenCalledWith({
    slug: 'kafe-1',
    detailPath: '/minsk/restaurants/kafe-1',
  });
});

it('a second failure says so, with «Повторить» — never «Пока нет отзывов»', async () => {
  mockReload.mockResolvedValue({ ok: false });
  render(<ReviewsLoadFailed {...PROPS} />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Не удалось загрузить отзывы.',
  );
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  expect(screen.queryByText(/Пока нет отзывов/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('carousel')).not.toBeInTheDocument();
});

it('an unreachable action (network) is the same failure, not a crash', async () => {
  mockReload.mockRejectedValue(new Error('Failed to fetch'));
  render(<ReviewsLoadFailed {...PROPS} />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Не удалось загрузить отзывы.',
  );
});

it('«Повторить» asks again and shows the reviews once they load', async () => {
  mockReload
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, reviews: [REVIEW, REVIEW], total: 2 });
  render(<ReviewsLoadFailed {...PROPS} />);

  await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }));

  await waitFor(() =>
    expect(screen.getByTestId('carousel')).toHaveTextContent('2/2'),
  );
  expect(mockReload).toHaveBeenCalledTimes(2);
});
