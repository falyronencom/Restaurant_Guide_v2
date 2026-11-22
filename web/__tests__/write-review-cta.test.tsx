/**
 * WriteReviewCta island — ownership-aware CTA states. useAuth, the router, and
 * the modal are mocked (auth is client-only; the modal's own behaviour is
 * covered in write-review-modal.test.tsx). Mirrors favorite-button.test.tsx.
 *
 * A new review only with a confirmed address (thread «Отзыв без текста», В9):
 * the tap asks /auth/me (loadProfile, mocked here — the transport's own
 * tests cover it) and, for an address not confirmed, shows the В9 words with
 * «Отправить код» instead of the form; the code is sent there, then the code
 * page opens with the way back to this card. The real base-ui dialog renders
 * under jsdom via the polyfills in jest.setup.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { AuthUserData, PublicReview } from '@/lib/api/types';

const mockRequestLogin = jest.fn();
const mockRefresh = jest.fn();
const mockPush = jest.fn();
const mockLoadProfile = jest.fn();
const mockResend = jest.fn();
let mockAuthState: {
  user: { id: string; email: string } | null;
  isAuthenticated: boolean;
};

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: mockAuthState.user,
    isAuthenticated: mockAuthState.isAuthenticated,
    requestLogin: mockRequestLogin,
  }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
jest.mock('@/lib/account/client', () => ({
  loadProfile: (...args: unknown[]) => mockLoadProfile(...args),
}));
jest.mock('@/lib/auth/actions', () => ({
  resendVerificationCodeAction: (...args: unknown[]) => mockResend(...args),
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

function profile(emailVerified: boolean): { ok: true; profile: AuthUserData } {
  return {
    ok: true,
    profile: {
      id: 'u-1',
      email: 'guest@example.com',
      phone: null,
      name: 'Гость',
      role: 'user',
      authMethod: 'email',
      avatarUrl: null,
      emailVerified,
      phoneVerified: false,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  };
}

const PROPS = {
  establishmentId: 'est-1',
  establishmentName: 'Цифровой мир',
  detailPath: '/minsk/restorany/some-slug',
  reviews: [] as PublicReview[],
};

const GATE_TEXT =
  'Чтобы оставить отзыв, подтвердите почту — пришлём код на guest@example.com';

beforeEach(() => {
  // mockReset: no implementation and no *Once queue leaks into the next test.
  [mockRequestLogin, mockRefresh, mockPush, mockLoadProfile, mockResend].forEach(
    (m) => m.mockReset(),
  );
  mockAuthState = { user: null, isAuthenticated: false };
});

const signedIn = () => {
  mockAuthState = {
    user: { id: 'u-1', email: 'guest@example.com' },
    isAuthenticated: true,
  };
};

const tapWrite = () =>
  userEvent.click(screen.getByRole('button', { name: /Оставить отзыв/ }));

it('anonymous tap opens Google One Tap (requestLogin), not the modal', async () => {
  render(<WriteReviewCta {...PROPS} />);

  await tapWrite();

  // With the /login fallback (сверка находок тестировщика с сайтом, 18.10, Х2).
  expect(mockRequestLogin).toHaveBeenCalledWith({ fallbackToLoginPage: true });
  expect(screen.queryByTestId('modal-open')).not.toBeInTheDocument();
  // A guest is not asked about an address: sign in first, as before.
  expect(mockLoadProfile).not.toHaveBeenCalled();
});

it('authenticated tap with a confirmed address opens the modal', async () => {
  signedIn();
  mockLoadProfile.mockResolvedValue(profile(true));
  render(<WriteReviewCta {...PROPS} />);

  await tapWrite();

  expect(await screen.findByTestId('modal-open')).toBeInTheDocument();
  expect(mockRequestLogin).not.toHaveBeenCalled();
  expect(screen.queryByText(GATE_TEXT)).not.toBeInTheDocument();
  expect(mockResend).not.toHaveBeenCalled();
});

it('shows «Ваш отзыв» (no create CTA) when the user already reviewed this place', () => {
  signedIn();
  render(<WriteReviewCta {...PROPS} reviews={[makeReview('u-1')]} />);

  expect(screen.getByText('Ваш отзыв')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Оставить отзыв/ }),
  ).not.toBeInTheDocument();
});

it("does not treat another user's review as the current user's", () => {
  signedIn();
  render(<WriteReviewCta {...PROPS} reviews={[makeReview('u-2')]} />);

  expect(
    screen.getByRole('button', { name: /Оставить отзыв/ }),
  ).toBeInTheDocument();
});

describe('a new review only with a confirmed address (В9)', () => {
  it('an address not confirmed: no form — the В9 words with the address; «Отправить код» sends the code, then the code page with the way back', async () => {
    signedIn();
    mockLoadProfile.mockResolvedValue(profile(false));
    mockResend.mockResolvedValue({ ok: true, message: 'Мы отправили новый код на вашу почту.' });
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();

    expect(await screen.findByText(GATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByTestId('modal-open')).not.toBeInTheDocument();
    expect(mockResend).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Отправить код' }));

    expect(mockResend).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      '/verify-email?returnTo=%2Fminsk%2Frestorany%2Fsome-slug',
    );
    expect(screen.queryByTestId('modal-open')).not.toBeInTheDocument();
  });

  it('asks at every tap: confirmed in the app since the first tap — the second tap opens the form', async () => {
    signedIn();
    mockLoadProfile
      .mockResolvedValueOnce(profile(false))
      .mockResolvedValueOnce(profile(true));
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    expect(await screen.findByText(GATE_TEXT)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText(GATE_TEXT)).not.toBeInTheDocument(),
    );

    await tapWrite();

    expect(await screen.findByTestId('modal-open')).toBeInTheDocument();
    expect(mockLoadProfile).toHaveBeenCalledTimes(2);
  });

  it('the check itself failed: the form opens (the server refuses, if it must)', async () => {
    signedIn();
    mockLoadProfile.mockResolvedValue({ ok: false, code: 'NETWORK' });
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();

    expect(await screen.findByTestId('modal-open')).toBeInTheDocument();
    expect(screen.queryByText(GATE_TEXT)).not.toBeInTheDocument();
  });

  it('a refused send says why, stays, and opens nothing', async () => {
    signedIn();
    mockLoadProfile.mockResolvedValue(profile(false));
    mockResend.mockResolvedValue({
      ok: false,
      code: 'EMAIL_NOT_SENT',
      message: 'Письмо не отправилось. Попробуйте ещё раз через минуту.',
    });
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Отправить код' }),
    );

    expect(
      await screen.findByText('Письмо не отправилось. Попробуйте ещё раз через минуту.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить код' })).toBeEnabled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('«почта уже подтверждена» on the send hands over to the form', async () => {
    signedIn();
    mockLoadProfile.mockResolvedValue(profile(false));
    mockResend.mockResolvedValue({
      ok: false,
      code: 'EMAIL_ALREADY_VERIFIED',
      message: 'Почта уже подтверждена.',
    });
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Отправить код' }),
    );

    expect(await screen.findByTestId('modal-open')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
