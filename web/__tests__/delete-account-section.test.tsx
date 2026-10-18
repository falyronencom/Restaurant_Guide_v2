/**
 * «Удалить учётку» in the profile (brief В1, 18.10.2026): the backend is asked
 * first — a holder of cards reads its text and the support address, without
 * a field for the word; otherwise the warning and a button that works only
 * with УДАЛИТЬ; the word goes on as typed. How it ended goes to the hub
 * (onEnded): «deleted» — AuthProvider is told the visitor is anonymous and the
 * wizard's local draft of the account is removed; a session found dead at the
 * deletion — «sessionEnded», without a trip to the login. The account client
 * and useAuth are mocked.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/profile',
}));
jest.mock('@/lib/account/client', () => ({
  checkAccountDeletionAction: jest.fn(),
  deleteAccountAction: jest.fn(),
}));
const mockMarkAnonymous = jest.fn();
let mockUser: { id: string; role: string } | null = null;
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ markAnonymous: mockMarkAnonymous, user: mockUser }),
}));

import {
  DeleteAccountSection,
  DeletionEndedPanel,
} from '@/components/account/DeleteAccountSection';
import { checkAccountDeletionAction, deleteAccountAction } from '@/lib/account/client';

const mockCheck = checkAccountDeletionAction as jest.Mock;
const mockDelete = deleteAccountAction as jest.Mock;
const mockOnEnded = jest.fn();

const OWNS_CARDS_TEXT = 'У вас есть карточки заведений. Удалить учётку можно, когда их передадут '
  + 'другому владельцу, — напишите в поддержку: support@nirivio.by';
const WORD_LABEL = 'Чтобы подтвердить, введите слово УДАЛИТЬ';
const DRAFTS_LINE = 'Черновики карточек заведений, которые не публиковались';

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks leaves a queued mockResolvedValueOnce in place: a once-value
  // a test did not consume would answer the next test's check.
  mockCheck.mockReset();
  mockDelete.mockReset();
  mockUser = { id: 'u-1', role: 'user' };
  localStorage.clear();
});

async function open() {
  const user = userEvent.setup();
  render(<DeleteAccountSection onEnded={mockOnEnded} />);
  await user.click(screen.getByRole('button', { name: 'Удалить…' }));
  return user;
}

async function confirmWith(user: ReturnType<typeof userEvent.setup>, typed: string) {
  await user.type(await screen.findByLabelText(WORD_LABEL), typed);
  await user.click(screen.getByRole('button', { name: 'Удалить учётку' }));
}

it('allowed — the warning, and the button works only with the word', async () => {
  mockCheck.mockResolvedValue({ ok: true, allowed: true, refusal: null });
  const user = await open();

  expect(await screen.findByText('Что удалится')).toBeInTheDocument();
  expect(screen.getByText('Ваши отзывы и оценки — автором будет «Гость», без фото')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Удалить учётку' });
  expect(button).toBeDisabled();

  await user.type(screen.getByLabelText(WORD_LABEL), 'удали');
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText(WORD_LABEL), 'ть');
  expect(button).toBeEnabled();
});

it('deleted — the word as typed goes on; the hub is told; anonymous; the wizard draft of this account gone', async () => {
  mockCheck.mockResolvedValue({ ok: true, allowed: true, refusal: null });
  mockDelete.mockResolvedValue({ ok: true });
  localStorage.setItem('nirivio:wizard:new:u-1', '{"form":{"name":"Кафе"}}');
  localStorage.setItem('nirivio:wizard:new:u-2', '{"form":{"name":"Чужое"}}');
  const user = await open();

  await confirmWith(user, ' удалить');

  await waitFor(() => expect(mockOnEnded).toHaveBeenCalledWith('deleted'));
  expect(mockOnEnded).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledWith(' удалить');
  expect(mockMarkAnonymous).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('nirivio:wizard:new:u-1')).toBeNull();
  expect(localStorage.getItem('nirivio:wizard:new:u-2')).toBe('{"form":{"name":"Чужое"}}');
  expect(mockReplace).not.toHaveBeenCalled();
});

it('a dead session at the deletion — «sessionEnded» to the hub, no trip to the login, the draft stays', async () => {
  mockCheck.mockResolvedValue({ ok: true, allowed: true, refusal: null });
  mockDelete.mockResolvedValue({ ok: false, code: 'NO_SESSION' });
  localStorage.setItem('nirivio:wizard:new:u-1', '{"form":{"name":"Кафе"}}');
  const user = await open();

  await confirmWith(user, 'УДАЛИТЬ');

  await waitFor(() => expect(mockOnEnded).toHaveBeenCalledWith('sessionEnded'));
  expect(mockMarkAnonymous).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(localStorage.getItem('nirivio:wizard:new:u-1')).toBe('{"form":{"name":"Кафе"}}');
});

it('a holder of cards — the backend text and the support address, no field for the word', async () => {
  mockCheck.mockResolvedValue({
    ok: true,
    allowed: false,
    refusal: { code: 'ACCOUNT_OWNS_ESTABLISHMENTS', message: OWNS_CARDS_TEXT },
  });
  await open();

  expect(await screen.findByText(OWNS_CARDS_TEXT)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Написать в поддержку' }))
    .toHaveAttribute('href', expect.stringMatching(/^mailto:support@nirivio\.by\?/));
  expect(screen.queryByLabelText(WORD_LABEL)).not.toBeInTheDocument();
});

it('refused at the deletion itself — asks the check again and shows its text', async () => {
  mockCheck
    .mockResolvedValueOnce({ ok: true, allowed: true, refusal: null })
    .mockResolvedValueOnce({
      ok: true,
      allowed: false,
      refusal: { code: 'ACCOUNT_OWNS_ESTABLISHMENTS', message: OWNS_CARDS_TEXT },
    });
  mockDelete.mockResolvedValue({ ok: false, code: 'ACCOUNT_OWNS_ESTABLISHMENTS' });
  const user = await open();

  await confirmWith(user, 'УДАЛИТЬ');

  expect(await screen.findByText(OWNS_CARDS_TEXT)).toBeInTheDocument();
  expect(mockCheck).toHaveBeenCalledTimes(2);
  expect(mockMarkAnonymous).not.toHaveBeenCalled();
  expect(mockOnEnded).not.toHaveBeenCalled();
});

it.each([
  ['ACCOUNT_OPERATOR_MANAGED', 'Эту учётку удаляет оператор платформы. Напишите в поддержку: support@nirivio.by'],
  ['ACCOUNT_INACTIVE', 'Учётка отключена. Напишите в поддержку: support@nirivio.by'],
])('refused at the deletion with %s — asks the check again and shows its text', async (code, text) => {
  mockCheck
    .mockResolvedValueOnce({ ok: true, allowed: true, refusal: null })
    .mockResolvedValueOnce({ ok: true, allowed: false, refusal: { code, message: text } });
  mockDelete.mockResolvedValue({ ok: false, code });
  const user = await open();

  await confirmWith(user, 'УДАЛИТЬ');

  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(mockCheck).toHaveBeenCalledTimes(2);
  expect(mockMarkAnonymous).not.toHaveBeenCalled();
  expect(mockOnEnded).not.toHaveBeenCalled();
});

it('the deletion failed on the network — a message, the form stays', async () => {
  mockCheck.mockResolvedValue({ ok: true, allowed: true, refusal: null });
  mockDelete.mockResolvedValue({ ok: false, code: 'NETWORK' });
  const user = await open();

  await confirmWith(user, 'УДАЛИТЬ');

  expect(
    await screen.findByText('Не удалось удалить учётку. Проверьте соединение и попробуйте ещё раз.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Удалить учётку' })).toBeEnabled();
  expect(mockMarkAnonymous).not.toHaveBeenCalled();
  expect(mockOnEnded).not.toHaveBeenCalled();
});

it('the check failed — «Повторить» asks the backend again', async () => {
  mockCheck
    .mockResolvedValueOnce({ ok: false, code: 'NETWORK' })
    .mockResolvedValueOnce({ ok: true, allowed: true, refusal: null });
  const user = await open();

  expect(await screen.findByText('Не удалось проверить учётку. Проверьте соединение.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Повторить' }));

  expect(await screen.findByText('Что удалится')).toBeInTheDocument();
  expect(mockCheck).toHaveBeenCalledTimes(2);
});

it('a dead session at the check — to the login, back to the profile after it', async () => {
  mockCheck.mockResolvedValue({ ok: false, code: 'NO_SESSION' });
  await open();

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?returnTo=/profile'));
  expect(mockMarkAnonymous).toHaveBeenCalledTimes(1);
});

it.each([
  ['partner', true],
  ['user', false],
])('the drafts line — to a %s: %s', async (role, shown) => {
  mockUser = { id: 'u-1', role };
  mockCheck.mockResolvedValue({ ok: true, allowed: true, refusal: null });
  await open();

  expect(await screen.findByText('Что удалится')).toBeInTheDocument();
  expect(screen.queryByText(DRAFTS_LINE) !== null).toBe(shown);
});

describe('DeletionEndedPanel', () => {
  it('deleted — «Учётка удалена.» and the way home', () => {
    render(<DeletionEndedPanel outcome="deleted" />);

    expect(screen.getByText('Учётка удалена.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Войти' })).not.toBeInTheDocument();
  });

  it('session ended — says both cases and offers the login back to the profile', () => {
    render(<DeletionEndedPanel outcome="sessionEnded" />);

    expect(screen.getByText('Сеанс завершён.')).toBeInTheDocument();
    expect(screen.getByText(
      'Если удаление успело пройти, учётки больше нет и войти в неё не получится. Если нет — войдите и удалите её снова.',
    )).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login?returnTo=/profile');
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('Учётка удалена.')).not.toBeInTheDocument();
  });
});
