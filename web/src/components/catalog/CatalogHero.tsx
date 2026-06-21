import Image from 'next/image';
import Link from 'next/link';

import type { MetadataSlug } from '@/lib/api/types';
import { catalogHeading, categoryPlural } from '@/lib/catalog-labels';
import type { SearchParams } from '@/lib/catalog-params';

import { CatalogSearch } from './CatalogSearch';

type Props = {
  citySlug: string;
  cityName: string;
  categorySlug: string;
  categoryName: string;
  cities: MetadataSlug[];
  searchParams: SearchParams;
};

/*
 * Catalog photo banner — the full-bleed search band atop /{city}/{category},
 * mirroring the home hero's treatment (own photo + dark wash + warm gradient).
 *
 * Overlay coupling: like the home Hero, the (public) SiteHeader is `sticky
 * top-0` and the banner is pulled up beneath it (-mt-[72px], the live header
 * height) so the transparent overlay header sits over the photo. SiteHeader
 * detects the catalog route (2 path segments) and renders its overlay variant —
 * but keeps the wordmark visible (white), since the banner has no large wordmark
 * of its own. The header turns solid on scroll (client logic in SiteHeader).
 *
 * Server Component: breadcrumbs + H1 are server-rendered (SEO); only the search
 * cluster (CatalogSearch) is a client island. LCP photo is `priority`.
 */
export function CatalogHero({
  citySlug,
  cityName,
  categorySlug,
  categoryName,
  cities,
  searchParams,
}: Props) {
  return (
    <section className="relative -mt-[72px] w-full overflow-hidden">
      <Image
        src="/search_background.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-[center_35%]"
      />
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
      <div
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{
          background:
            'linear-gradient(to top, rgba(200,113,75,0.20), transparent)',
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-3.5 px-l pt-20 pb-9">
        <nav
          aria-label="Хлебные крошки"
          className="flex flex-wrap items-center gap-s text-caption-l text-white/75"
        >
          <Link href="/" className="transition-colors hover:text-white">
            Главная
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/${citySlug}`} className="transition-colors hover:text-white">
            {cityName}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="text-white">
            {categoryPlural(categorySlug, categoryName).toLowerCase()}
          </span>
        </nav>

        <h1 className="font-display text-[26px] font-bold tracking-[-0.3px] text-white">
          {catalogHeading(categorySlug, categoryName, citySlug, cityName)}
        </h1>

        <div className="mt-1">
          <CatalogSearch
            citySlug={citySlug}
            categorySlug={categorySlug}
            cities={cities}
            searchParams={searchParams}
          />
        </div>
      </div>
    </section>
  );
}
