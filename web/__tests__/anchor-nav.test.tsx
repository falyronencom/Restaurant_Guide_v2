/**
 * AnchorNav — the detail page's sticky «Обзор / Меню / …» strip (сверка
 * находок тестировщика с сайтом, 18.10). The site header is sticky too (top-0,
 * z-50, 72px + 1px border, solid background); at top-0 the stuck strip hid
 * under it and was never seen. It must stick right below the header.
 */
import { render, screen } from '@testing-library/react';

import { AnchorNav } from '@/components/establishment/AnchorNav';

beforeAll(() => {
  // jsdom has no IntersectionObserver (the active-section highlight).
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

it('sticks below the 73px site header, not at top-0 under it', () => {
  render(<AnchorNav items={[{ id: 'overview', label: 'Обзор' }]} />);

  const nav = screen.getByRole('navigation', { name: 'Разделы заведения' });
  expect(nav).toHaveClass('sticky', 'top-[73px]');
  expect(nav).not.toHaveClass('top-0');
});
