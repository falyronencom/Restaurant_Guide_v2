/**
 * The card's public page, dropped after the partner's own writes
 * (lib/partner/card-page.ts; part 1 of «Кабинет партнёра на сайте»).
 *
 * 1. The address. The site builds it from the card's slug, city and first
 *    category through its metadata; the API's public projection builds it
 *    from its own maps (backend constants/urlSlugs.js: cityCyrillicToSlug,
 *    categoryCyrillicToSlug of categories[0]). The two must agree for every
 *    city and category the maps know — «Могилёв» and «Могилев» both — or the
 *    cabinet drops a page no guest visits. The expected addresses are read
 *    from the backend's file itself, the metadata built from it as the API's
 *    getPublicMetadata does (one name per slug, «Могилев» without «ё»).
 * 2. Properties of the fold (probe 6 of the verification trials, 21.11.2026):
 *    for any input the city part is a known slug or the fallback, folding
 *    twice is folding once, and «ё»/«е» never change the answer.
 * 3. The bounds: one drop per card in 30 s (the next one is deferred with its
 *    term), 300 per account in an hour, the pause and a moved address at once,
 *    and the visitors' allowance never touched.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/metadata', () => ({ getMetadata: jest.fn() }));
jest.mock('@/lib/cached-page-drops', () => ({ mayDropCachedPage: jest.fn(async () => true) }));

import { revalidatePath } from 'next/cache';

import { getMetadata } from '@/lib/api/endpoints/metadata';
import type { PublicMetadata } from '@/lib/api/types';
import { mayDropCachedPage } from '@/lib/cached-page-drops';
import {
  CARD_INTERVAL_MS,
  DROPS_PER_ACCOUNT_HOUR,
  _resetForTests,
  cardDropDue,
  cardPagePathFrom,
  dropCardPaths,
  foldYo,
  refreshCardPage,
} from '@/lib/partner/card-page';

const revalidateMock = revalidatePath as jest.Mock;
const metadataMock = getMetadata as jest.Mock;

/** `export const NAME = { 'Ключ': 'slug', … }` of the backend's file, as pairs. */
function backendMap(source: string, name: string): Array<[string, string]> {
  const block = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\};`).exec(source);
  if (!block) throw new Error(`${name} not found in backend urlSlugs.js`);
  const pairs = [...block[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]] as [string, string]);
  if (pairs.length === 0) throw new Error(`${name} has no entries`);
  return pairs;
}

const URL_SLUGS = readFileSync(
  path.join(__dirname, '..', '..', 'backend', 'src', 'constants', 'urlSlugs.js'),
  'utf8',
);
const CITY_MAP = backendMap(URL_SLUGS, 'CITY_SLUG_MAP');
const CATEGORY_MAP = backendMap(URL_SLUGS, 'CATEGORY_SLUG_MAP');

/** The API's getPublicMetadata: one city per slug, «Могилев» for mogilev. */
function metadataLikeTheApi(): Pick<PublicMetadata, 'cities' | 'categories'> {
  const cities: PublicMetadata['cities'] = [];
  const seen = new Set<string>();
  for (const [name, slug] of CITY_MAP) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    cities.push({ slug, name: slug === 'mogilev' ? 'Могилев' : name });
  }
  return { cities, categories: CATEGORY_MAP.map(([name, slug]) => ({ slug, name })) };
}

const META = metadataLikeTheApi();
const KNOWN_CITY_SLUGS = new Set(META.cities.map((c) => c.slug));

beforeEach(() => {
  jest.clearAllMocks();
  metadataMock.mockReset();
  metadataMock.mockResolvedValue({ ...META, cuisines: [] });
  _resetForTests();
  jest.useRealTimers();
});

describe('the address — the same as the API\'s public projection', () => {
  it('the maps were read: both spellings of Mogilev and fifteen categories', () => {
    expect(CITY_MAP).toEqual(expect.arrayContaining([['Могилев', 'mogilev'], ['Могилёв', 'mogilev']]));
    expect(CATEGORY_MAP.length).toBe(15);
  });

  it.each(CITY_MAP)('city %s → /%s/… for every category of the map', (city, citySlug) => {
    for (const [category, categorySlug] of CATEGORY_MAP) {
      expect(cardPagePathFrom({ slug: 'kafe-u-mosta', city, categories: [category, 'Бар'] }, META)).toBe(
        `/${citySlug}/${categorySlug}/kafe-u-mosta`,
      );
    }
  });

  it('the metadata naming a city with «ё» still finds the card that has «е» (and the other way round)', () => {
    const withYo = {
      cities: [{ slug: 'mogilev', name: 'Могилёв' }],
      categories: [{ slug: 'cafes', name: 'Кафе' }],
    };
    expect(cardPagePathFrom({ slug: 's', city: 'Могилев', categories: ['Кафе'] }, withYo)).toBe('/mogilev/cafes/s');
    expect(cardPagePathFrom({ slug: 's', city: 'Могилёв', categories: ['Кафе'] }, withYo)).toBe('/mogilev/cafes/s');
  });

  it('a city or a category the maps do not know falls back as establishmentAddress does', () => {
    expect(cardPagePathFrom({ slug: 's', city: 'Лида', categories: ['Ресторан'] }, META)).toBe('/minsk/restaurants/s');
    expect(cardPagePathFrom({ slug: 's', city: 'Гродно', categories: [] }, META)).toBe('/grodno/restaurants/s');
    expect(cardPagePathFrom({ slug: 's', city: 'Гродно', categories: ['Чайная'] }, META)).toBe('/grodno/restaurants/s');
  });

  it('no slug — no address', () => {
    expect(cardPagePathFrom({ slug: null, city: 'Минск', categories: ['Кафе'] }, META)).toBeNull();
    expect(cardPagePathFrom({ slug: '', city: 'Минск', categories: ['Кафе'] }, META)).toBeNull();
  });

  it('a slug outside the form of plain segments gives no address to drop', () => {
    expect(cardPagePathFrom({ slug: 'a/b', city: 'Минск', categories: ['Кафе'] }, META)).toBeNull();
  });
});

describe('properties of the fold of «ё» (probe 6)', () => {
  // A seeded generator: the same thousands of inputs on every run.
  function generator(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }
  const ALPHABET = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ -';
  const random = generator(20261123);
  const randomText = () =>
    Array.from({ length: 1 + Math.floor(random() * 12) }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
  /** Each «е» or «ё» of the text, written either way. */
  const yoVariant = (text: string) =>
    [...text].map((ch) => (/[её]/.test(ch) ? (random() < 0.5 ? 'е' : 'ё') : /[ЕЁ]/.test(ch) ? (random() < 0.5 ? 'Е' : 'Ё') : ch)).join('');

  it('folding twice is folding once (5000 inputs)', () => {
    for (let i = 0; i < 5000; i += 1) {
      const text = randomText();
      expect(foldYo(foldYo(text))).toBe(foldYo(text));
    }
  });

  it('any city text gives a known city slug or the fallback, never a throw (5000 inputs)', () => {
    for (let i = 0; i < 5000; i += 1) {
      const p = cardPagePathFrom({ slug: 's', city: randomText(), categories: ['Кафе'] }, META);
      const citySlug = p?.split('/')[1];
      expect(KNOWN_CITY_SLUGS.has(citySlug ?? '') || citySlug === 'minsk').toBe(true);
    }
  });

  it('«ё» and «е» never change the address of a known city (2000 variants)', () => {
    for (let i = 0; i < 2000; i += 1) {
      const [city, citySlug] = CITY_MAP[i % CITY_MAP.length];
      const variant = yoVariant(city);
      expect(cardPagePathFrom({ slug: 's', city: variant, categories: ['Кафе'] }, META)).toBe(`/${citySlug}/cafes/s`);
    }
  });
});

describe('the bounds of the drops', () => {
  it('the first write drops at once; the next inside the interval is deferred with its term', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });

    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledWith('/minsk/cafes/s');

    jest.advanceTimersByTime(10_000);
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({
      refreshed: false,
      retryInMs: CARD_INTERVAL_MS - 10_000,
    });
    expect(cardDropDue('e1')).toEqual({ refreshed: false, retryInMs: CARD_INTERVAL_MS - 10_000 });
    expect(revalidateMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(CARD_INTERVAL_MS - 10_000);
    expect(cardDropDue('e1')).toBeNull();
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });

  it('the interval is the card\'s: another card drops at once', () => {
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/a'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u1', 'e2', ['/minsk/cafes/b'])).toEqual({ refreshed: true });
  });

  it('`force` (the pause, a moved address) drops inside the interval', () => {
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'], { force: true })).toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });

  it('300 drops an hour per account: the 301st is refused with a warning, another account is not', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < DROPS_PER_ACCOUNT_HOUR; i += 1) {
      expect(dropCardPaths('u1', `card-${i}`, [`/minsk/cafes/s${i}`])).toEqual({ refreshed: true });
    }
    expect(dropCardPaths('u1', 'card-last', ['/minsk/cafes/last'])).toEqual({ refreshed: false });
    expect(revalidateMock).toHaveBeenCalledTimes(DROPS_PER_ACCOUNT_HOUR);
    expect(warn).toHaveBeenCalledTimes(1);

    expect(dropCardPaths('u2', 'card-other', ['/minsk/cafes/other'])).toEqual({ refreshed: true });
    warn.mockRestore();
  });

  it('the account\'s hour renews', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < DROPS_PER_ACCOUNT_HOUR; i += 1) dropCardPaths('u1', `c${i}`, [`/minsk/cafes/s${i}`]);
    expect(dropCardPaths('u1', 'cx', ['/minsk/cafes/x'])).toEqual({ refreshed: false });

    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(dropCardPaths('u1', 'cx', ['/minsk/cafes/x'])).toEqual({ refreshed: true });
    warn.mockRestore();
  });

  it('the visitors\' allowance is not spent', async () => {
    dropCardPaths('u1', 'e1', ['/minsk/cafes/s']);
    await refreshCardPage('u1', 'e2', { slug: 's2', city: 'Минск', categories: ['Кафе'], status: 'active' });
    expect(mayDropCachedPage).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });
});

describe('refreshCardPage — a card the partner just wrote', () => {
  const card = { slug: 'kafe', city: 'Могилёв', categories: ['Кафе'], status: 'active' } as const;

  it('a published card: its literal address', async () => {
    await expect(refreshCardPage('u1', 'e1', card)).resolves.toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledWith('/mogilev/cafes/kafe');
  });

  it('a card no guest sees (draft, pending): nothing', async () => {
    await expect(refreshCardPage('u1', 'e1', { ...card, status: 'draft' })).resolves.toEqual({ refreshed: false });
    await expect(refreshCardPage('u1', 'e1', { ...card, status: 'pending' })).resolves.toEqual({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('the pause: dropped although the card is no longer active', async () => {
    await expect(
      refreshCardPage('u1', 'e1', { ...card, status: 'suspended' }, { force: true, requireActive: false }),
    ).resolves.toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledWith('/mogilev/cafes/kafe');
  });

  it('a save that moved the card: the old address too, at once', async () => {
    dropCardPaths('u1', 'e1', ['/mogilev/cafes/kafe']); // a drop a moment ago
    revalidateMock.mockClear();

    await expect(
      refreshCardPage('u1', 'e1', { ...card, categories: ['Бар'] }, { previous: { city: 'Могилёв', categories: ['Кафе'] } }),
    ).resolves.toEqual({ refreshed: true });
    expect(revalidateMock.mock.calls.map((c) => c[0]).sort()).toEqual(['/mogilev/bars/kafe', '/mogilev/cafes/kafe']);
  });

  it('the previous address is built of this card\'s own slug only', async () => {
    await refreshCardPage('u1', 'e1', card, {
      previous: { slug: 'someone-else', city: 'Брест', categories: ['Бар'] },
    });
    expect(revalidateMock.mock.calls.map((c) => c[0]).sort()).toEqual(['/brest/bars/kafe', '/mogilev/cafes/kafe']);
  });

  it('without the metadata — no drop rather than a wrong one', async () => {
    metadataMock.mockRejectedValue(new Error('metadata down'));
    await expect(refreshCardPage('u1', 'e1', card)).resolves.toEqual({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('without a signed-in account — nothing', async () => {
    await expect(refreshCardPage(null, 'e1', card)).resolves.toEqual({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
