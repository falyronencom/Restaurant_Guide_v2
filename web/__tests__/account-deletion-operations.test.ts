/*
 * Account deletion — the endpoint functions and the operations (brief В1,
 * 18.10.2026).
 *
 * The endpoint sends exactly what the backend reads: DELETE
 * /api/v1/auth/account, JSON, with body { confirmation } — the word as the
 * person typed it, which the backend checks again (backend
 * accountDeletionController / accountDeletionService); the check is GET
 * /api/v1/auth/account/deletion → { allowed, refusal }. The operation clears
 * the session cookies only after the backend deleted the account; a refusal
 * comes back as its code only.
 */
jest.mock('@/lib/auth/session', () => ({
  authedFetch: jest.fn(),
  clearSession: jest.fn(),
  getSessionUser: jest.fn(),
  writeUser: jest.fn(),
}));

import { checkAccountDeletion, deleteAccount } from '@/lib/account/operations';
import { deleteOwnAccount, getAccountDeletionCheck } from '@/lib/api/endpoints/profile';
import { ApiError } from '@/lib/api/types';
import { authedFetch, clearSession } from '@/lib/auth/session';

const mockAuthedFetch = authedFetch as jest.Mock;
const mockClearSession = clearSession as jest.Mock;

const OWNS_CARDS_TEXT = 'У вас есть карточки заведений. Удалить учётную запись можно, когда их передадут '
  + 'другому владельцу, — напишите в поддержку: support@nirivio.by';

beforeEach(() => jest.clearAllMocks());

describe('endpoint functions', () => {
  it('the check is a plain GET of /api/v1/auth/account/deletion', async () => {
    mockAuthedFetch.mockResolvedValue({ allowed: true, refusal: null });

    await expect(getAccountDeletionCheck()).resolves.toEqual({ allowed: true, refusal: null });
    expect(mockAuthedFetch).toHaveBeenCalledWith('/api/v1/auth/account/deletion');
  });

  it('the deletion is DELETE /api/v1/auth/account, JSON, with the word as typed', async () => {
    mockAuthedFetch.mockResolvedValue({ deleted: true });

    await deleteOwnAccount(' удалить');

    expect(mockAuthedFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockAuthedFetch.mock.calls[0];
    expect(path).toBe('/api/v1/auth/account');
    expect(init.method).toBe('DELETE');
    // Without it the backend's JSON parser leaves the body empty, and the
    // backend refuses: no word.
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ confirmation: ' удалить' });
  });
});

describe('checkAccountDeletion', () => {
  it('passes «allowed» and the backend refusal text through', async () => {
    mockAuthedFetch.mockResolvedValue({
      allowed: false,
      refusal: { code: 'ACCOUNT_OWNS_ESTABLISHMENTS', message: OWNS_CARDS_TEXT },
    });

    await expect(checkAccountDeletion()).resolves.toEqual({
      ok: true,
      allowed: false,
      refusal: { code: 'ACCOUNT_OWNS_ESTABLISHMENTS', message: OWNS_CARDS_TEXT },
    });
  });

  it('a dead session comes back as NO_SESSION', async () => {
    mockAuthedFetch.mockRejectedValue(new ApiError(401, 'Not authenticated', 'NO_SESSION'));

    await expect(checkAccountDeletion()).resolves.toEqual({ ok: false, code: 'NO_SESSION' });
  });
});

describe('deleteAccount', () => {
  it('deleted — the word goes on, the session cookies are cleared', async () => {
    mockAuthedFetch.mockResolvedValue({ deleted: true });

    await expect(deleteAccount('удалить ')).resolves.toEqual({ ok: true });
    expect(JSON.parse(mockAuthedFetch.mock.calls[0][1].body)).toEqual({ confirmation: 'удалить ' });
    expect(mockClearSession).toHaveBeenCalledTimes(1);
  });

  it('refused — the code alone comes back, the cookies stay', async () => {
    mockAuthedFetch.mockRejectedValue(
      new ApiError(409, 'Request failed', 'ACCOUNT_OWNS_ESTABLISHMENTS'),
    );

    await expect(deleteAccount('УДАЛИТЬ')).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_OWNS_ESTABLISHMENTS',
    });
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it('a dead session — NO_SESSION, nothing cleared here', async () => {
    mockAuthedFetch.mockRejectedValue(new ApiError(401, 'Not authenticated', 'NO_SESSION'));

    await expect(deleteAccount('УДАЛИТЬ')).resolves.toEqual({ ok: false, code: 'NO_SESSION' });
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it('the network failed — NETWORK, the cookies stay', async () => {
    mockAuthedFetch.mockRejectedValue(new TypeError('fetch failed'));

    await expect(deleteAccount('УДАЛИТЬ')).resolves.toEqual({ ok: false, code: 'NETWORK' });
    expect(mockClearSession).not.toHaveBeenCalled();
  });
});
