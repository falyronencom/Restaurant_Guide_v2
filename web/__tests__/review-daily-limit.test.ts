/**
 * The eleventh review of a Minsk day on the site (test-honesty audit, Д3;
 * Координатор 19.10: «текст дневного лимита отзывов на сайте»).
 *
 * The server (since #99) refuses the daily quota with 429 RATE_LIMIT_EXCEEDED,
 * a Russian sentence that names the term, `details` { reviews_limit,
 * retry_after, reset_at } and a Retry-After header — the same code as the
 * request-rate limiter, whose details are { limit, window, retry_after }.
 *
 * Wire-level: the bodies below are the server's real envelopes (errorHandler.js
 * puts the sentence at the top level; backend reviews.test.js pins the quota's
 * sentence and details, rateLimiter.js the limiter's). They go through the
 * REAL serverFetch (global fetch mocked) — the same parse the review POST takes
 * via authedFetch → fetchWithBearer — and the error it throws is what
 * createReview rejects with. So the text the visitor reads is checked from the
 * wire, not from a hand-built ApiError.
 *
 * Before: «Слишком часто, попробуйте позже.» for both — wrong for the quota,
 * which renews at Minsk midnight.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/reviews', () => ({
  createReview: jest.fn(),
  updateReview: jest.fn(),
  deleteReview: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getReviews: jest.fn(),
}));

import { revalidatePath } from 'next/cache';

import { serverFetch } from '@/lib/api/client';
import { createReview } from '@/lib/api/endpoints/reviews';
import { createReviewAction } from '@/lib/reviews/actions';

const DAILY_TEXT =
  'Лимит отзывов на сегодня исчерпан: не больше 10 в день. Новый отзыв можно написать завтра.';

/** backend errorHandler.js envelope of AppError(DAILY_REVIEW_LIMIT_TEXT, 429, …). */
const DAILY_BODY = {
  success: false,
  message: DAILY_TEXT,
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    details: {
      reviews_limit: 10,
      retry_after: 18000,
      reset_at: '2026-10-19T21:00:00.000Z',
    },
  },
  timestamp: '2026-10-19T16:00:00.000Z',
};

/** backend rateLimiter.js envelope (request-rate limiter). */
const RATE_BODY = {
  success: false,
  message: 'Слишком много запросов. Попробуйте позже.',
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    details: { limit: 100, window: '15 minutes', retry_after: 120 },
  },
};

const INPUT = {
  establishmentId: '11111111-1111-1111-1111-111111111111',
  rating: 5,
  content: 'Отличное место.',
  detailPath: '/minsk/restorany/some-slug',
};

let savedFetch: typeof global.fetch;
const savedApiUrl = process.env.API_URL;

beforeAll(() => {
  savedFetch = global.fetch;
  process.env.API_URL = 'http://api.test';
});

afterAll(() => {
  global.fetch = savedFetch;
  if (savedApiUrl === undefined) delete process.env.API_URL;
  else process.env.API_URL = savedApiUrl;
});

beforeEach(() => {
  jest.clearAllMocks();
});

/** What serverFetch throws for this 429 body — the real parse. */
async function wireError(body: unknown, retryAfter: string): Promise<unknown> {
  global.fetch = jest.fn().mockResolvedValue({
    status: 429,
    headers: new Map([['Retry-After', retryAfter]]),
    json: async () => body,
  }) as unknown as typeof global.fetch;
  try {
    await serverFetch('/api/v1/reviews', { method: 'POST' });
  } catch (err) {
    return err;
  }
  throw new Error('serverFetch did not throw on a 429');
}

it('the daily quota: the server’s Russian sentence with the term, as is', async () => {
  (createReview as jest.Mock).mockRejectedValue(await wireError(DAILY_BODY, '18000'));

  const result = await createReviewAction(INPUT);

  expect(result).toEqual({
    ok: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: DAILY_TEXT,
  });
  expect(revalidatePath).not.toHaveBeenCalled();
});

it('the daily quota from a server without the Russian sentence: the site’s own text, same term', async () => {
  const englishBody = {
    ...DAILY_BODY,
    message: 'Review rate limit exceeded. You can create up to 10 reviews per day.',
  };
  (createReview as jest.Mock).mockRejectedValue(await wireError(englishBody, '18000'));

  const result = await createReviewAction(INPUT);

  expect(result).toMatchObject({
    ok: false,
    message: 'Лимит отзывов на сегодня исчерпан. Новый отзыв можно написать завтра.',
  });
});

it('the request-rate limiter (same code, no reviews_limit): the site’s «Слишком часто…» as before', async () => {
  (createReview as jest.Mock).mockRejectedValue(await wireError(RATE_BODY, '120'));

  const result = await createReviewAction(INPUT);

  expect(result).toEqual({
    ok: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Слишком часто, попробуйте позже.',
  });
});
