/**
 * ReviewCarousel — SYNC Server Component (Brief 4 / Phase A).
 *
 * Plain prop-taking component (no top-level await) → render directly with RTL.
 * ReviewCard children (next/image + lucide-react) render fine under jsdom, so
 * no child mocks are needed — same approach as the existing city-page test
 * rendering real synchronous children.
 *
 * SHAPE-CONTRACT focus: the «Все N отзывов →» link is the only branch under
 * test. Its condition (read from source) is:
 *     reviewsHref != null && totalCount > reviews.length
 * i.e. the "shown count" threshold is the LENGTH of the reviews array passed
 * in, not a hardcoded literal. The link text is `Все ${pluralizeReviews(N)} →`.
 */
import { render, screen } from '@testing-library/react';

import { ReviewCarousel } from '@/components/establishment/ReviewCarousel';
import type { PublicReview } from '@/lib/api/types';

function makeReview(id: string): PublicReview {
  return {
    id,
    establishment_id: 'est-1',
    rating: 5,
    content: `Отзыв ${id}`,
    partner_response: null,
    partner_response_at: null,
    is_edited: false,
    created_at: '2026-05-12T10:00:00.000Z',
    updated_at: '2026-05-12T10:00:00.000Z',
    author: { id: `u-${id}`, name: `Автор ${id}`, avatar_url: null },
  };
}

const THREE_REVIEWS = [makeReview('a'), makeReview('b'), makeReview('c')];

describe('ReviewCarousel — "Все N отзывов →" link', () => {
  it('renders the all-reviews link when reviewsHref is set AND totalCount > shown count', () => {
    render(
      <ReviewCarousel
        reviews={THREE_REVIEWS}
        totalCount={12}
        averageRating={4.7}
        reviewsHref='/minsk/restorany/some-slug/reviews'
      />,
    );

    // pluralizeReviews(12) → '12 отзывов'; arrow suffix preserved.
    const link = screen.getByRole('link', { name: 'Все 12 отзывов →' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'href',
      '/minsk/restorany/some-slug/reviews',
    );
  });

  it('omits the link when reviewsHref is undefined, even with a large totalCount (backward-compat)', () => {
    render(
      <ReviewCarousel
        reviews={THREE_REVIEWS}
        totalCount={999}
        averageRating={4.7}
        // reviewsHref intentionally omitted (legacy callers)
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('omits the link when reviewsHref is set but totalCount does not exceed the shown count', () => {
    render(
      <ReviewCarousel
        reviews={THREE_REVIEWS}
        totalCount={3} // equals reviews.length → nothing more to show
        averageRating={4.7}
        reviewsHref='/minsk/restorany/some-slug/reviews'
      />,
    );

    // reviewsHref is truthy but totalCount == shown → no «Все N» link; the
    // «Оставить отзыв» CTA still renders (it links to the reviews route).
    expect(
      screen.queryByRole('link', { name: /^Все/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Оставить отзыв' }),
    ).toBeInTheDocument();
  });
});
