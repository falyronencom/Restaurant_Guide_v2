/**
 * @jest-environment node
 */
/**
 * The meta robots tag a city / category page ENDS UP with — the root layout's
 * metadata merged with the page's generateMetadata by Next's own resolver
 * (accumulateMetadata), not each one on its own.
 *
 * 01.11 сверка: while the site was gated (NOINDEX_MODE unset), the clean
 * /minsk and /minsk/restaurants carried no robots tag at all. The layout set
 * noindex+nofollow; the page returned `robots: undefined` for its clean URL,
 * and Next's merge walks every key the page returns — an `undefined` robots
 * replaces the layout's with «no tag». city-page / catalog-filters checked
 * the page's own value alone, so the merge was never under test.
 *
 * NOINDEX_MODE is read at module load by the root layout, so each case loads
 * the layout and the page afresh (jest.isolateModules) under its env value.
 * Node environment: Next's resolver uses structuredClone.
 */
import type { Metadata } from 'next';
import {
  accumulateMetadata,
  type MetadataItems,
} from 'next/dist/lib/metadata/resolve-metadata';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getCatalog: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
  getLiveCities: jest.fn(),
  isLiveCity: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/search', () => ({
  smartSearch: jest.fn(),
}));

type GenerateMetadata = (
  props: {
    params: Promise<Record<string, string>>;
    searchParams: Promise<Record<string, string>>;
  },
  parent: unknown,
) => Promise<Metadata>;

type Page = 'city' | 'category';
type Mode = 'gated' | 'open';

const META = {
  cities: [
    { slug: 'minsk', name: 'Минск' },
    { slug: 'grodno', name: 'Гродно' },
  ],
  categories: [{ slug: 'restaurants', name: 'Рестораны' }],
  cuisines: [{ slug: 'italian', name: 'Итальянская' }],
};

const NOINDEX_MODE_BEFORE = process.env.NOINDEX_MODE;
afterAll(() => {
  if (NOINDEX_MODE_BEFORE === undefined) delete process.env.NOINDEX_MODE;
  else process.env.NOINDEX_MODE = NOINDEX_MODE_BEFORE;
});

/**
 * The `content` of <meta name="robots"> for the page at `city` (+ category),
 * or null when the page carries no such tag.
 */
async function robotsTag(
  page: Page,
  mode: Mode,
  {
    city = 'minsk',
    query = {},
    live = true,
    known = true,
  }: {
    city?: string;
    query?: Record<string, string>;
    live?: boolean;
    known?: boolean;
  } = {},
): Promise<string | null> {
  if (mode === 'gated') delete process.env.NOINDEX_MODE;
  else process.env.NOINDEX_MODE = 'false';

  let layoutMetadata!: Metadata;
  let generateMetadata!: GenerateMetadata;
  await jest.isolateModulesAsync(async () => {
    layoutMetadata = (await import('@/app/layout')).metadata;
    generateMetadata = (
      page === 'city'
        ? await import('@/app/(public)/[city]/page')
        : await import('@/app/(public)/[city]/[category]/page')
    ).generateMetadata as unknown as GenerateMetadata;
    const endpoints = jest.mocked(
      await import('@/lib/api/endpoints/metadata'),
    );
    endpoints.getMetadata.mockResolvedValue(META as never);
    endpoints.isLiveCity.mockResolvedValue(live);
    endpoints.validateCitySlug.mockResolvedValue(known);
    endpoints.validateCategorySlug.mockResolvedValue(true);
  });

  const params: Record<string, string> =
    page === 'city' ? { city } : { city, category: 'restaurants' };
  const pathname =
    page === 'city' ? `/${city}` : `/${city}/restaurants`;
  const pageResolver = Object.assign(
    (parent: unknown) =>
      generateMetadata(
        {
          params: Promise.resolve(params),
          searchParams: Promise.resolve(query),
        },
        parent,
      ),
    { $$original: generateMetadata },
  );

  // Root layout → (public) layout (no metadata) → the page.
  const items = [
    [layoutMetadata, undefined],
    [null, undefined],
    [pageResolver, undefined],
  ] as unknown as MetadataItems;
  const resolved = await accumulateMetadata(
    page === 'city' ? '/[city]' : '/[city]/[category]',
    items,
    Promise.resolve(pathname),
    { trailingSlash: false, isStaticMetadataRouteFile: false },
  );
  return resolved.robots?.basic ?? null;
}

describe.each<Page>(['city', 'category'])('%s page — the robots tag', (page) => {
  describe('while gated (NOINDEX_MODE unset) — noindex, nofollow everywhere', () => {
    it('the clean URL', async () => {
      expect(await robotsTag(page, 'gated')).toBe('noindex, nofollow');
    });

    it('a URL with a facet', async () => {
      expect(
        await robotsTag(page, 'gated', { query: { cuisine: 'italian' } }),
      ).toBe('noindex, nofollow');
    });

    it('a city without cards', async () => {
      expect(
        await robotsTag(page, 'gated', { city: 'grodno', live: false }),
      ).toBe('noindex, nofollow');
    });

    it('an unknown city (the page returns no robots of its own)', async () => {
      // Control: the layout tag reaches a page that does not touch the key —
      // the harness really merges the layout in.
      expect(
        await robotsTag(page, 'gated', { city: 'zz-gorod', known: false }),
      ).toBe('noindex, nofollow');
    });
  });

  describe('after launch (NOINDEX_MODE=false) — as before', () => {
    it('the clean URL of a city with cards has no tag — indexable', async () => {
      expect(await robotsTag(page, 'open')).toBeNull();
    });

    it('a URL with a facet — noindex, follow', async () => {
      expect(
        await robotsTag(page, 'open', { query: { cuisine: 'italian' } }),
      ).toBe('noindex, follow');
    });

    it('a city without cards — noindex, follow', async () => {
      expect(
        await robotsTag(page, 'open', { city: 'grodno', live: false }),
      ).toBe('noindex, follow');
    });
  });
});
