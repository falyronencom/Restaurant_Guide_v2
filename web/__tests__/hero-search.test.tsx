/**
 * Home hero search — HeroSearch with its real HeroFilters panel and CitySheet.
 * What the visitor chooses (city, phrase, category, cuisines, price, hours,
 * extras) must become ONE address, and only when the orange «›» is pressed.
 *
 * Until 01.11.2026 neither component ran in any test (Crapper measure,
 * docs/handoffs/crapper_measure_20261101: 0 % of 45 branches). Only the router
 * is mocked: the hero navigates (router.push) rather than calling the API —
 * the results page fetches. Expected addresses are literals. Each is then read
 * back the way the results pages read it ([city]/page.tsx and
 * [city]/[category]/page.tsx: acceptedSearchParams, then asString / asList /
 * asHours from lib/catalog-params) — the consumer side of the URL contract,
 * so a parameter the hero names differently from the page would show here.
 */
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HeroSearch } from '@/components/home/HeroSearch';
import type { MetadataSlug } from '@/lib/api/types';
import {
  acceptedSearchParams,
  asHours,
  asList,
  asString,
  type SearchParams,
} from '@/lib/catalog-params';
import { CITY_LS_KEY } from '@/lib/city/selected-city';

// Real slugs: cities and categories as the site names them (catalog-labels),
// cuisines from the backend's CUISINE_SLUG_MAP (constants/urlSlugs.js).
const CITIES: MetadataSlug[] = [
  { slug: 'minsk', name: 'Минск' },
  { slug: 'grodno', name: 'Гродно' },
];
const CATEGORIES: MetadataSlug[] = [
  { slug: 'restaurants', name: 'Рестораны' },
  { slug: 'cafes', name: 'Кафе' },
];
const CUISINES: MetadataSlug[] = [
  { slug: 'italian', name: 'Итальянская' },
  { slug: 'japanese', name: 'Японская' },
  { slug: 'georgian', name: 'Грузинская' },
];

beforeEach(() => {
  mockPush.mockReset();
  localStorage.clear();
});

function renderHero() {
  const user = userEvent.setup();
  render(<HeroSearch cities={CITIES} categories={CATEGORIES} cuisines={CUISINES} />);
  return user;
}

function filtersTrigger() {
  return screen.getByRole('button', { name: /^Фильтры/ });
}

/** Open the «Фильтры» sheet and return it. */
async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(filtersTrigger());
  return screen.findByRole('dialog');
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  sheet: HTMLElement,
  name: string | RegExp,
) {
  await user.click(within(sheet).getByRole('button', { name }));
}

async function applyFilters(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement) {
  await user.click(within(sheet).getByRole('button', { name: 'Применить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

async function search(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Найти' }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  return mockPush.mock.calls[0][0] as string;
}

/** The address as a results page receives it: path segments + the accepted query. */
function readBack(href: string) {
  const url = new URL(href, 'https://nirivio.by');
  const raw: SearchParams = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const sp = acceptedSearchParams(raw, CUISINES);
  return {
    path: url.pathname.split('/').filter(Boolean),
    search: asString(sp.search),
    cuisines: asList(sp.cuisine),
    priceRange: asList(sp.priceRange),
    features: asList(sp.features),
    hours: asHours(sp.hours),
  };
}

describe('HeroSearch — the address the orange button opens', () => {
  it('nothing chosen: the default city, no query', async () => {
    const user = renderHero();

    expect(await search(user)).toBe('/minsk');
  });

  it('a phrase: trimmed, carried as «search»', async () => {
    const user = renderHero();
    await user.type(screen.getByRole('searchbox', { name: 'Поиск заведения' }), '  суши бар  ');

    const href = await search(user);
    expect(href).toBe('/minsk?search=%D1%81%D1%83%D1%88%D0%B8+%D0%B1%D0%B0%D1%80');
    expect(readBack(href).search).toBe('суши бар');
  });

  it('only spaces typed: no «search» at all', async () => {
    const user = renderHero();
    await user.type(screen.getByRole('searchbox', { name: 'Поиск заведения' }), '   ');

    expect(await search(user)).toBe('/minsk');
  });

  it('everything chosen: category in the path, every facet in the query, read back the same', async () => {
    const user = renderHero();
    await user.type(screen.getByRole('searchbox', { name: 'Поиск заведения' }), 'пицца');

    const sheet = await openFilters(user);
    await pick(user, sheet, 'Рестораны');
    await pick(user, sheet, 'Итальянская');
    await pick(user, sheet, 'Японская');
    await pick(user, sheet, /до 20 руб/);
    await pick(user, sheet, /до 50 руб/);
    await pick(user, sheet, 'До 22:00');
    await pick(user, sheet, 'Wi-Fi');
    await pick(user, sheet, 'Летняя терраса');
    await applyFilters(user, sheet);

    // 1 category + 2 cuisines + 2 prices + 1 hours + 2 extras.
    expect(filtersTrigger()).toHaveTextContent('Фильтры8');

    const href = await search(user);
    expect(href).toBe(
      '/minsk/restaurants?search=%D0%BF%D0%B8%D1%86%D1%86%D0%B0' +
        '&cuisine=italian%2Cjapanese&priceRange=%24%2C%24%24' +
        '&features=wifi%2Cterrace&hours=until_22',
    );
    expect(readBack(href)).toEqual({
      path: ['minsk', 'restaurants'],
      search: 'пицца',
      cuisines: ['italian', 'japanese'],
      priceRange: ['$', '$$'],
      features: ['wifi', 'terrace'],
      hours: 'until_22',
    });
  });

  it('all cuisines and all prices mean «no limit» and are left out; all extras are a real filter and stay', async () => {
    const user = renderHero();

    const sheet = await openFilters(user);
    for (const name of ['Итальянская', 'Японская', 'Грузинская']) {
      await pick(user, sheet, name);
    }
    for (const price of [/до 20 руб/, /до 50 руб/, /более 50 руб/]) {
      await pick(user, sheet, price);
    }
    for (const extra of [
      'Доставка еды',
      'Wi-Fi',
      'Летняя терраса',
      'Парковка',
      'Живая музыка',
      'Детская зона',
      'Банкет',
      'Можно с животными',
      'Зал для курящих',
    ]) {
      await pick(user, sheet, extra);
    }
    await applyFilters(user, sheet);

    const href = await search(user);
    expect(href).toBe(
      '/minsk?features=delivery%2Cwifi%2Cterrace%2Cparking%2Clive_music' +
        '%2Ckids_zone%2Cbanquet%2Cpets_allowed%2Csmoking',
    );
    expect(readBack(href)).toMatchObject({
      path: ['minsk'],
      cuisines: [],
      priceRange: [],
      features: [
        'delivery',
        'wifi',
        'terrace',
        'parking',
        'live_music',
        'kids_zone',
        'banquet',
        'pets_allowed',
        'smoking',
      ],
    });
  });

  it('a city chosen in the city sheet replaces the default in the path', async () => {
    const user = renderHero();
    await user.click(screen.getByRole('button', { name: 'Минск' }));
    const citySheet = await screen.findByRole('dialog');
    await user.click(within(citySheet).getByRole('button', { name: 'Гродно' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const sheet = await openFilters(user);
    await pick(user, sheet, 'Кафе');
    await applyFilters(user, sheet);

    expect(await search(user)).toBe('/grodno/cafes');
    // The choice is remembered for the next visit (useSelectedCity).
    expect(localStorage.getItem(CITY_LS_KEY)).toBe('grodno');
  });
});

describe('HeroFilters — choosing, un-choosing, resetting', () => {
  it('choosing filters does not navigate; only the orange button does', async () => {
    const user = renderHero();

    const sheet = await openFilters(user);
    await pick(user, sheet, 'Рестораны');
    await pick(user, sheet, 'Итальянская');
    await applyFilters(user, sheet);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a second press un-chooses: category, cuisine, price, extra, hours', async () => {
    const user = renderHero();

    const sheet = await openFilters(user);
    const names: Array<string | RegExp> = [
      'Рестораны',
      'Итальянская',
      /до 50 руб/,
      'Парковка',
      'Круглосуточно',
    ];
    for (const name of names) {
      await pick(user, sheet, name);
      expect(within(sheet).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
    for (const name of names) {
      await pick(user, sheet, name);
      expect(within(sheet).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    await applyFilters(user, sheet);

    expect(filtersTrigger()).toHaveTextContent(/^Фильтры$/);
    expect(await search(user)).toBe('/minsk');
  });

  it('category and hours are single-choice: the later press wins', async () => {
    const user = renderHero();

    const sheet = await openFilters(user);
    await pick(user, sheet, 'Рестораны');
    await pick(user, sheet, 'Кафе');
    await pick(user, sheet, 'До 22:00');
    await pick(user, sheet, 'До утра');
    expect(within(sheet).getByRole('button', { name: 'Рестораны' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(sheet).getByRole('button', { name: 'До 22:00' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await applyFilters(user, sheet);

    expect(filtersTrigger()).toHaveTextContent('Фильтры2');
    expect(await search(user)).toBe('/minsk/cafes?hours=until_morning');
  });

  it('«Сбросить» is off with nothing chosen and clears every choice, the category included', async () => {
    const user = renderHero();

    let sheet = await openFilters(user);
    const reset = within(sheet).getByRole('button', { name: 'Сбросить' });
    expect(reset).toBeDisabled();

    await pick(user, sheet, 'Кафе');
    await pick(user, sheet, 'Грузинская');
    await pick(user, sheet, /более 50 руб/);
    await pick(user, sheet, 'Круглосуточно');
    await pick(user, sheet, 'Банкет');
    expect(reset).toBeEnabled();
    await applyFilters(user, sheet);
    expect(filtersTrigger()).toHaveTextContent('Фильтры5');

    sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('button', { name: 'Сбросить' }));
    for (const name of ['Кафе', 'Грузинская', /более 50 руб/, 'Круглосуточно', 'Банкет']) {
      expect(within(sheet).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(within(sheet).getByRole('button', { name: 'Сбросить' })).toBeDisabled();
    await applyFilters(user, sheet);

    expect(filtersTrigger()).toHaveTextContent(/^Фильтры$/);
    expect(await search(user)).toBe('/minsk');
  });
});
