/**
 * @jest-environment node
 */
/*
 * getReviews (endpoints/establishments.ts) — the address the server reads.
 *
 * «Отзыв без текста» (11.2026): the detail page asks for the first reviews
 * with text only. The server contract names the parameter `with_text=true`
 * on GET /public/establishments/by-slug/:slug/reviews; without it the list is
 * as before (every review). The page and action tests mock getReviews whole,
 * so only this suite sees the query string the server actually gets. Mock
 * boundary: serverFetch (the transport), as in live-cities.test.ts.
 */
import { serverFetch } from '@/lib/api/client';
import { getReviews } from '@/lib/api/endpoints/establishments';

jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

const mockServerFetch = serverFetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockServerFetch.mockResolvedValue({ reviews: [], pagination: {} });
});

it('the first reviews with text: ?limit=5&with_text=true', async () => {
  await getReviews('kafe-1', { limit: 5, with_text: true });

  expect(mockServerFetch.mock.calls[0][0]).toBe(
    '/api/v1/public/establishments/by-slug/kafe-1/reviews?limit=5&with_text=true',
  );
});

// The encoder adds nothing of its own: params without with_text (the full
// list's — pinned in reviews-page.test.tsx) give an address without it.
it('params without with_text give an address without it', async () => {
  await getReviews('kafe-1', { page: 2, limit: 10 });

  expect(mockServerFetch.mock.calls[0][0]).toBe(
    '/api/v1/public/establishments/by-slug/kafe-1/reviews?page=2&limit=10',
  );
});
