/**
 * «Отзыв без текста» — the author's own review of one rating (Trunk's
 * decision 22.11.2026): the card shows reviews with text to everyone (В1)
 * and the author's own review of one rating to that author alone.
 *
 * Two pieces, each on its own:
 *   - authorOnlyReviews (lib/establishment-helpers) — which of the latest
 *     reviews the card keeps for their authors: those the first-with-text
 *     list does not show, never one of a switched-off author;
 *   - OnlyForAuthor — renders its children to the matching signed-in user
 *     only (useAuth mocked, as in own-review-controls.test.tsx).
 */
import { render, screen } from '@testing-library/react';

import type { PublicReview } from '@/lib/api/types';

let mockUser: { id: string } | null = null;
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import { OnlyForAuthor } from '@/components/establishment/OnlyForAuthor';
import { authorOnlyReviews } from '@/lib/establishment-helpers';

function review(id: string, authorId: string | null, content: string | null): PublicReview {
  return {
    id,
    establishment_id: 'est-1',
    rating: 4,
    content,
    partner_response: null,
    partner_response_at: null,
    is_edited: false,
    created_at: '2026-11-20T10:00:00.000Z',
    updated_at: '2026-11-20T10:00:00.000Z',
    author: { id: authorId, name: 'Гость', avatar_url: null },
  };
}

describe('authorOnlyReviews', () => {
  it('keeps the latest reviews the first-with-text list does not show, in their order', () => {
    const t1 = review('t1', 'u-1', 'Вкусно');
    const t2 = review('t2', 'u-2', 'Уютно');
    const r1 = review('r1', 'u-3', null);
    const r2 = review('r2', 'u-4', null);

    expect(authorOnlyReviews([t1, t2], [r1, t1, r2, t2])).toEqual([r1, r2]);
  });

  it('never keeps a review of a switched-off author (author id null)', () => {
    const gone = review('r1', null, null);
    const own = review('r2', 'u-5', null);

    expect(authorOnlyReviews([], [gone, own])).toEqual([own]);
  });

  it('nothing to keep when the latest are all shown, or not loaded', () => {
    const t1 = review('t1', 'u-1', 'Вкусно');

    expect(authorOnlyReviews([t1], [t1])).toEqual([]);
    expect(authorOnlyReviews([t1], [])).toEqual([]);
  });
});

describe('OnlyForAuthor', () => {
  const renderGate = (authorIds: (string | null)[]) =>
    render(
      <OnlyForAuthor authorIds={authorIds}>
        <p>свой отзыв</p>
      </OnlyForAuthor>,
    );

  beforeEach(() => {
    mockUser = null;
  });

  it('shows its children to the author', () => {
    mockUser = { id: 'u-1' };
    renderGate(['u-1']);

    expect(screen.getByText('свой отзыв')).toBeInTheDocument();
  });

  it('any of several authors', () => {
    mockUser = { id: 'u-2' };
    renderGate(['u-1', 'u-2']);

    expect(screen.getByText('свой отзыв')).toBeInTheDocument();
  });

  it('shows nothing to another signed-in visitor', () => {
    mockUser = { id: 'u-9' };
    renderGate(['u-1']);

    expect(screen.queryByText('свой отзыв')).not.toBeInTheDocument();
  });

  it('shows nothing to a guest', () => {
    renderGate(['u-1']);
    expect(screen.queryByText('свой отзыв')).not.toBeInTheDocument();
  });
});
