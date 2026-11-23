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
    // The words are the dialog's description: read out on opening.
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      /пришлём код на guest@example\.com/,
    );
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

  // A refused send: the reason, the button stays, and the code page all the
  // same («Подтвердить», as in the profile) — after «Слишком много запросов
  // кода» the last code is most likely in the mail already.
  it.each([
    ['EMAIL_NOT_SENT', 'Письмо не отправилось. Попробуйте ещё раз через минуту.'],
    ['RATE_LIMITED', 'Слишком много запросов кода. Попробуйте позже.'],
  ])('a refused send (%s) says why, stays, and offers the code page', async (code, message) => {
    signedIn();
    mockLoadProfile.mockResolvedValue(profile(false));
    mockResend.mockResolvedValue({ ok: false, code, message });
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Отправить код' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(
      screen.getByRole('link', { name: 'Подтвердить' }),
    ).toHaveAttribute('href', '/verify-email?returnTo=%2Fminsk%2Frestorany%2Fsome-slug');
    expect(
      screen.getByRole('button', { name: 'Отправить код' }),
    ).not.toHaveAttribute('aria-disabled');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('the send itself unreachable (network): «Сеть недоступна…» and the code page all the same', async () => {
    signedIn();
    mockLoadProfile.mockResolvedValue(profile(false));
    mockResend.mockRejectedValue(new Error('Failed to fetch'));
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Отправить код' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Сеть недоступна. Попробуйте позже.',
    );
    expect(screen.getByRole('link', { name: 'Подтвердить' })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('«почта уже подтверждена» on the send closes the words and hands over to the form', async () => {
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
    await waitFor(() =>
      expect(screen.queryByText(GATE_TEXT)).not.toBeInTheDocument(),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a second press while the code is on its way sends nothing more: one letter', async () => {
    signedIn();
    mockLoadProfile.mockResolvedValue(profile(false));
    let answer: (value: unknown) => void = () => {};
    mockResend.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    const send = await screen.findByRole('button', { name: 'Отправить код' });
    await userEvent.click(send);
    await userEvent.click(screen.getByRole('button', { name: 'Отправляем…' }));

    expect(mockResend).toHaveBeenCalledTimes(1);
    answer({ ok: true, message: 'Мы отправили новый код на вашу почту.' });
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });

  it('closed before the answer came: nothing follows it — no code page', async () => {
    signedIn();
    mockLoadProfile.mockResolvedValue(profile(false));
    let answer: (value: unknown) => void = () => {};
    mockResend.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Отправить код' }),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText(GATE_TEXT)).not.toBeInTheDocument(),
    );

    answer({ ok: true, message: 'Мы отправили новый код на вашу почту.' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByTestId('modal-open')).not.toBeInTheDocument();
  });

  it('while the address is being checked the button is busy, not disabled (the focus stays on it)', async () => {
    signedIn();
    let answer: (value: unknown) => void = () => {};
    mockLoadProfile.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<WriteReviewCta {...PROPS} />);

    await tapWrite();
    const button = screen.getByRole('button', { name: /Оставить отзыв/ });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    // A second tap meanwhile asks nothing more.
    await tapWrite();
    expect(mockLoadProfile).toHaveBeenCalledTimes(1);

    answer(profile(true));
    expect(await screen.findByTestId('modal-open')).toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-disabled');
  });
});
