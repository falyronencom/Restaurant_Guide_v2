/**
 * Partner cabinet operations (CAT-C-3.14). Formerly partner-actions.test.ts —
 * the Server Actions became plain server-only operations behind buffered Route
 * Handlers; the logic (and this coverage) is byte-identical. Mocked at the
 * API-client boundary (lib/api/endpoints/partner) + session. Focus: the
 * first-create role re-stamp (user→partner) and error-code mapping.
 */
jest.mock('@/lib/api/endpoints/partner', () => ({
  createEstablishment: jest.fn(),
  updateEstablishment: jest.fn(),
  submitEstablishment: jest.fn(),
  listEstablishments: jest.fn(),
  getEstablishment: jest.fn(),
  retryOcr: jest.fn(),
}));
jest.mock('@/lib/auth/session', () => ({
  getSessionUser: jest.fn(),
  refreshSession: jest.fn(),
}));

import {
  createEstablishment,
  submitEstablishment,
  updateEstablishment,
} from '@/lib/api/endpoints/partner';
import { ApiError, type CreateEstablishmentPayload } from '@/lib/api/types';
import { getSessionUser, refreshSession } from '@/lib/auth/session';
import {
  createEstablishmentAction,
  submitEstablishmentAction,
  updateEstablishmentAction,
} from '@/lib/partner/operations';

const createMock = createEstablishment as jest.Mock;
const updateMock = updateEstablishment as jest.Mock;
const submitMock = submitEstablishment as jest.Mock;
const getUserMock = getSessionUser as jest.Mock;
const refreshMock = refreshSession as jest.Mock;

const PAYLOAD: CreateEstablishmentPayload = {
  name: 'Кафе',
  categories: ['Кафе'],
  cuisines: ['Народная'],
  city: 'Минск',
  address: 'ул. 1',
  latitude: 53.9,
  longitude: 27.56,
  working_hours: { monday: { is_open: false } },
};

beforeEach(() => jest.clearAllMocks());

describe('createEstablishmentAction — first-create role re-stamp', () => {
  it('force-refreshes and returns the partner user when role was still "user"', async () => {
    getUserMock
      .mockResolvedValueOnce({ id: 'u1', email: 'a', name: 'n', role: 'user', avatarUrl: null })
      .mockResolvedValueOnce({ id: 'u1', email: 'a', name: 'n', role: 'partner', avatarUrl: null });
    createMock.mockResolvedValue({ id: 'e1', status: 'draft', base_score: 25 });
    refreshMock.mockResolvedValue('new-access');

    const r = await createEstablishmentAction(PAYLOAD);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, id: 'e1', user: { role: 'partner' } });
  });

  it('does NOT refresh on a later create (role already partner)', async () => {
    getUserMock.mockResolvedValue({ id: 'u1', email: 'a', name: 'n', role: 'partner', avatarUrl: null });
    createMock.mockResolvedValue({ id: 'e2', status: 'draft' });

    const r = await createEstablishmentAction(PAYLOAD);

    expect(refreshMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, id: 'e2', user: { role: 'partner' } });
  });

  it('maps an ApiError to {ok:false, code} and skips the refresh', async () => {
    getUserMock.mockResolvedValue({ id: 'u1', email: 'a', name: 'n', role: 'user', avatarUrl: null });
    createMock.mockRejectedValue(new ApiError(422, 'dup', 'DUPLICATE_NAME'));

    const r = await createEstablishmentAction(PAYLOAD);

    expect(r).toEqual({ ok: false, code: 'DUPLICATE_NAME' });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('update / submit operations', () => {
  it('update returns status + base_score', async () => {
    updateMock.mockResolvedValue({ status: 'draft', base_score: 60 });
    await expect(updateEstablishmentAction('e1', {})).resolves.toEqual({
      ok: true,
      status: 'draft',
      base_score: 60,
    });
  });

  it('submit maps a transition error', async () => {
    submitMock.mockRejectedValue(
      new ApiError(400, 'x', 'INVALID_STATUS_TRANSITION'),
    );
    await expect(submitEstablishmentAction('e1')).resolves.toEqual({
      ok: false,
      code: 'INVALID_STATUS_TRANSITION',
    });
  });
});
