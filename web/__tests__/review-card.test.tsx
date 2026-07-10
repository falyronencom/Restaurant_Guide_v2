/**
 * ReviewCard — SYNC Server Component (plain prop-taking, no top-level await).
 *
 * Renders directly under React Testing Library (no invoke-await workaround).
 * No data-layer mocks needed: the card is pure presentation over its `review`
 * prop. Date formatting goes through the real `formatDateRu` helper, so the
 * asserted string ('12 мая') is the genuine contract output for the fixture.
 */
import { render, screen } from '@testing-library/react';

import { ReviewCard } from '@/components/establishment/ReviewCard';
import type { PublicReview } from '@/lib/api/types';

const baseReview: PublicReview = {
  id: 'rev-1',
  establishment_id: 'est-1',
  rating: 4,
  content: 'Отличное место, вкусная еда',
  partner_response: null,
  partner_response_at: null,
  is_edited: false,
  // Midday local time so getDate()/getMonth() are timezone-edge safe → '12 мая'.
  created_at: '2026-05-12T12:00:00.000Z',
  updated_at: '2026-05-12T12:00:00.000Z',
  author: {
    id: 'user-1',
    name: 'Алексей',
    avatar_url: null,
  },
};

describe('ReviewCard — sync Server Component', () => {
  it('renders author, rating, content, and formatted date', () => {
    const { container } = render(<ReviewCard review={baseReview} />);

    // Author name.
    expect(screen.getByText('Алексей')).toBeInTheDocument();

    // Rating: StarRating exposes the score via an aria-label.
    expect(screen.getByLabelText('Оценка: 4 из 5')).toBeInTheDocument();

    // Content body.
    expect(
      screen.getByText('Отличное место, вкусная еда'),
    ).toBeInTheDocument();

    // Date formatted via formatDateRu → '12 мая', carried on a <time> element
    // whose dateTime is the raw ISO string.
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time).toHaveTextContent('12 мая');
    expect(time).toHaveAttribute('dateTime', '2026-05-12T12:00:00.000Z');
  });

  it('clamps the content paragraph by default (clamp defaults to true)', () => {
    render(<ReviewCard review={baseReview} />);

    const body = screen.getByText('Отличное место, вкусная еда');
    expect(body).toHaveClass('line-clamp-6');
  });

  it('omits the clamp class when clamp is false', () => {
    render(<ReviewCard review={baseReview} clamp={false} />);

    const body = screen.getByText('Отличное место, вкусная еда');
    expect(body).not.toHaveClass('line-clamp-6');
  });

  // Slice 2: an edited review carries the «изменён» marker next to the date
  // (is_edited comes from the public projection; VISUAL_SPEC_slice2 §1).
  it('marks an edited review with «изменён» and omits it otherwise', () => {
    const { rerender } = render(<ReviewCard review={baseReview} />);
    expect(screen.queryByText(/изменён/)).not.toBeInTheDocument();

    rerender(<ReviewCard review={{ ...baseReview, is_edited: true }} />);
    expect(screen.getByText(/изменён/)).toBeInTheDocument();
  });
});
