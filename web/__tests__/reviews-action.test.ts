/**
 * createReviewAction (reviews-write Slice 1) — mirrors auth-login-action.test.ts.
 * Boundary: createReview (endpoints/reviews) + revalidatePath (next/cache) are
 * mocked. Asserts the forwarded payload, the LITERAL ISR revalidation on success
 * (one page, not a dynamic pattern), and the Russian error mapping for the
 * review-specific codes — 429 RATE_LIMIT_EXCEEDED (NOT the mobile
 * DAILY_QUOTA_EXCEEDED), 409 DUPLICATE_REVIEW, per-field 422, and network.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/reviews', () => ({ createReview: jest.fn() }));

import { revalidatePath } from 'next/cache';

import { createReview } from '@/lib/api/endpoints/reviews';
import { ApiError } from '@/lib/api/types';
import { createReviewAction } from '@/lib/reviews/actions';

const createReviewMock = createReview as jest.Mock;
const revalidatePathMock = revalidatePath as jest.Mock;

const INPUT = {
  establishmentId: '11111111-1111-1111-1111-111111111111',
  rating: 5,
  content: 'Отличное место, вернёмся.',
  detailPath: '/minsk/restorany/some-slug',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createReviewAction — success', () => {
  it('forwards the payload, busts the literal detail path, returns {ok:true}', async () => {
    createReviewMock.mockResolvedValue(undefined);

    const result = await createReviewAction(INPUT);

    expect(createReviewMock).toHaveBeenCalledWith({
      establishmentId: INPUT.establishmentId,
      rating: 5,
      content: 'Отличное место, вернёмся.',
    });
    // Literal path → exactly this one page (a dynamic pattern would need
    // type:'page' and hit every establishment — Discovery Q7).
    expect(revalidatePathMock).toHaveBeenCalledWith('/minsk/restorany/some-slug');
    expect(result).toEqual({ ok: true });
  });
});

describe('createReviewAction — error mapping (never revalidates)', () => {
  it('maps 429 RATE_LIMIT_EXCEEDED to «Слишком часто…» (NOT DAILY_QUOTA)', async () => {
    createReviewMock.mockRejectedValue(
      new ApiError(429, 'Rate limit exceeded', 'RATE_LIMIT_EXCEEDED'),
    );

    const result = await createReviewAction(INPUT);

    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMIT_EXCEEDED' });
    expect((result as { message: string }).message).toMatch(/Слишком часто/);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('maps 409 DUPLICATE_REVIEW to the one-per-establishment message', async () => {
    createReviewMock.mockRejectedValue(
      new ApiError(409, 'Duplicate', 'DUPLICATE_REVIEW'),
    );

    const result = await createReviewAction(INPUT);

    expect(result).toMatchObject({ ok: false, code: 'DUPLICATE_REVIEW' });
    expect((result as { message: string }).message).toMatch(
      /уже оставили отзыв/,
    );
  });

  it('maps 422 VALIDATION_ERROR details (array wire shape) to per-field Russian texts', async () => {
    // Real wire: the backend `validate` middleware emits `details` as an ARRAY
    // [{field, message, value}] (errorHandler.js:198), NOT a {field:[msgs]}
    // object. Pinning the true shape so the mock cannot re-green the old bug.
    createReviewMock.mockRejectedValue(
      new ApiError(422, 'Validation', 'VALIDATION_ERROR', [
        { field: 'content', message: 'Review content is required', value: '' },
      ]),
    );

    const result = await createReviewAction(INPUT);

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
      fieldErrors: { content: expect.stringMatching(/от 1 до 1000/) },
    });
  });

  it('maps a non-ApiError (transport) to NETWORK', async () => {
    createReviewMock.mockRejectedValue(new Error('boom'));

    const result = await createReviewAction(INPUT);

    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
