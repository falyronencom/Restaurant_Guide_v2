/**
 * OwnReviewControls island — ownership-gated edit/delete controls in the
 * ReviewCard footer slot. useAuth + the router are mocked; both dialogs are
 * stubbed to open-flags + prop spies (their own behaviour lives in
 * write-review-modal.test.tsx / delete-review-dialog.test.tsx). Mirrors
 * write-review-cta.test.tsx.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PublicReview } from '@/lib/api/types';

const mockRefresh = jest.fn();
let mockAuthState: { user: { id: string } | null };

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockAuthState.user }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

type StubProps = {
  open: boolean;
  onSuccess: () => void;
  editTarget?: { reviewId: string; rating: number; content: string };
};
const editModalSpy = jest.fn();
jest.mock('@/components/establishment/WriteReviewModal', () => ({
  WriteReviewModal: (props: StubProps) => {
    editModalSpy(props);
    return props.open ? <div data-testid="edit-modal-open" /> : null;
  },
}));
const deleteDialogSpy = jest.fn();
jest.mock('@/components/establishment/DeleteReviewDialog', () => ({
  DeleteReviewDialog: (props: StubProps) => {
    deleteDialogSpy(props);
    return props.open ? <div data-testid="delete-dialog-open" /> : null;
  },
}));

import { OwnReviewControls } from '@/components/establishment/OwnReviewControls';

const REVIEW: PublicReview = {
  id: 'r-1',
  establishment_id: 'est-1',
  rating: 4,
  content: 'Отличное место, вернёмся ещё.',
  partner_response: null,
  partner_response_at: null,
  is_edited: false,
  created_at: '2026-05-12T10:00:00.000Z',
  updated_at: '2026-05-12T10:00:00.000Z',
  author: { id: 'u-1', name: 'Всеволод', avatar_url: null },
};

const PROPS = {
  review: REVIEW,
  establishmentId: 'est-1',
  establishmentName: 'Цифровой мир',
  detailPath: '/minsk/restorany/some-slug',
};

function lastProps(spy: jest.Mock): StubProps {
  return spy.mock.calls[spy.mock.calls.length - 1][0] as StubProps;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState = { user: null };
});

it('renders nothing for an anonymous visitor', () => {
  const { container } = render(<OwnReviewControls {...PROPS} />);

  expect(container).toBeEmptyDOMElement();
});

it("renders nothing on another user's review", () => {
  mockAuthState = { user: { id: 'u-2' } };
  const { container } = render(<OwnReviewControls {...PROPS} />);

  expect(container).toBeEmptyDOMElement();
});

it('shows «Редактировать» + «Удалить» on the owner’s review', () => {
  mockAuthState = { user: { id: 'u-1' } };
  render(<OwnReviewControls {...PROPS} />);

  expect(
    screen.getByRole('button', { name: /Редактировать/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Удалить/ })).toBeInTheDocument();
});

it('opens the edit modal pre-filled from the card review', async () => {
  mockAuthState = { user: { id: 'u-1' } };
  render(<OwnReviewControls {...PROPS} />);

  await userEvent.click(screen.getByRole('button', { name: /Редактировать/ }));

  expect(screen.getByTestId('edit-modal-open')).toBeInTheDocument();
  expect(screen.queryByTestId('delete-dialog-open')).not.toBeInTheDocument();
  expect(lastProps(editModalSpy).editTarget).toEqual({
    reviewId: 'r-1',
    rating: 4,
    content: 'Отличное место, вернёмся ещё.',
  });
});

it('opens the delete confirm dialog', async () => {
  mockAuthState = { user: { id: 'u-1' } };
  render(<OwnReviewControls {...PROPS} />);

  await userEvent.click(screen.getByRole('button', { name: /Удалить/ }));

  expect(screen.getByTestId('delete-dialog-open')).toBeInTheDocument();
  expect(screen.queryByTestId('edit-modal-open')).not.toBeInTheDocument();
});

it('edit onSuccess closes the modal and refreshes the route', async () => {
  mockAuthState = { user: { id: 'u-1' } };
  render(<OwnReviewControls {...PROPS} />);

  await userEvent.click(screen.getByRole('button', { name: /Редактировать/ }));
  await act(async () => {
    lastProps(editModalSpy).onSuccess();
  });

  expect(screen.queryByTestId('edit-modal-open')).not.toBeInTheDocument();
  expect(mockRefresh).toHaveBeenCalled();
});

it('delete onSuccess closes the dialog and refreshes the route', async () => {
  mockAuthState = { user: { id: 'u-1' } };
  render(<OwnReviewControls {...PROPS} />);

  await userEvent.click(screen.getByRole('button', { name: /Удалить/ }));
  await act(async () => {
    lastProps(deleteDialogSpy).onSuccess();
  });

  expect(screen.queryByTestId('delete-dialog-open')).not.toBeInTheDocument();
  expect(mockRefresh).toHaveBeenCalled();
});
