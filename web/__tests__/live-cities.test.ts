/**
 * getLiveCities — the site offers only cities that have cards (Coordinator
 * decision 01.10, А2). Mock boundary: serverFetch (the transport). React.cache
 * is a pass-through outside an RSC request, so every call re-probes.
 */
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
    totals({ minsk: 44, grodno: 0, brest: 0 });
    expect(await getLiveCities()).toEqual([{ slug: 'minsk', name: 'Минск' }]);
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
