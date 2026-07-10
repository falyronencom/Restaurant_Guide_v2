/**
 * Review Server Actions (Slice 1 create + Slice 2 edit/delete) — mirrors
 * auth-login-action.test.ts. Boundary: the endpoints (endpoints/reviews) +
 * revalidatePath (next/cache) are mocked. Asserts the forwarded payloads, the
 * LITERAL ISR revalidation on success only (one page, not a dynamic pattern),
 * and the Russian error mapping per action — create: 429 RATE_LIMIT_EXCEEDED
 * (NOT the mobile DAILY_QUOTA_EXCEEDED), 409 DUPLICATE_REVIEW, per-field 422,
 * network; edit/delete: the ownership 403s + 404 (409/429 unreachable there —
 * duplicate check and daily quota are create-only).
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/reviews', () => ({
  createReview: jest.fn(),
  updateReview: jest.fn(),
  deleteReview: jest.fn(),
}));

import { revalidatePath } from 'next/cache';

import {
  createReview,
  deleteReview,
  updateReview,
} from '@/lib/api/endpoints/reviews';
import { ApiError } from '@/lib/api/types';
import {
  createReviewAction,
  deleteReviewAction,
  updateReviewAction,
} from '@/lib/reviews/actions';

const createReviewMock = createReview as jest.Mock;
const updateReviewMock = updateReview as jest.Mock;
const deleteReviewMock = deleteReview as jest.Mock;
const revalidatePathMock = revalidatePath as jest.Mock;

const INPUT = {
  establishmentId: '11111111-1111-1111-1111-111111111111',
  rating: 5,
  content: 'Отличное место, вернёмся.',
  detailPath: '/minsk/restorany/some-slug',
};

const UPDATE_INPUT = {
  reviewId: '22222222-2222-2222-2222-222222222222',
  rating: 4,
  content: 'Стало ещё лучше.',
  detailPath: '/minsk/restorany/some-slug',
};

const DELETE_INPUT = {
  reviewId: '22222222-2222-2222-2222-222222222222',
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

describe('updateReviewAction — success', () => {
  it('forwards id + both fields, busts the literal detail path, returns {ok:true}', async () => {
    updateReviewMock.mockResolvedValue(undefined);

    const result = await updateReviewAction(UPDATE_INPUT);

    expect(updateReviewMock).toHaveBeenCalledWith(UPDATE_INPUT.reviewId, {
      rating: 4,
      content: 'Стало ещё лучше.',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/minsk/restorany/some-slug',
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('updateReviewAction — error mapping (never revalidates)', () => {
  it('maps the ownership 403 UNAUTHORIZED_REVIEW_MODIFICATION', async () => {
    updateReviewMock.mockRejectedValue(
      new ApiError(403, 'Forbidden', 'UNAUTHORIZED_REVIEW_MODIFICATION'),
    );

    const result = await updateReviewAction(UPDATE_INPUT);

    expect(result).toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED_REVIEW_MODIFICATION',
    });
    expect((result as { message: string }).message).toMatch(
      /только свой отзыв/,
    );
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('maps 404 REVIEW_NOT_FOUND', async () => {
    updateReviewMock.mockRejectedValue(
      new ApiError(404, 'Not found', 'REVIEW_NOT_FOUND'),
    );

    const result = await updateReviewAction(UPDATE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'REVIEW_NOT_FOUND' });
    expect((result as { message: string }).message).toMatch(
      /Отзыв не найден/,
    );
  });

  it('maps 422 array details to per-field texts (same shared validate mw as create)', async () => {
    updateReviewMock.mockRejectedValue(
      new ApiError(422, 'Validation', 'VALIDATION_ERROR', [
        { field: 'rating', message: 'Rating must be 1-5', value: 9 },
      ]),
    );

    const result = await updateReviewAction(UPDATE_INPUT);

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
      fieldErrors: { rating: expect.stringMatching(/от 1 до 5/) },
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('maps a non-ApiError (transport) to NETWORK', async () => {
    updateReviewMock.mockRejectedValue(new Error('boom'));

    const result = await updateReviewAction(UPDATE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe('deleteReviewAction — success', () => {
  it('forwards the id, busts the literal detail path, returns {ok:true}', async () => {
    deleteReviewMock.mockResolvedValue(undefined);

    const result = await deleteReviewAction(DELETE_INPUT);

    expect(deleteReviewMock).toHaveBeenCalledWith(DELETE_INPUT.reviewId);
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/minsk/restorany/some-slug',
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('deleteReviewAction — error mapping (never revalidates)', () => {
  it('maps the ownership 403 UNAUTHORIZED_REVIEW_DELETION', async () => {
    deleteReviewMock.mockRejectedValue(
      new ApiError(403, 'Forbidden', 'UNAUTHORIZED_REVIEW_DELETION'),
    );

    const result = await deleteReviewAction(DELETE_INPUT);

    expect(result).toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED_REVIEW_DELETION',
    });
    expect((result as { message: string }).message).toMatch(
      /только свой отзыв/,
    );
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('maps 404 REVIEW_NOT_FOUND (also the already-deleted case)', async () => {
    deleteReviewMock.mockRejectedValue(
      new ApiError(404, 'Not found', 'REVIEW_NOT_FOUND'),
    );

    const result = await deleteReviewAction(DELETE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'REVIEW_NOT_FOUND' });
    expect((result as { message: string }).message).toMatch(
      /Отзыв не найден/,
    );
  });

  it('maps a non-ApiError (transport) to NETWORK', async () => {
    deleteReviewMock.mockRejectedValue(new Error('boom'));

    const result = await deleteReviewAction(DELETE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
