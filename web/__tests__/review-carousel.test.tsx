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
  // data-reviews: the reviews the CTA reads «Ваш отзыв» from.
  WriteReviewCta: ({ reviews }: { reviews: { id: string }[] }) => (
    <button type="button" data-reviews={reviews.map((r) => r.id).join(',')}>
      Оставить отзыв
    </button>
  ),
}));
// The author-only gate (useAuth) is replaced by a marked wrapper: what it
// wraps, and for whom — its own behaviour lives in author-only-reviews.test.tsx.
jest.mock('@/components/establishment/OnlyForAuthor', () => ({
  OnlyForAuthor: ({
    authorIds,
    children,
  }: {
    authorIds: (string | null)[];
    children: React.ReactNode;
  }) => (
    <div data-testid="only-for-author" data-authors={authorIds.join(',')}>
      {children}
    </div>
  ),
}));
// Slice 2: every card also carries the OwnReviewControls island (useAuth →
// needs AuthProvider); stubbed out — its ownership behaviour lives in
// own-review-controls.test.tsx.
jest.mock('@/components/establishment/OwnReviewControls', () => ({
  OwnReviewControls: () => null,
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

/*
 * «Отзыв без текста» (11.2026, В1 = А): `reviews` are the first reviews with
 * text, `totalCount` is the card's review_count (every review). A card whose
 * reviews are all ratings without text gets an empty list and a count.
 */
describe('ReviewCarousel — a card with ratings only', () => {
  it('says «Пока только оценки» and links to all N reviews — not «Пока нет отзывов»', () => {
    render(
      <ReviewCarousel
        reviews={[]}
        totalCount={3}
        averageRating={4}
        reviewsHref='/minsk/restorany/some-slug/reviews'
        {...EST_PROPS}
      />,
    );

    expect(screen.getByText('Пока только оценки')).toBeInTheDocument();
    expect(screen.queryByText(/Пока нет отзывов/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Все 3 отзыва →' }),
    ).toHaveAttribute('href', '/minsk/restorany/some-slug/reviews');
  });

  it('a card without any review keeps «Пока нет отзывов…» and no link', () => {
    render(
      <ReviewCarousel
        reviews={[]}
        totalCount={0}
        averageRating={null}
        reviewsHref='/minsk/restorany/some-slug/reviews'
        {...EST_PROPS}
      />,
    );

    expect(
      screen.getByText('Пока нет отзывов. Будьте первым, кто оставит отзыв!'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Пока только оценки')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Все/ })).not.toBeInTheDocument();
  });
});

/*
 * Trunk's decision 22.11.2026: an author's own review of one rating (among
 * the latest — `authorOnly`) is on the card for that author alone, first,
 * with its edit/delete slot, and the CTA reads it as «Ваш отзыв».
 */
describe('ReviewCarousel — the author\'s own review of one rating', () => {
  function ratingOnly(id: string): PublicReview {
    return { ...makeReview(id), content: null };
  }

  it('is shown first, each card wrapped for its own author alone; reviews with text are not wrapped', () => {
    render(
      <ReviewCarousel
        reviews={THREE_REVIEWS}
        authorOnly={[ratingOnly('own'), ratingOnly('other')]}
        totalCount={7}
        averageRating={4.1}
        reviewsHref='/minsk/restorany/some-slug/reviews'
        {...EST_PROPS}
      />,
    );

    // One wrapper per card, each naming only that card's author: the author
    // of one rating never sees another's.
    const gates = screen.getAllByTestId('only-for-author');
    expect(gates).toHaveLength(2);
    expect(gates[0]).toHaveAttribute('data-authors', 'u-own');
    expect(gates[0]).toHaveTextContent('Автор own');
    expect(gates[0]).not.toHaveTextContent('Автор other');
    expect(gates[1]).toHaveAttribute('data-authors', 'u-other');
    expect(gates[1]).toHaveTextContent('Автор other');
    // First in the row; the three reviews with text follow, unwrapped.
    const names = screen
      .getAllByRole('article')
      .map((a) => a.textContent ?? '');
    expect(names[0]).toContain('Автор own');
    expect(names[1]).toContain('Автор other');
    expect(names.slice(2).map((n) => n.match(/Автор [abc]/)?.[0])).toEqual([
      'Автор a',
      'Автор b',
      'Автор c',
    ]);
  });

  it('the CTA reads «Ваш отзыв» from the author-only reviews too', () => {
    render(
      <ReviewCarousel
        reviews={THREE_REVIEWS}
        authorOnly={[ratingOnly('own')]}
        totalCount={6}
        averageRating={4.1}
        {...EST_PROPS}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Оставить отзыв' }),
    ).toHaveAttribute('data-reviews', 'a,b,c,own');
  });

  it('ratings only: «Пока только оценки» for everyone, and the author\'s own card in a row kept for its author', () => {
    render(
      <ReviewCarousel
        reviews={[]}
        authorOnly={[ratingOnly('own')]}
        totalCount={3}
        averageRating={4}
        reviewsHref='/minsk/restorany/some-slug/reviews'
        {...EST_PROPS}
      />,
    );

    expect(screen.getByText('Пока только оценки')).toBeInTheDocument();
    const gates = screen.getAllByTestId('only-for-author');
    // The row itself is for the author (no empty row for anyone else), and
    // so is the card inside it.
    expect(gates).toHaveLength(2);
    expect(gates[0]).toHaveAttribute('data-authors', 'u-own');
    expect(gates[0]).toContainElement(gates[1]);
    expect(gates[1]).toHaveTextContent('Автор own');
  });
});
