/**
 * A new review is taken only on a card the catalogue shows (backend,
 * 19.10.2026): any other status is refused with 400 ESTABLISHMENT_NOT_ACTIVE.
 * The detail page is ISR-cached, so a card suspended after the render still
 * shows the form; the site words the refusal itself (per-code map in
 * lib/reviews/actions.ts) — without the case it fell to the generic
 * «Не удалось отправить отзыв. Попробуйте позже.», which promises a retry
 * that cannot help. Wire values recorded from the backend integration test
 * (integration/review-establishment-status.test.js).
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/reviews', () => ({
  createReview: jest.fn(),
  updateReview: jest.fn(),
  deleteReview: jest.fn(),
}));

import { revalidatePath } from 'next/cache';

import { createReview } from '@/lib/api/endpoints/reviews';
import { ApiError } from '@/lib/api/types';
import { createReviewAction } from '@/lib/reviews/actions';

const createReviewMock = createReview as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

it('maps 400 ESTABLISHMENT_NOT_ACTIVE to the catalogue refusal, without revalidating', async () => {
  createReviewMock.mockRejectedValue(
    new ApiError(
      400,
      'Это заведение сейчас не показывается в каталоге — оставить отзыв нельзя',
      'ESTABLISHMENT_NOT_ACTIVE',
    ),
  );

  const result = await createReviewAction({
    establishmentId: '11111111-1111-1111-1111-111111111111',
    rating: 5,
    content: 'Отличное место, вернёмся.',
    detailPath: '/minsk/restorany/some-slug',
  });

  expect(result).toEqual({
    ok: false,
    code: 'ESTABLISHMENT_NOT_ACTIVE',
    message: 'Это заведение сейчас не показывается в каталоге — оставить отзыв нельзя.',
  });
  expect(revalidatePath).not.toHaveBeenCalled();
});
