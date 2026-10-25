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
