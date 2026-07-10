/**
 * ReviewCarousel — SYNC Server Component (Brief 4 / Phase A; reviews-write
 * Slice 1 update).
 *
 * SHAPE-CONTRACT focus: the «Все N отзывов →» link branch. Its condition
 * (read from source) is:
 *     reviewsHref != null && totalCount > reviews.length
 * i.e. the "shown count" threshold is the LENGTH of the reviews array passed in,
 * not a hardcoded literal. The link text is `Все ${pluralizeReviews(N)} →`.
 *
 * The write-review CTA is a client island (useAuth → needs AuthProvider); it is
 * stubbed here to a labelled button — its ownership behaviour lives in
 * write-review-cta.test.tsx. Slice 1 guard update: the CTA is now a button
 * (was a role=link Link in the footer).
 */
import { render, screen } from '@testing-library/react';

import { ReviewCarousel } from '@/components/establishment/ReviewCarousel';
import type { PublicReview } from '@/lib/api/types';

jest.mock('@/components/establishment/WriteReviewCta', () => ({
  WriteReviewCta: () => <button type="button">Оставить отзыв</button>,
}));

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

// Establishment props added in Slice 1 (threaded to the CTA island).
const EST_PROPS = {
  establishmentId: 'est-1',
  establishmentName: 'Тест',
  detailPath: '/minsk/restorany/some-slug',
};

describe('ReviewCarousel — "Все N отзывов →" link', () => {
  it('renders the all-reviews link when reviewsHref is set AND totalCount > shown count', () => {
    render(
      <ReviewCarousel
        reviews={THREE_REVIEWS}
        totalCount={12}
        averageRating={4.7}
        reviewsHref='/minsk/restorany/some-slug/reviews'
        {...EST_PROPS}
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
        {...EST_PROPS}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('omits the «Все N» link when totalCount == shown, but the write-review CTA renders as a button (link→button guard)', () => {
    render(
      <ReviewCarousel
        reviews={THREE_REVIEWS}
        totalCount={3} // equals reviews.length → nothing more to show
        averageRating={4.7}
        reviewsHref='/minsk/restorany/some-slug/reviews'
        {...EST_PROPS}
      />,
    );

    // reviewsHref is truthy but totalCount == shown → no «Все N» link.
    expect(
      screen.queryByRole('link', { name: /^Все/ }),
    ).not.toBeInTheDocument();
    // The «Оставить отзыв» CTA is now a button, not a role=link (Slice 1 guard).
    expect(
      screen.getByRole('button', { name: 'Оставить отзыв' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Оставить отзыв' }),
    ).not.toBeInTheDocument();
  });
});
