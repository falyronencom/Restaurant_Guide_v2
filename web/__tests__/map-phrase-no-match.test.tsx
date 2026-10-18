/**
 * The results map under a phrase nothing (or not everything) matched says so
 * (сверка находок тестировщика с сайтом, 18.10, Ш1).
 *
 * Before: the list said «По запросу «Buno» ничего не найдено» and put the city
 * under «Возможно, вам подойдут», but the map showed the same pins with
 * «Заведений на карте: 46» and nothing else — the suggestions passed off as
 * finds. And entering the map lifted the section so that the list's toolbar
 * (where «ничего не найдено» lives) tucked behind the site header.
 *
 * Pinned:
 *   1. phraseMapNote — the words for each split (none / some / all matched).
 *   2. MapView shows the note over the pins from /api/map's matchedTotal, and
 *      none without the field (a backend before 18.10) or when all matched.
 *   3. ResultsSwitcher lifts the toolbar WITH the map: the toolbar (`header`)
 *      is inside the element whose position the lift scrolls to.
 *
 * Harness for 2: the fake Yandex API of map-phrase-camera.test.tsx.
 */
import { act, render, screen } from '@testing-library/react';

import { ResultsSwitcher } from '@/components/catalog/ResultsSwitcher';

// MapView reads the JS key at load time; set it before requiring the module
// (a static import would be hoisted above this line).
process.env.NEXT_PUBLIC_YANDEX_JS_API_KEY = 'test-key';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapModule = require('@/components/map/MapView') as typeof import('@/components/map/MapView');
const { phraseMapNote } = mapModule;
const MapView = mapModule.default;

jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('@yandex/ymaps3-clusterer', () => ({
  YMapClusterer: class {
    update() {}
  },
  clusterByGrid: () => ({ render: null }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/minsk',
  useSearchParams: () => new URLSearchParams('search=Buno&view=map'),
}));
// The map island itself is not under test in part 3.
jest.mock('next/dynamic', () => () => () => <div>карта</div>);

describe('phraseMapNote', () => {
  it('nothing matched → «ничего не найдено», the pins are places that may suit', () => {
    expect(phraseMapNote('Buno', { matchedTotal: 0, total: 9 })).toEqual({
      title: 'По запросу «Buno» ничего не найдено',
      hint: 'На карте — места, которые могут подойти',
    });
  });

  it('some matched → how many, the rest may suit', () => {
    expect(phraseMapNote('бар', { matchedTotal: 1, total: 9 })).toEqual({
      title: 'По запросу «бар» найдено: 1',
      hint: 'Остальные на карте — места, которые могут подойти',
    });
  });

  it('no note when every pin matched, the set is empty, no split is known or no phrase', () => {
    expect(phraseMapNote('кафе', { matchedTotal: 9, total: 9 })).toBeNull();
    expect(phraseMapNote('Buno', { matchedTotal: 0, total: 0 })).toBeNull();
    expect(phraseMapNote('Buno', null)).toBeNull();
    expect(phraseMapNote(undefined, { matchedTotal: 0, total: 9 })).toBeNull();
  });
});

describe('MapView — the note over the pins', () => {
  const realFetch = global.fetch;
  const realMatchMedia = window.matchMedia;

  const marker = (id: string) => ({
    id,
    slug: id,
    name: id,
    city: 'Минск',
    city_slug: 'minsk',
    address: 'ул. Тестовая, 1',
    latitude: 53.9,
    longitude: 27.56,
    categories: ['Кафе'],
    category_slug: 'cafes',
    cuisines: [],
    price_range: '$$',
    average_rating: null,
    review_count: 0,
    primary_image_url: null,
    has_promotion: false,
  });

  beforeEach(() => {
    (window as unknown as { ymaps3: unknown }).ymaps3 = {
      ready: Promise.resolve(),
      YMap: class {
        bounds = [
          [27.4, 53.8],
          [27.7, 54.0],
        ];
        addChild() {}
        removeChild() {}
        destroy() {}
        update() {}
      },
      YMapDefaultSchemeLayer: class {},
      YMapDefaultFeaturesLayer: class {},
      YMapMarker: class {},
      YMapListener: class {},
    };
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    global.fetch = realFetch;
    window.matchMedia = realMatchMedia;
    delete (window as unknown as { ymaps3?: unknown }).ymaps3;
  });

  async function renderWith(body: object, search = 'Buno') {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }) as unknown as typeof fetch;
    await act(async () => {
      render(<MapView citySlug="minsk" searchParams={{ search }} />);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  }

  it('«Buno», nothing matched: «ничего не найдено» over the pins, next to the count', async () => {
    await renderWith({ establishments: [marker('a'), marker('b')], matchedTotal: 0 });

    expect(await screen.findByText('По запросу «Buno» ничего не найдено')).toBeInTheDocument();
    expect(screen.getByText('На карте — места, которые могут подойти')).toBeInTheDocument();
    expect(screen.getByText('Заведений на карте: 2')).toBeInTheDocument();
  });

  it('a backend without the field, or every pin matched — no note, as before', async () => {
    await renderWith({ establishments: [marker('a'), marker('b')] });
    expect(await screen.findByText('Заведений на карте: 2')).toBeInTheDocument();
    expect(screen.queryByText(/ничего не найдено/)).not.toBeInTheDocument();
  });

  it('every pin matched — no note', async () => {
    await renderWith({ establishments: [marker('a')], matchedTotal: 1 }, 'кафе');
    expect(await screen.findByText('Заведений на карте: 1')).toBeInTheDocument();
    expect(screen.queryByText(/могут подойти/)).not.toBeInTheDocument();
  });
});

describe('ResultsSwitcher — entering the map keeps the toolbar on screen', () => {
  it('the toolbar is inside the lifted section, at the top of it', async () => {
    const realScrollTo = window.scrollTo;
    const scrollTo = jest.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    const measured: Element[] = [];
    const rect = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        measured.push(this);
        return { top: 600 } as DOMRect;
      });

    jest.useFakeTimers();
    try {
      act(() => {
        render(
          <ResultsSwitcher
            citySlug="minsk"
            searchParams={{ search: 'Buno', view: 'map' }}
            header={<h2>По запросу «Buno» ничего не найдено</h2>}
          >
            <p>список</p>
          </ResultsSwitcher>,
        );
      });
      // jsdom has no layout, so the page never looks tall enough: the lift
      // retries 12 × 100 ms, then scrolls anyway.
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      const heading = screen.getByText('По запросу «Buno» ничего не найдено');
      expect(scrollTo).toHaveBeenCalled();
      // The lift measures one element — the section it brings under the
      // site header — and the toolbar is in it, so it lands on screen.
      expect(measured.length).toBeGreaterThan(0);
      expect(measured.every((el) => el.contains(heading))).toBe(true);
      // …at its very top: nothing of the section sits above the toolbar.
      expect(measured[0].firstElementChild).toBe(heading);
    } finally {
      jest.useRealTimers();
      rect.mockRestore();
      window.scrollTo = realScrollTo;
    }
  });
});
