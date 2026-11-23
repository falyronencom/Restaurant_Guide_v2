/**
 * The card's «Меню» section in the cabinet (part 1 of «Кабинет партнёра на
 * сайте», directive 1.2–1.4). The network is mocked at the client fetchers
 * (lib/partner/client); the screen is what is asserted: sections, prices,
 * marks in words, the edit and its re-read (a dish is never shown twice), the
 * restart behind its window and its refusals, the expired session, the
 * reading while the recognition runs.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

jest.mock('@/lib/partner/client', () => ({
  loadMenuItems: jest.fn(),
  updateMenuItemAction: jest.fn(),
  refreshCardPageAction: jest.fn(),
  retryOcrAction: jest.fn(),
}));

import { MenuSection } from '@/components/cabinet/menu/MenuSection';
import {
  loadMenuItems,
  refreshCardPageAction,
  retryOcrAction,
  updateMenuItemAction,
} from '@/lib/partner/client';
import type { MenuRecognition, PartnerMenuItem } from '@/lib/partner/menu';
import { _resetForTests as resetPageRefresh } from '@/lib/partner/page-refresh-client';

const loadMock = loadMenuItems as jest.Mock;
const updateMock = updateMenuItemAction as jest.Mock;
const refreshMock = refreshCardPageAction as jest.Mock;
const retryMock = retryOcrAction as jest.Mock;

const line = (over: Partial<PartnerMenuItem>): PartnerMenuItem => ({
  id: 'i1',
  establishment_id: 'e1',
  media_id: 'm1',
  item_name: 'Драники',
  price_byn: 10,
  category_raw: 'Горячее',
  sanity_flag: null,
  position: 0,
  guest_hidden_reason: null,
  ...over,
});

const DONE: MenuRecognition = { status: 'done', reason: null, cause: null };

function menu(
  items: PartnerMenuItem[],
  recognition: MenuRecognition | null = DONE,
  hasHiddenItems: boolean | null = false,
  extra: { emailUnconfirmed?: boolean } = {},
) {
  return { ok: true, menu: { items, recognition, hasHiddenItems }, ...extra };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useRealTimers();
  for (const mock of [loadMock, updateMock, refreshMock, retryMock]) mock.mockReset();
  refreshMock.mockResolvedValue({ ok: true, page: { refreshed: true } });
  resetPageRefresh();
});

describe('the list', () => {
  it('sections in their order, prices as on the public page, marks in words, alcohol, the hidden note', async () => {
    loadMock.mockResolvedValue(
      menu(
        [
          line({ id: 'a', item_name: 'Борщ', price_byn: 8.5, category_raw: 'Супы' }),
          line({ id: 'b', item_name: 'Вода', price_byn: null, category_raw: '' }),
          line({
            id: 'c',
            item_name: 'Стейк',
            price_byn: 1200,
            category_raw: 'Горячее',
            sanity_flag: { reason: 'price_above_threshold', details: { price: 1200, threshold: 1000 } },
          }),
          line({ id: 'd', item_name: 'Вино красное', price_byn: 15, category_raw: 'Вино', guest_hidden_reason: 'alcohol' }),
        ],
        DONE,
        true,
      ),
    );
    render(<MenuSection id="e1" />);
    await flush();

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Супы',
      'Без раздела',
      'Горячее',
      'Вино',
    ]);
    expect(screen.getByText('8,50 BYN')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('1200 BYN')).toBeInTheDocument();
    expect(screen.getByText('Требует внимания')).toBeInTheDocument();
    expect(
      screen.getByText('Цена выше порога: 1200 BYN при пороге 1000 BYN. Проверьте, верно ли распознано.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/price_above_threshold/)).not.toBeInTheDocument();
    expect(screen.getByText('Гостям не показывается: алкоголь и табак')).toBeInTheDocument();
    expect(screen.getByText(/Модератор скрыл часть позиций — гости их не видят\./)).toBeInTheDocument();
  });

  it('after an edit the menu is read again: the copy of the dish in the other file is not left at the old price', async () => {
    // One dish of a menu uploaded as two files: two rows, one line for the guest.
    loadMock
      .mockResolvedValueOnce(menu([line({ id: 'i1', media_id: 'm1' }), line({ id: 'i2', media_id: 'm2' })]))
      .mockResolvedValueOnce(
        menu([line({ id: 'i1', media_id: 'm1', price_byn: 12 }), line({ id: 'i2', media_id: 'm2', price_byn: 12 })]),
      );
    updateMock.mockResolvedValue({ ok: true, item: line({ id: 'i1', media_id: 'm1', price_byn: 12 }) });
    render(<MenuSection id="e1" />);
    await flush();
    expect(screen.getAllByText('10 BYN')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: /^Изменить/ })[0]);
    fireEvent.change(screen.getByLabelText('Цена (BYN)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await flush();
    await flush();

    expect(updateMock).toHaveBeenCalledWith('i1', { price_byn: 12 });
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('10 BYN')).not.toBeInTheDocument();
    expect(screen.getAllByText('12 BYN')).toHaveLength(2);
    expect(screen.getByText('Изменения сохранены')).toBeInTheDocument();
  });

  it('a line gone meanwhile: T7б, and the menu is read again', async () => {
    loadMock.mockResolvedValue(menu([line({})]));
    updateMock.mockResolvedValue({ ok: false, code: 'MENU_ITEM_NOT_FOUND' });
    render(<MenuSection id="e1" />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Изменить/ }));
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Драники с грибами' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await flush();
    await flush();

    expect(screen.getByText('Позиция не найдена — возможно, меню распознано заново. Список обновлён.')).toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('a refused field stays in the window and nothing is sent', async () => {
    loadMock.mockResolvedValue(menu([line({})]));
    render(<MenuSection id="e1" />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Изменить/ }));
    fireEvent.change(screen.getByLabelText('Цена (BYN)'), { target: { value: '6,505' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await flush();

    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.getByText('Цена — число от 0 до 99 999 999,99, не больше двух знаков после запятой')).toBeInTheDocument();
  });

  it('«Всё верно» sends the line back as it is — its current price', async () => {
    loadMock.mockResolvedValue(
      menu([line({ price_byn: 0.3, sanity_flag: { reason: 'price_below_threshold', details: { price: 0.3, threshold: 0.5 } } })]),
    );
    updateMock.mockResolvedValue({ ok: true, item: line({ price_byn: 0.3 }) });
    render(<MenuSection id="e1" />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Всё верно' }));
    await flush();

    expect(updateMock).toHaveBeenCalledWith('i1', { price_byn: 0.3 });
  });
});

describe('the states', () => {
  it('recognised and every line hidden: «Позиции не показываются», no restart', async () => {
    loadMock.mockResolvedValue(menu([], DONE, true));
    render(<MenuSection id="e1" />);
    await flush();

    expect(screen.getByRole('heading', { name: 'Позиции не показываются' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Перезапустить распознавание/ })).not.toBeInTheDocument();
  });

  it('no menu files: «Меню ещё не загружено», no restart', async () => {
    loadMock.mockResolvedValue(menu([], { status: 'none', reason: null, cause: null }));
    render(<MenuSection id="e1" />);
    await flush();

    expect(screen.getByRole('heading', { name: 'Меню ещё не загружено' })).toBeInTheDocument();
    expect(screen.getByText(/в разделе «Фотографии и меню»/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Перезапустить распознавание/ })).not.toBeInTheDocument();
  });

  it('not started, the e-mail unconfirmed: the state and T5 with its link back to the menu', async () => {
    loadMock.mockResolvedValue(
      menu([], { status: 'not_started', reason: null, cause: null }, false, { emailUnconfirmed: true }),
    );
    render(<MenuSection id="e1" />);
    await flush();

    expect(screen.getByRole('heading', { name: 'Распознавание не запущено' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Подтвердить почту' })).toHaveAttribute(
      'href',
      '/verify-email?returnTo=%2Fcabinet%2Fe1%2Fmenu',
    );
  });

  it('the state could not be read: «Не удалось обновить…» with «Обновить»', async () => {
    loadMock.mockResolvedValue(menu([line({})], null));
    render(<MenuSection id="e1" />);
    await flush();

    expect(screen.getByText('Не удалось обновить — на экране может быть не последнее состояние.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
  });

  it('an expired session: «Сессия истекла.» and «Войти снова» back to this section', async () => {
    loadMock.mockResolvedValue({ ok: false, code: 'NO_SESSION' });
    render(<MenuSection id="e1" />);
    await flush();

    expect(screen.getByText('Сессия истекла.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти снова' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fcabinet%2Fe1%2Fmenu',
    );
  });
});

describe('the restart', () => {
  async function openRestart() {
    fireEvent.click(screen.getByRole('button', { name: /Перезапустить распознавание/ }));
    await flush();
    return screen.getByRole('dialog');
  }

  it('behind the window T1; queued → «Распознавание запущено (N из M)» and the menu read again', async () => {
    loadMock.mockResolvedValue(menu([line({})]));
    retryMock.mockResolvedValue({ ok: true, enqueuedJobs: 2, totalPdfs: 3 });
    render(<MenuSection id="e1" />);
    await flush();

    const dialog = await openRestart();
    expect(within(dialog).getByText('Перезапустить распознавание?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Названия, цены и разделы, которые вы исправили, вернутся к распознанным\./),
    ).toBeInTheDocument();
    expect(retryMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Перезапустить' }));
    await flush();
    await flush();

    expect(retryMock).toHaveBeenCalledWith('e1');
    expect(screen.getByText('Распознавание запущено (2 из 3)')).toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('the sixth of the day → T2 with its term', async () => {
    loadMock.mockResolvedValue(menu([line({})]));
    retryMock.mockResolvedValue({
      ok: false,
      code: 'RATE_LIMIT_EXCEEDED',
      limit: 'ocr_restarts',
      limitCount: 5,
      retryAfter: 3 * 3600 + 5 * 60,
    });
    render(<MenuSection id="e1" />);
    await flush();

    const dialog = await openRestart();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перезапустить' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Перезапустить распознавание можно 5 раз в сутки. Следующий раз — через 3 ч 5 мин.',
    );
  });

  it('the day\'s share spent, the e-mail unconfirmed → T3 and T5', async () => {
    loadMock.mockResolvedValue(menu([line({})]));
    retryMock.mockResolvedValue({
      ok: false,
      code: 'RATE_LIMIT_EXCEEDED',
      limit: 'ocr_allowance',
      retryAfter: 7200,
      emailUnconfirmed: true,
    });
    render(<MenuSection id="e1" />);
    await flush();

    const dialog = await openRestart();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перезапустить' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('Лимит распознавания меню на сегодня исчерпан. Продолжить можно через 2 ч.');
    expect(screen.getByRole('link', { name: 'Подтвердить почту' })).toBeInTheDocument();
  });
});

describe('while the recognition runs', () => {
  it('reads again every 30 s; when it ends, the card\'s public page is refreshed', async () => {
    jest.useFakeTimers();
    const processing: MenuRecognition = { status: 'processing', reason: null, cause: null };
    loadMock
      .mockResolvedValueOnce(menu([line({})], processing))
      .mockResolvedValueOnce(menu([line({})], processing))
      .mockResolvedValueOnce(menu([line({ price_byn: 11 })], DONE));
    render(<MenuSection id="e1" />);
    await flush();
    expect(screen.getByText(/Распознаём меню заново…/)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();
    expect(loadMock).toHaveBeenCalledTimes(3);
    expect(refreshMock).toHaveBeenCalledWith('e1');
    expect(screen.queryByText(/Распознаём меню заново…/)).not.toBeInTheDocument();

    // Done: no more reading.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    await flush();
    expect(loadMock).toHaveBeenCalledTimes(3);
  });
});
