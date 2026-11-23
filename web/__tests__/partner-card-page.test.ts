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
 * 3. The bounds (Trunk, addendum 1, 1.2–1.3): one drop per card in 30 s for
 *    every drop (the next one deferred with its term and its addresses), 25 an
 *    hour per account — the card's owner in the API's answer — and 50 an hour
 *    for the site, `final` only for a drop this server deferred, and the
 *    visitors' allowance never touched.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/metadata', () => ({ getMetadata: jest.fn() }));
jest.mock('@/lib/cached-page-drops', () => ({ mayDropCachedPage: jest.fn(async () => true) }));
jest.mock('@/lib/known-slugs', () => ({ noteCardAddress: jest.fn() }));

import { revalidatePath } from 'next/cache';

import { getMetadata } from '@/lib/api/endpoints/metadata';
import type { PublicMetadata } from '@/lib/api/types';
import { mayDropCachedPage } from '@/lib/cached-page-drops';
import { noteCardAddress } from '@/lib/known-slugs';
import {
  CARD_INTERVAL_MS,
  DEFERRED_TTL_MS,
  DROPS_PER_ACCOUNT_HOUR,
  DROPS_PER_SITE_HOUR,
  _resetForTests,
  cardPagePathFrom,
  dropCardPaths,
  foldYo,
  refreshCardPage,
} from '@/lib/partner/card-page';

const revalidateMock = revalidatePath as jest.Mock;
const metadataMock = getMetadata as jest.Mock;
const noteMock = noteCardAddress as jest.Mock;
const warnSpy = () => jest.spyOn(console, 'warn').mockImplementation(() => {});

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
  jest.restoreAllMocks();
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
  it('the first write drops at once; the next inside the interval is deferred with its term, its address dropped by the next ask after it', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });

    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledWith('/minsk/cafes/s');

    jest.advanceTimersByTime(10_000);
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: false, retryInMs: 20_000 });
    expect(revalidateMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(19_999);
    expect(dropCardPaths('u1', 'e1', [], { remember: false })).toEqual({ refreshed: false, retryInMs: 1 });
    jest.advanceTimersByTime(1);
    // The ask names no address of its own: the deferred one is dropped.
    expect(dropCardPaths('u1', 'e1', [], { remember: false })).toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledTimes(2);
    expect(revalidateMock).toHaveBeenLastCalledWith('/minsk/cafes/s');
  });

  it('the interval is the card\'s: another card drops at once', () => {
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/a'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u1', 'e2', ['/minsk/cafes/b'])).toEqual({ refreshed: true });
  });

  it('a pause or a moved address keeps the interval too (Phase 4.5, P2 2): deferred, both addresses kept for the later drop', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });

    jest.advanceTimersByTime(5_000);
    expect(dropCardPaths('u1', 'e1', ['/minsk/bars/s', '/minsk/cafes/s'])).toEqual({ refreshed: false, retryInMs: 25_000 });
    expect(revalidateMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(25_000);
    expect(dropCardPaths('u1', 'e1', ['/minsk/bars/s'], { remember: false })).toEqual({ refreshed: true });
    expect(revalidateMock.mock.calls.slice(1).map((c) => c[0]).sort()).toEqual(['/minsk/bars/s', '/minsk/cafes/s']);
  });

  it('`final` skips the interval only for a drop of a write this server deferred (Phase 4.5, P1 / P2 2)', () => {
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });

    // Nothing deferred: `final` is the browser's word only — the interval holds.
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'], { final: true, remember: false })).toMatchObject({ refreshed: false });
    // Asked twice, refresh-page has left nothing to remember: still held.
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'], { final: true, remember: false })).toMatchObject({ refreshed: false });
    expect(revalidateMock).toHaveBeenCalledTimes(1);

    // A write deferred here: the partner leaving takes it without the interval.
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toMatchObject({ refreshed: false });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'], { final: true, remember: false })).toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledTimes(2);

    // Taken: the next `final` finds nothing deferred again.
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'], { final: true, remember: false })).toMatchObject({ refreshed: false });
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });

  it('`final` for a drop another account deferred is not taken', () => {
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toMatchObject({ refreshed: false });
    expect(dropCardPaths('u2', 'e1', ['/minsk/cafes/s'], { final: true, remember: false })).toMatchObject({ refreshed: false });
    expect(revalidateMock).toHaveBeenCalledTimes(1);
  });

  it(`the account: ${DROPS_PER_ACCOUNT_HOUR} drops an hour; the next one refused with a warning; another account is served`, () => {
    expect(DROPS_PER_ACCOUNT_HOUR).toBe(25);
    const warn = warnSpy();
    for (let i = 0; i < 25; i += 1) {
      expect(dropCardPaths('u1', `card-${i}`, [`/minsk/cafes/s${i}`])).toEqual({ refreshed: true });
    }
    expect(dropCardPaths('u1', 'card-last', ['/minsk/cafes/last'])).toEqual({ refreshed: false });
    expect(revalidateMock).toHaveBeenCalledTimes(25);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("the account's hour");

    expect(dropCardPaths('u2', 'card-other', ['/minsk/cafes/other'])).toEqual({ refreshed: true });
  });

  it(`the site: ${DROPS_PER_SITE_HOUR} drops an hour for every account together; the next one refused with a warning`, () => {
    expect(DROPS_PER_SITE_HOUR).toBe(50);
    const warn = warnSpy();
    for (let i = 0; i < 25; i += 1) {
      expect(dropCardPaths('u1', `a-${i}`, [`/minsk/cafes/a${i}`])).toEqual({ refreshed: true });
      expect(dropCardPaths('u2', `b-${i}`, [`/minsk/cafes/b${i}`])).toEqual({ refreshed: true });
    }
    expect(revalidateMock).toHaveBeenCalledTimes(50);
    // A third account, its own hour untouched — the site's is spent.
    expect(dropCardPaths('u3', 'c-0', ['/minsk/cafes/c0'])).toEqual({ refreshed: false });
    expect(revalidateMock).toHaveBeenCalledTimes(50);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("the site's hour");
  });

  it('a moved card counts both of its addresses', () => {
    const warn = warnSpy();
    for (let i = 0; i < 12; i += 1) {
      expect(dropCardPaths('u1', `m-${i}`, [`/minsk/cafes/m${i}`, `/minsk/bars/m${i}`])).toEqual({ refreshed: true });
    }
    // 24 of 25 spent: two more addresses do not fit, one does.
    expect(dropCardPaths('u1', 'm-x', ['/minsk/cafes/mx', '/minsk/bars/mx'])).toEqual({ refreshed: false });
    expect(dropCardPaths('u1', 'm-y', ['/minsk/cafes/my'])).toEqual({ refreshed: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('the hours renew', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });
    warnSpy();
    for (let i = 0; i < 25; i += 1) {
      dropCardPaths('u1', `a${i}`, [`/minsk/cafes/a${i}`]);
      dropCardPaths('u2', `b${i}`, [`/minsk/cafes/b${i}`]);
    }
    expect(dropCardPaths('u1', 'ax', ['/minsk/cafes/ax'])).toEqual({ refreshed: false });
    expect(dropCardPaths('u3', 'cx', ['/minsk/cafes/cx'])).toEqual({ refreshed: false });

    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(dropCardPaths('u1', 'ax', ['/minsk/cafes/ax'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u3', 'cx', ['/minsk/cafes/cx'])).toEqual({ refreshed: true });
  });

  it('a deferred drop is forgotten after its time: nothing of it is dropped later', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toMatchObject({ refreshed: false });

    jest.advanceTimersByTime(DEFERRED_TTL_MS - 1);
    expect(dropCardPaths('u1', 'e1', [], { remember: false })).toEqual({ refreshed: true }); // still kept
    expect(dropCardPaths('u1', 'e2', ['/minsk/cafes/t'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u1', 'e2', ['/minsk/cafes/t'])).toMatchObject({ refreshed: false });

    jest.advanceTimersByTime(DEFERRED_TTL_MS);
    revalidateMock.mockClear();
    expect(dropCardPaths('u1', 'e2', [], { remember: false })).toEqual({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('the visitors\' allowance is not spent', async () => {
    dropCardPaths('u1', 'e1', ['/minsk/cafes/s']);
    await refreshCardPage('e2', { slug: 's2', city: 'Минск', categories: ['Кафе'], status: 'active', partner_id: 'u1' });
    expect(mayDropCachedPage).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });
});

describe('refreshCardPage — a card the partner just wrote', () => {
  const card = { slug: 'kafe', city: 'Могилёв', categories: ['Кафе'], status: 'active', partner_id: 'u1' } as const;

  it('a published card: its literal address; the site\'s list of addresses learns it', async () => {
    await expect(refreshCardPage('e1', card)).resolves.toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledWith('/mogilev/cafes/kafe');
    expect(noteMock).toHaveBeenCalledWith('kafe', '/mogilev/cafes/kafe');
  });

  it('the account is the card\'s owner in the API\'s answer: another owner, another hour (Phase 4.5, P1 / HIGH 2)', async () => {
    warnSpy();
    for (let i = 0; i < 25; i += 1) {
      await expect(refreshCardPage(`c${i}`, { ...card, slug: `k${i}` })).resolves.toEqual({ refreshed: true });
    }
    await expect(refreshCardPage('cx', { ...card, slug: 'kx' })).resolves.toEqual({ refreshed: false });
    await expect(refreshCardPage('cy', { ...card, slug: 'ky', partner_id: 'u2' })).resolves.toEqual({ refreshed: true });
  });

  it('without the owner in the API\'s answer — nothing', async () => {
    await expect(refreshCardPage('e1', { ...card, partner_id: undefined })).resolves.toEqual({ refreshed: false });
    await expect(refreshCardPage('e1', { ...card, partner_id: '' })).resolves.toEqual({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('a card no guest sees (draft, pending): nothing, and the list is not told', async () => {
    await expect(refreshCardPage('e1', { ...card, status: 'draft' })).resolves.toEqual({ refreshed: false });
    await expect(refreshCardPage('e1', { ...card, status: 'pending' })).resolves.toEqual({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(noteMock).not.toHaveBeenCalled();
  });

  it('the pause: dropped although the card is no longer active', async () => {
    await expect(refreshCardPage('e1', { ...card, status: 'suspended' }, { requireActive: false })).resolves.toEqual({
      refreshed: true,
    });
    expect(revalidateMock).toHaveBeenCalledWith('/mogilev/cafes/kafe');
    expect(noteMock).not.toHaveBeenCalled();
  });

  it('a pause inside the interval: deferred, then dropped by refresh-page although the card is not published any more', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });
    await expect(refreshCardPage('e1', card)).resolves.toEqual({ refreshed: true });
    await expect(refreshCardPage('e1', { ...card, status: 'suspended' }, { requireActive: false })).resolves.toMatchObject({
      refreshed: false,
      retryInMs: CARD_INTERVAL_MS,
    });

    jest.advanceTimersByTime(CARD_INTERVAL_MS);
    revalidateMock.mockClear();
    await expect(refreshCardPage('e1', { ...card, status: 'suspended' }, { remember: false })).resolves.toEqual({
      refreshed: true,
    });
    expect(revalidateMock).toHaveBeenCalledWith('/mogilev/cafes/kafe');
  });

  it('a save that moved the card: the old address too; inside the interval both are deferred and dropped together', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });
    dropCardPaths('u1', 'e1', ['/mogilev/cafes/kafe']); // a drop a moment ago
    revalidateMock.mockClear();

    await expect(
      refreshCardPage('e1', { ...card, categories: ['Бар'] }, { previous: { city: 'Могилёв', categories: ['Кафе'] } }),
    ).resolves.toMatchObject({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(noteMock).toHaveBeenCalledWith('kafe', '/mogilev/bars/kafe');

    jest.advanceTimersByTime(CARD_INTERVAL_MS);
    // refresh-page: the card as it is now (its new address) and what was deferred.
    await expect(refreshCardPage('e1', { ...card, categories: ['Бар'] }, { remember: false })).resolves.toEqual({
      refreshed: true,
    });
    expect(revalidateMock.mock.calls.map((c) => c[0]).sort()).toEqual(['/mogilev/bars/kafe', '/mogilev/cafes/kafe']);
  });

  it('the previous address is built of this card\'s own slug only', async () => {
    await refreshCardPage('e1', card, { previous: { slug: 'someone-else', city: 'Брест', categories: ['Бар'] } });
    expect(revalidateMock.mock.calls.map((c) => c[0]).sort()).toEqual(['/brest/bars/kafe', '/mogilev/cafes/kafe']);
  });

  it('without the metadata — no drop rather than a wrong one', async () => {
    metadataMock.mockRejectedValue(new Error('metadata down'));
    await expect(refreshCardPage('e1', card)).resolves.toEqual({ refreshed: false });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe('after Phase 4.5 of the final change', () => {
  it('`final` skips the interval once in an interval of the card: a write and a `final` in turn do not drop at will (lens P3 4, regular LOW 2)', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:00:00Z') });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toEqual({ refreshed: true });
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toMatchObject({ refreshed: false }); // a write, deferred
    expect(dropCardPaths('u1', 'e1', [], { final: true, remember: false })).toEqual({ refreshed: true });

    jest.advanceTimersByTime(1_000);
    expect(dropCardPaths('u1', 'e1', ['/minsk/cafes/s'])).toMatchObject({ refreshed: false, retryInMs: 29_000 });
    expect(dropCardPaths('u1', 'e1', [], { final: true, remember: false })).toMatchObject({ refreshed: false, retryInMs: 29_000 });
    expect(revalidateMock).toHaveBeenCalledTimes(2);

    // The interval over: the remembered write is dropped by the next ask.
    jest.advanceTimersByTime(29_000);
    expect(dropCardPaths('u1', 'e1', [], { remember: false })).toEqual({ refreshed: true });
    expect(revalidateMock).toHaveBeenCalledTimes(3);
  });

  it('the hours are clock hours (UTC), as the API counts its budget (lens P3 3)', () => {
    jest.useFakeTimers({ now: new Date('2026-11-23T12:59:00Z') });
    warnSpy();
    for (let i = 0; i < 25; i += 1) dropCardPaths('u1', `c${i}`, [`/minsk/cafes/c${i}`]);
    expect(dropCardPaths('u1', 'cx', ['/minsk/cafes/cx'])).toEqual({ refreshed: false });

    jest.advanceTimersByTime(61_000); // 13:00:01 — the API's next hour
    expect(dropCardPaths('u1', 'cx', ['/minsk/cafes/cx'])).toEqual({ refreshed: true });
  });
});
