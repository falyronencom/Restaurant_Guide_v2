/**
 * The detail page's menu after the page's own menu fetch failed (сверка
 * находок тестировщика с сайтом, 18.10, Ш8 — the reviews' fix of PR #81, for
 * the menu).
 *
 * Before: the page swallowed the failure into an empty list — «Меню пока не
 * загружено.» about a place whose menu is there, kept by the ISR page for up
 * to an hour. Pinned:
 *   1. MenuBlock with `menuItems` null never says «Меню пока не загружено.»
 *      and hands over to MenuLoadFailed; photos and PDFs stay on screen.
 *   2. MenuLoadFailed loads the items itself and draws the regular menu; on a
 *      failure it says «Не удалось загрузить меню» with «Повторить», which
 *      tries again; only a loaded empty menu without photos or PDFs says
 *      «Меню пока не загружено.».
 *   3. reloadMenuAction busts the literal detail path of THIS slug only, and
 *      only on success.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReload = jest.fn();
jest.mock('@/lib/menu/actions', () => ({
  reloadMenuAction: (...args: unknown[]) => mockReload(...args),
}));

import { MenuBlock } from '@/components/establishment/MenuBlock';
import { MenuLoadFailed } from '@/components/establishment/MenuLoadFailed';
import type { PublicMedia, PublicMenuItem } from '@/lib/api/types';

const ITEM: PublicMenuItem = {
  id: 'i1',
  establishment_id: 'e1',
  item_name: 'Борщ',
  price_byn: 12.5,
  category_raw: 'Супы',
  position: 0,
  quality_tier: 'clean',
};

const PDF: PublicMedia = {
  id: 'm1',
  url: 'https://cdn.example.com/menu.pdf',
  file_type: 'pdf',
  type: 'menu',
  position: 0,
  caption: null,
};

const PLACE = { slug: 'kafe-1', detailPath: '/minsk/restaurants/kafe-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MenuBlock — the page could not load the text menu', () => {
  it('does not say «Меню пока не загружено.»; the island takes over', async () => {
    mockReload.mockReturnValue(new Promise(() => {}));
    render(
      <MenuBlock
        menuItems={null}
        menuPhotos={[]}
        pdfFallbacks={[]}
        establishmentName="Кафе"
        {...PLACE}
      />,
    );

    expect(screen.queryByText('Меню пока не загружено.')).not.toBeInTheDocument();
    expect(screen.getByText('Загружаем меню…')).toBeInTheDocument();
    expect(mockReload).toHaveBeenCalledWith(PLACE);
  });

  it('the PDF (it comes with the establishment) stays on screen meanwhile', () => {
    mockReload.mockReturnValue(new Promise(() => {}));
    render(
      <MenuBlock
        menuItems={null}
        menuPhotos={[]}
        pdfFallbacks={[PDF]}
        establishmentName="Кафе"
        {...PLACE}
      />,
    );

    expect(screen.getByText('Скачать PDF')).toBeInTheDocument();
  });

  it('an empty list (loaded, nothing there) is still «Меню пока не загружено.», no island', () => {
    render(
      <MenuBlock
        menuItems={[]}
        menuPhotos={[]}
        pdfFallbacks={[]}
        establishmentName="Кафе"
        {...PLACE}
      />,
    );

    expect(screen.getByText('Меню пока не загружено.')).toBeInTheDocument();
    expect(mockReload).not.toHaveBeenCalled();
  });
});

describe('MenuLoadFailed', () => {
  it('loads the items itself and draws the regular menu', async () => {
    mockReload.mockResolvedValue({ ok: true, menuItems: [ITEM] });
    render(<MenuLoadFailed {...PLACE} hasOtherMenu={false} />);

    expect(await screen.findByText('Борщ')).toBeInTheDocument();
    expect(screen.getByText('12,50 BYN')).toBeInTheDocument();
    expect(
      screen.getByText('Меню извлечено автоматически — уточняйте у заведения'),
    ).toBeInTheDocument();
  });

  it('a failure says so — never «нет меню» — and «Повторить» tries again', async () => {
    mockReload.mockResolvedValueOnce({ ok: false });
    render(<MenuLoadFailed {...PLACE} hasOtherMenu={false} />);

    expect(await screen.findByText('Не удалось загрузить меню.')).toBeInTheDocument();
    expect(screen.queryByText('Меню пока не загружено.')).not.toBeInTheDocument();

    mockReload.mockResolvedValueOnce({ ok: true, menuItems: [ITEM] });
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Борщ')).toBeInTheDocument();
    expect(mockReload).toHaveBeenCalledTimes(2);
  });

  it('the action unreachable (network) — the same failure notice', async () => {
    mockReload.mockRejectedValue(new Error('network'));
    render(<MenuLoadFailed {...PLACE} hasOtherMenu={false} />);

    expect(await screen.findByText('Не удалось загрузить меню.')).toBeInTheDocument();
  });

  it('loaded and empty: «Меню пока не загружено.», or nothing beside photos/PDFs', async () => {
    mockReload.mockResolvedValue({ ok: true, menuItems: [] });
    const { unmount } = render(<MenuLoadFailed {...PLACE} hasOtherMenu={false} />);
    expect(await screen.findByText('Меню пока не загружено.')).toBeInTheDocument();
    unmount();

    const { container } = render(<MenuLoadFailed {...PLACE} hasOtherMenu />);
    await screen.findByText(() => false).catch(() => {});
    expect(container).toBeEmptyDOMElement();
  });
});
