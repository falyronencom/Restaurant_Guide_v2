/**
 * The cabinet's writes and the card's public page (part 1 of «Кабинет
 * партнёра на сайте», directive 1.8): the operations with the real
 * lib/partner/card-page, the API mocked at its endpoints, next/cache's
 * revalidatePath recorded. Each write that changes the guest's page drops the
 * card's literal address; a card no guest sees drops nothing; the address
 * comes from the API's answer — for a menu line, the line's own card, not the
 * id of the request. Also here: the restart's limits told apart (T2, T3) and
 * the e-mail asked of the account only when it matters (T5).
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/metadata', () => ({ getMetadata: jest.fn() }));
jest.mock('@/lib/api/endpoints/profile', () => ({ getMe: jest.fn() }));
jest.mock('@/lib/auth/session', () => ({
  getSessionUser: jest.fn(),
  refreshSession: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/partner', () => ({
  createEstablishment: jest.fn(),
  updateEstablishment: jest.fn(),
  submitEstablishment: jest.fn(),
  listEstablishments: jest.fn(),
  getEstablishment: jest.fn(),
  retryOcr: jest.fn(),
  deleteEstablishment: jest.fn(),
  resumeEstablishment: jest.fn(),
  suspendEstablishment: jest.fn(),
  listMenuItems: jest.fn(),
  updateMenuItem: jest.fn(),
}));

import { revalidatePath } from 'next/cache';

import { getMetadata } from '@/lib/api/endpoints/metadata';
import {
  getEstablishment,
  listMenuItems,
  resumeEstablishment,
  retryOcr,
  suspendEstablishment,
  updateEstablishment,
  updateMenuItem,
} from '@/lib/api/endpoints/partner';
import { getMe } from '@/lib/api/endpoints/profile';
import { ApiError } from '@/lib/api/types';
import { getSessionUser } from '@/lib/auth/session';
import { _resetForTests } from '@/lib/partner/card-page';
import { refusalMessage } from '@/lib/partner/errors';
import {
  loadEstablishmentForEdit,
  loadMenuItemsAction,
  refreshCardPageAction,
  resumeEstablishmentAction,
  retryOcrAction,
  suspendEstablishmentAction,
  updateEstablishmentAction,
  updateMenuItemAction,
} from '@/lib/partner/operations';

const revalidateMock = revalidatePath as jest.Mock;
const getMock = getEstablishment as jest.Mock;
const meMock = getMe as jest.Mock;

const META = {
  cities: [
    { slug: 'minsk', name: 'Минск' },
    { slug: 'mogilev', name: 'Могилев' },
  ],
  categories: [
    { slug: 'restaurants', name: 'Ресторан' },
    { slug: 'cafes', name: 'Кафе' },
    { slug: 'bars', name: 'Бар' },
  ],
  cuisines: [],
};

const CARD = {
  id: 'e1',
  slug: 'kafe-u-mosta',
  city: 'Минск',
  categories: ['Кафе'],
  status: 'active',
  moderation_notes: null,
};

const LINE = {
  id: 'i1',
  establishment_id: 'e1',
  media_id: 'm1',
  item_name: 'Драники',
  price_byn: 14,
  category_raw: 'Горячее',
  sanity_flag: null,
  position: 0,
  guest_hidden_reason: null,
};

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  for (const mock of [getMock, meMock, getMetadata as jest.Mock, updateMenuItem as jest.Mock]) mock.mockReset();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (getSessionUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'p@e.by', name: 'П', role: 'partner', avatarUrl: null });
  getMock.mockResolvedValue(CARD);
  _resetForTests();
  // Nothing here may reach a real network.
  global.fetch = jest.fn(() => {
    throw new Error('real network in a unit test');
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('the save of the form (PUT)', () => {
  it('a published card: its page is dropped at the address of the save\'s answer', async () => {
    (updateEstablishment as jest.Mock).mockResolvedValue({ ...CARD, base_score: 80 });

    const r = await updateEstablishmentAction('e1', {});

    expect(r).toEqual({ ok: true, status: 'active', base_score: 80, page: { refreshed: true } });
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith('/minsk/cafes/kafe-u-mosta');
  });

  it('a draft: nothing, and no `page` in the answer', async () => {
    (updateEstablishment as jest.Mock).mockResolvedValue({ ...CARD, status: 'draft', base_score: 40 });

    await expect(updateEstablishmentAction('e1', {})).resolves.toEqual({ ok: true, status: 'draft', base_score: 40 });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('a second save inside the card\'s interval: deferred, with its term', async () => {
    (updateEstablishment as jest.Mock).mockResolvedValue(CARD);
    await updateEstablishmentAction('e1', {});

    const r = await updateEstablishmentAction('e1', {});

    expect(r.ok && r.page?.refreshed).toBe(false);
    expect(r.ok && r.page?.retryInMs).toBeGreaterThan(0);
    expect(revalidateMock).toHaveBeenCalledTimes(1);
  });

  it('a save that moved the card (first category): the old address too', async () => {
    (updateEstablishment as jest.Mock).mockResolvedValue({ ...CARD, categories: ['Бар', 'Кафе'] });

    await updateEstablishmentAction('e1', {}, { city: 'Минск', category: 'Кафе' });

    expect(revalidateMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/minsk/bars/kafe-u-mosta',
      '/minsk/cafes/kafe-u-mosta',
    ]);
  });

  it('a failure of the drop never fails the save', async () => {
    (updateEstablishment as jest.Mock).mockResolvedValue(CARD);
    revalidateMock.mockImplementationOnce(() => {
      throw new Error('revalidate failed');
    });

    await expect(updateEstablishmentAction('e1', {})).resolves.toMatchObject({ ok: true, status: 'active' });
  });
});

describe('a menu line (PATCH) and «Всё верно»', () => {
  it('drops the page of the line\'s own card — read by the line\'s establishment_id', async () => {
    (updateMenuItem as jest.Mock).mockResolvedValue({ ...LINE, establishment_id: 'e7' });
    getMock.mockResolvedValue({ ...CARD, id: 'e7', slug: 'drugoe' });

    const r = await updateMenuItemAction('i1', { price_byn: 15 });

    expect(getMock).toHaveBeenCalledWith('e7');
    expect(revalidateMock).toHaveBeenCalledWith('/minsk/cafes/drugoe');
    expect(r).toMatchObject({ ok: true, page: { refreshed: true } });
  });

  it('inside the card\'s interval: deferred without reading the card again', async () => {
    (updateMenuItem as jest.Mock).mockResolvedValue(LINE);
    await updateMenuItemAction('i1', { price_byn: 15 });
    getMock.mockClear();

    const r = await updateMenuItemAction('i1', { price_byn: 16 });

    expect(getMock).not.toHaveBeenCalled();
    expect(r.ok && r.page?.retryInMs).toBeGreaterThan(0);
    expect(revalidateMock).toHaveBeenCalledTimes(1);
  });

  it('a line of a card no guest sees: nothing dropped', async () => {
    (updateMenuItem as jest.Mock).mockResolvedValue(LINE);
    getMock.mockResolvedValue({ ...CARD, status: 'pending' });

    const r = await updateMenuItemAction('i1', { item_name: 'Драники с грибами' });

    expect(r).toEqual({ ok: true, item: LINE });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('a refusal comes back with its code', async () => {
    (updateMenuItem as jest.Mock).mockRejectedValue(new ApiError(404, 'Menu item not found or access denied', 'MENU_ITEM_NOT_FOUND'));

    await expect(updateMenuItemAction('i1', { price_byn: 1 })).resolves.toEqual({ ok: false, code: 'MENU_ITEM_NOT_FOUND' });
  });
});

describe('the pause and the resume — at once', () => {
  it('suspend drops the page although the card is now suspended, inside the interval too', async () => {
    (updateEstablishment as jest.Mock).mockResolvedValue(CARD);
    await updateEstablishmentAction('e1', {}); // a drop a moment ago
    revalidateMock.mockClear();
    (suspendEstablishment as jest.Mock).mockResolvedValue({ id: 'e1', status: 'suspended' });
    getMock.mockResolvedValue({ ...CARD, status: 'suspended' });

    const r = await suspendEstablishmentAction('e1');

    expect(r).toMatchObject({ ok: true, status: 'suspended', page: { refreshed: true } });
    expect(revalidateMock).toHaveBeenCalledWith('/minsk/cafes/kafe-u-mosta');
  });

  it('resume drops the page and brings the address back', async () => {
    (resumeEstablishment as jest.Mock).mockResolvedValue({ id: 'e1', status: 'active' });

    const r = await resumeEstablishmentAction('e1');

    expect(r).toMatchObject({ ok: true, status: 'active', publicPath: '/minsk/cafes/kafe-u-mosta' });
    expect(revalidateMock).toHaveBeenCalledWith('/minsk/cafes/kafe-u-mosta');
  });
});

describe('refresh-page', () => {
  it('a published card: dropped', async () => {
    await expect(refreshCardPageAction('e1')).resolves.toEqual({ ok: true, page: { refreshed: true } });
  });

  it('inside the interval: deferred; `final` (the partner leaves): dropped', async () => {
    await refreshCardPageAction('e1');

    const deferred = await refreshCardPageAction('e1');
    expect(deferred.ok && deferred.page.refreshed).toBe(false);

    await expect(refreshCardPageAction('e1', { final: true })).resolves.toEqual({ ok: true, page: { refreshed: true } });
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });

  it('a card not published: nothing', async () => {
    getMock.mockResolvedValue({ ...CARD, status: 'draft' });
    await expect(refreshCardPageAction('e1')).resolves.toEqual({ ok: true, page: { refreshed: false } });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe('the card\'s load — its public address', () => {
  it('a published card comes with it', async () => {
    await expect(loadEstablishmentForEdit('e1')).resolves.toMatchObject({ ok: true, publicPath: '/minsk/cafes/kafe-u-mosta' });
  });

  it('another status — without', async () => {
    getMock.mockResolvedValue({ ...CARD, status: 'suspended' });
    const r = await loadEstablishmentForEdit('e1');
    expect(r.ok && 'publicPath' in r).toBe(false);
  });
});

describe('the restart\'s refusals (T2, T3) and the e-mail (T5)', () => {
  const restarts = new ApiError(429, 'Слишком много запросов. Попробуйте позже.', 'RATE_LIMIT_EXCEEDED', {
    limit: 5,
    window: '86400 seconds',
    retry_after: 3 * 3600 + 5 * 60,
    reset_at: '2026-11-23T21:00:00.000Z',
  });
  const share = new ApiError(429, 'Слишком много запросов. Попробуйте позже.', 'RATE_LIMIT_EXCEEDED', {
    jobs_limit: 10,
    retry_after: 2 * 3600,
    reset_at: '2026-11-23T21:00:00.000Z',
  });
  const requests = new ApiError(429, 'Слишком много запросов. Попробуйте позже.', 'RATE_LIMIT_EXCEEDED', {
    limit: 100,
    window: '1 minute',
    retry_after: 30,
    reset_at: '2026-11-23T21:00:00.000Z',
  });

  it('the restarts of the day → T2 with the term', async () => {
    (retryOcr as jest.Mock).mockRejectedValue(restarts);
    const r = await retryOcrAction('e1');
    expect(r.ok).toBe(false);
    expect(refusalMessage(r as never)).toBe(
      'Перезапустить распознавание можно 5 раз в сутки. Следующий раз — через 3 ч 5 мин.',
    );
    expect(meMock).not.toHaveBeenCalled();
  });

  it('the day\'s share of recognition → T3 with the term', async () => {
    (retryOcr as jest.Mock).mockRejectedValue(share);
    meMock.mockResolvedValue({ emailVerified: true });
    const r = await retryOcrAction('e1');
    expect(refusalMessage(r as never)).toBe(
      'Лимит распознавания меню на сегодня исчерпан. Продолжить можно через 2 ч.',
    );
    expect(r).not.toHaveProperty('emailUnconfirmed');
  });

  it('the share, an account without a confirmed e-mail → T3 and the T5 flag', async () => {
    (retryOcr as jest.Mock).mockRejectedValue(share);
    meMock.mockResolvedValue({ emailVerified: false });
    await expect(retryOcrAction('e1')).resolves.toMatchObject({ ok: false, emailUnconfirmed: true });
  });

  it('the request limiter of a minute → the old phrase', async () => {
    (retryOcr as jest.Mock).mockRejectedValue(requests);
    const r = await retryOcrAction('e1');
    expect(refusalMessage(r as never)).toBe('Слишком много запросов подряд. Попробуйте через 30 сек.');
  });

  it('a restart queued → how many of how many', async () => {
    (retryOcr as jest.Mock).mockResolvedValue({ enqueuedJobs: 2, totalPdfs: 3 });
    await expect(retryOcrAction('e1')).resolves.toEqual({ ok: true, enqueuedJobs: 2, totalPdfs: 3 });
  });
});

describe('the menu\'s load — the e-mail asked only when it matters (T5)', () => {
  const menu = (recognition: unknown) => ({ items: [], recognition, hasHiddenItems: false });

  it.each([
    [{ status: 'not_started', reason: null, cause: null }],
    [{ status: 'failed', reason: 'Сбой', cause: 'service_failure' }],
  ])('%j and an unconfirmed e-mail → emailUnconfirmed', async (recognition) => {
    (listMenuItems as jest.Mock).mockResolvedValue(menu(recognition));
    meMock.mockResolvedValue({ emailVerified: false });
    await expect(loadMenuItemsAction('e1')).resolves.toMatchObject({ ok: true, emailUnconfirmed: true });
  });

  it.each([
    [{ status: 'done', reason: null, cause: null }],
    [{ status: 'failed', reason: 'Не удалось прочитать файл', cause: 'unreadable' }],
    [null],
  ])('%j → the account is not asked', async (recognition) => {
    (listMenuItems as jest.Mock).mockResolvedValue(menu(recognition));
    const r = await loadMenuItemsAction('e1');
    expect(meMock).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty('emailUnconfirmed');
  });
});
