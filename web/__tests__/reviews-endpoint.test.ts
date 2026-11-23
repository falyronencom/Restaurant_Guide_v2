/**
 * Review write encoders (endpoints/reviews.ts) — the request itself.
 *
 * Every other suite mocks this module whole (the review modal, the own-review
 * controls, the review actions), so the request the backend receives was seen
 * by no test. The expectations come from the backend: reviewRoutes.js routes
 * POST /api/v1/reviews and PUT /api/v1/reviews/:id; reviewValidation.js reads
 * camelCase `establishmentId`, `rating`, `content` from the body; and the body
 * is parsed only under Content-Type: application/json (server.js,
 * express.json) — without that header the validator sees an empty body and
 * answers 422, so a review could be neither written nor edited.
 */
jest.mock('@/lib/auth/session', () => ({ authedFetch: jest.fn() }));

import { authedFetch } from '@/lib/auth/session';
import { createReview, updateReview } from '@/lib/api/endpoints/reviews';

const mockAuthedFetch = authedFetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthedFetch.mockResolvedValue({});
});

type Init = { method: string; headers: Record<string, string>; body: string };

describe('review write encoders — the request the backend parses', () => {
  it('a new review is POST /api/v1/reviews, JSON with camelCase establishmentId', async () => {
    await createReview({ establishmentId: 'e-7', rating: 4, content: 'Вкусно' });

    const [path, init] = mockAuthedFetch.mock.calls[0] as [string, Init];
    expect(path).toBe('/api/v1/reviews');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      establishmentId: 'e-7',
      rating: 4,
      content: 'Вкусно',
    });
  });

  it('an edit is PUT /api/v1/reviews/:id, JSON with only the fields given', async () => {
    await updateReview('r/1', { rating: 2 });

    const [path, init] = mockAuthedFetch.mock.calls[0] as [string, Init];
    expect(path).toBe('/api/v1/reviews/r%2F1');
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ rating: 2 });
  });
});

// «Отзыв без текста» (11.2026). The server contract: a review of one rating
// is created with no `content` key (the server also takes '' and null); an
// edit erases the text with content ''.
describe('review without text — the body on the wire', () => {
  it('a review of one rating: the body carries no `content` key at all', async () => {
    await createReview({ establishmentId: 'e-7', rating: 5 });

    const [, init] = mockAuthedFetch.mock.calls[0] as [string, Init];
    const body = JSON.parse(init.body);
    expect(body).toEqual({ establishmentId: 'e-7', rating: 5 });
    expect(body).not.toHaveProperty('content');
  });

  it('an edit that erases the text sends content "" — not dropped, not null', async () => {
    await updateReview('r-1', { rating: 3, content: '' });

    const [, init] = mockAuthedFetch.mock.calls[0] as [string, Init];
    expect(init.body).toBe('{"rating":3,"content":""}');
  });
});
