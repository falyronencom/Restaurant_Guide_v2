/**
 * WriteReviewCta island — ownership-aware CTA states. useAuth, the router, and
 * the modal are mocked (auth is client-only; the modal's own behaviour is
 * covered in write-review-modal.test.tsx). Mirrors favorite-button.test.tsx.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PublicReview } from '@/lib/api/types';

const mockRequestLogin = jest.fn();
const mockRefresh = jest.fn();
let mockAuthState: { user: { id: string } | null; isAuthenticated: boolean };

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: mockAuthState.user,
    isAuthenticated: mockAuthState.isAuthenticated,
    requestLogin: mockRequestLogin,
  }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
// Stub the modal to expose only whether it is open — the CTA test asserts intent
// (opened / not opened) without the base-ui dialog internals.
jest.mock('@/components/establishment/WriteReviewModal', () => ({
  WriteReviewModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="modal-open" /> : null,
}));

import { WriteReviewCta } from '@/components/establishment/WriteReviewCta';

function makeReview(authorId: string): PublicReview {
  return {
    id: `r-${authorId}`,
    establishment_id: 'est-1',
    rating: 5,
    content: 'x',
    partner_response: null,
    partner_response_at: null,
    is_edited: false,
    created_at: '2026-05-12T10:00:00.000Z',
    updated_at: '2026-05-12T10:00:00.000Z',
    author: { id: authorId, name: 'A', avatar_url: null },
  };
}

const PROPS = {
  establishmentId: 'est-1',
  establishmentName: 'Цифровой мир',
  detailPath: '/minsk/restorany/some-slug',
  reviews: [] as PublicReview[],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState = { user: null, isAuthenticated: false };
});

it('anonymous tap opens Google One Tap (requestLogin), not the modal', async () => {
  render(<WriteReviewCta {...PROPS} />);

  await userEvent.click(
    screen.getByRole('button', { name: /Оставить отзыв/ }),
  );

  expect(mockRequestLogin).toHaveBeenCalled();
  expect(screen.queryByTestId('modal-open')).not.toBeInTheDocument();
});

it('authenticated tap without an existing review opens the modal', async () => {
  mockAuthState = { user: { id: 'u-1' }, isAuthenticated: true };
  render(<WriteReviewCta {...PROPS} />);

  await userEvent.click(
    screen.getByRole('button', { name: /Оставить отзыв/ }),
  );

  expect(mockRequestLogin).not.toHaveBeenCalled();
  expect(screen.getByTestId('modal-open')).toBeInTheDocument();
});

it('shows «Ваш отзыв» (no create CTA) when the user already reviewed this place', () => {
  mockAuthState = { user: { id: 'u-1' }, isAuthenticated: true };
  render(<WriteReviewCta {...PROPS} reviews={[makeReview('u-1')]} />);

  expect(screen.getByText('Ваш отзыв')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Оставить отзыв/ }),
  ).not.toBeInTheDocument();
});

it("does not treat another user's review as the current user's", () => {
  mockAuthState = { user: { id: 'u-1' }, isAuthenticated: true };
  render(<WriteReviewCta {...PROPS} reviews={[makeReview('u-2')]} />);

  expect(
    screen.getByRole('button', { name: /Оставить отзыв/ }),
  ).toBeInTheDocument();
});
