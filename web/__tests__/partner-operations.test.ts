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
  deleteEstablishment: jest.fn(),
  resumeEstablishment: jest.fn(),
}));
jest.mock('@/lib/auth/session', () => ({
  getSessionUser: jest.fn(),
  refreshSession: jest.fn(),
}));

import {
  createEstablishment,
  deleteEstablishment,
  resumeEstablishment,
  submitEstablishment,
  updateEstablishment,
} from '@/lib/api/endpoints/partner';
import { ApiError, type CreateEstablishmentPayload } from '@/lib/api/types';
import { getSessionUser, refreshSession } from '@/lib/auth/session';
import {
  createEstablishmentAction,
  deleteEstablishmentAction,
  resumeEstablishmentAction,
  submitEstablishmentAction,
  updateEstablishmentAction,
} from '@/lib/partner/operations';

const createMock = createEstablishment as jest.Mock;
const updateMock = updateEstablishment as jest.Mock;
const submitMock = submitEstablishment as jest.Mock;
const deleteMock = deleteEstablishment as jest.Mock;
const resumeMock = resumeEstablishment as jest.Mock;
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

describe('delete operation', () => {
  it('returns {ok:true} on success', async () => {
    deleteMock.mockResolvedValue(undefined);
    await expect(deleteEstablishmentAction('e1')).resolves.toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledWith('e1');
  });

  it('maps an ApiError to {ok:false, code}', async () => {
    deleteMock.mockRejectedValue(
      new ApiError(404, 'gone', 'ESTABLISHMENT_NOT_FOUND'),
    );
    await expect(deleteEstablishmentAction('e1')).resolves.toEqual({
      ok: false,
      code: 'ESTABLISHMENT_NOT_FOUND',
    });
  });
});

/*
 * Отказ несёт то, из чего кабинет складывает понятную фразу (сверка находок
 * тестировщика с сайтом, 18.10, пункты С5, С6, Х17): русский текст сервера,
 * поля проверки (без значений), срок и вид предела.
 */
describe('refusal envelope — what the cabinet words a refusal from', () => {
  it("carries the server's Russian text", async () => {
    updateMock.mockRejectedValue(
      new ApiError(409, 'У вас уже есть заведение с таким названием.', 'DUPLICATE_ESTABLISHMENT'),
    );
    await expect(updateEstablishmentAction('e1', {})).resolves.toEqual({
      ok: false,
      code: 'DUPLICATE_ESTABLISHMENT',
      message: 'У вас уже есть заведение с таким названием.',
    });
  });

  it('does not carry an English text', async () => {
    updateMock.mockRejectedValue(new ApiError(403, 'Maximum 2 PDF', 'PDF_LIMIT_EXCEEDED'));
    await expect(updateEstablishmentAction('e1', {})).resolves.toEqual({
      ok: false,
      code: 'PDF_LIMIT_EXCEEDED',
    });
  });

  it('a field check: the fields by name, the Russian field text kept, the values never', async () => {
    updateMock.mockRejectedValue(
      new ApiError(422, '', 'VALIDATION_ERROR', [
        { field: 'phone', message: 'Phone must be in format +375XXXXXXXXX', value: '+37529' },
        { field: 'categories', message: 'Такой категории нет в списке.', value: ['x'] },
      ]),
    );
    await expect(updateEstablishmentAction('e1', {})).resolves.toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
      fields: [
        { field: 'phone' },
        { field: 'categories', message: 'Такой категории нет в списке.' },
      ],
    });
  });

  it('the daily upload allowance: its term and kind', async () => {
    updateMock.mockRejectedValue(
      new ApiError(429, 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.', 'RATE_LIMIT_EXCEEDED', {
        files_limit: 100,
        retry_after: 3600,
        reset_at: '2026-10-18T21:00:00.000Z',
      }),
    );
    await expect(updateEstablishmentAction('e1', {})).resolves.toMatchObject({
      ok: false,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 3600,
      limit: 'daily_uploads',
    });
  });

  it('the role gate\'s 403 carries the role; the ownership 403 does not', async () => {
    updateMock.mockRejectedValueOnce(
      new ApiError(403, 'Недостаточно прав для этого действия.', 'FORBIDDEN', {
        required_roles: ['partner'],
        your_role: 'user',
      }),
    );
    await expect(updateEstablishmentAction('e1', {})).resolves.toMatchObject({ role: 'user' });
    updateMock.mockRejectedValueOnce(new ApiError(403, 'Нет доступа', 'FORBIDDEN'));
    const r = await updateEstablishmentAction('e1', {});
    expect('role' in r).toBe(false);
  });

  it('the request limiter: its term and kind', async () => {
    updateMock.mockRejectedValue(
      new ApiError(429, '', 'RATE_LIMIT_EXCEEDED', { limit: 100, retry_after: 12 }),
    );
    await expect(updateEstablishmentAction('e1', {})).resolves.toMatchObject({
      retryAfter: 12,
      limit: 'requests',
    });
  });
});

/*
 * Возобновить приостановленную партнёром карточку (С3). Отказ модератора
 * (403 ADMIN_SUSPENDED) приходит с русским текстом сервера.
 */
describe('resume operation', () => {
  it('returns the new status', async () => {
    resumeMock.mockResolvedValue({ id: 'e1', status: 'active' });
    await expect(resumeEstablishmentAction('e1')).resolves.toEqual({
      ok: true,
      status: 'active',
      base_score: undefined,
    });
    expect(resumeMock).toHaveBeenCalledWith('e1');
  });

  it("a moderator's suspension is refused with the server's text", async () => {
    resumeMock.mockRejectedValue(
      new ApiError(
        403,
        'Заведение приостановлено модератором. Исправьте замечания и отправьте повторно на модерацию.',
        'ADMIN_SUSPENDED',
      ),
    );
    await expect(resumeEstablishmentAction('e1')).resolves.toEqual({
      ok: false,
      code: 'ADMIN_SUSPENDED',
      message:
        'Заведение приостановлено модератором. Исправьте замечания и отправьте повторно на модерацию.',
    });
  });
});
