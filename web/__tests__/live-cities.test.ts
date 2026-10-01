/**
 * @jest-environment node
 */
/*
 * getLiveCities — the site offers only cities that have cards (Coordinator
 * decision 01.10, А2). Mock boundary: serverFetch (the transport). React.cache
 * is a pass-through outside an RSC request, so every call re-probes.
 *
 * Node environment: the window-floor test imports the (public) route modules
 * for their `revalidate` exports, and the detail page pulls server actions
 * (next/cache → TextEncoder, absent in jsdom).
 */
import { revalidate as PUBLIC_LAYOUT_REVALIDATE } from '@/app/(public)/layout';
import { revalidate as HOME_REVALIDATE } from '@/app/(public)/page';
import { revalidate as DETAIL_REVALIDATE } from '@/app/(public)/[city]/[category]/[slug]/page';
import { revalidate as SITEMAP_REVALIDATE } from '@/app/sitemap';
import { serverFetch } from '@/lib/api/client';
import { getLiveCities, isLiveCity } from '@/lib/api/endpoints/metadata';

jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

const CITIES = [
  { slug: 'minsk', name: 'Минск' },
  { slug: 'grodno', name: 'Гродно' },
  { slug: 'brest', name: 'Брест' },
];

const totals = (map: Record<string, number | Error>) => {
  (serverFetch as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/api/v1/public/metadata') {
      return { cities: CITIES, categories: [], cuisines: [] };
    }
    const city = new URL(path, 'http://x').searchParams.get('city') as string;
    const v = map[city];
    if (v instanceof Error) throw v;
    return { establishments: [], pagination: { total: v } };
  });
};

beforeEach(() => jest.clearAllMocks());

describe('getLiveCities', () => {
  it('keeps only cities whose catalog is non-empty, in metadata order', async () => {
    // brest has more cards than minsk: an implementation sorting by count
    // would put it first — metadata order must win.
    totals({ minsk: 1, grodno: 0, brest: 50 });
    expect(await getLiveCities()).toEqual([
      { slug: 'minsk', name: 'Минск' },
      { slug: 'brest', name: 'Брест' },
    ]);
  });

  it('a city appears on its own once its first card is published', async () => {
    totals({ minsk: 44, grodno: 1, brest: 0 });
    expect((await getLiveCities()).map((c) => c.slug)).toEqual([
      'minsk',
      'grodno',
    ]);
  });

  it('probes with limit=1 and a data-cache revalidate window', async () => {
    totals({ minsk: 1, grodno: 0, brest: 0 });
    await getLiveCities();
    const probe = (serverFetch as jest.Mock).mock.calls.find(([p]) =>
      String(p).includes('city=grodno'),
    );
    expect(probe[0]).toBe('/api/v1/public/establishments?city=grodno&limit=1');
    expect(probe[1].next.revalidate).toBeGreaterThan(0);
  });

  it('the probe window is not shorter than any ISR window of the (public) routes', async () => {
    // Next lowers a route's revalidate to the lowest fetch-level revalidate it
    // renders; the probe runs in the shared (public) layout. A shorter window
    // turned static pages into 10-minute ones, and every detail regeneration
    // counts a partner view via by-slug (review 01.10).
    totals({ minsk: 1, grodno: 0, brest: 0 });
    await getLiveCities();
    const windows = (serverFetch as jest.Mock).mock.calls
      .filter(([p]) => String(p).includes('/establishments?'))
      .map(([, init]) => init.next.revalidate);
    expect(windows).toHaveLength(3);
    const floor = Math.min(
      PUBLIC_LAYOUT_REVALIDATE,
      HOME_REVALIDATE,
      DETAIL_REVALIDATE,
      SITEMAP_REVALIDATE,
    );
    for (const w of windows) expect(w).toBeGreaterThanOrEqual(floor);
  });

  it('keeps a city whose probe FAILED — unknown is not empty', async () => {
    totals({ minsk: 44, grodno: new Error('boom'), brest: 0 });
    expect((await getLiveCities()).map((c) => c.slug)).toEqual([
      'minsk',
      'grodno',
    ]);
  });

  it('returns the full list when every city is empty — pickers never empty', async () => {
    totals({ minsk: 0, grodno: 0, brest: 0 });
    expect(await getLiveCities()).toEqual(CITIES);
  });
});

describe('isLiveCity', () => {
  it('true for a city with cards, false for an empty one', async () => {
    totals({ minsk: 44, grodno: 0, brest: 0 });
    expect(await isLiveCity('minsk')).toBe(true);
    expect(await isLiveCity('grodno')).toBe(false);
  });
});
