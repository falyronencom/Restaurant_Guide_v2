import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { ApiError } from '@/lib/api/types';
import {
  getBySlug,
  getMenuItems,
  getReviews,
} from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { normalizeCategory } from '@/lib/working-hours';
import { AnchorNav } from '@/components/establishment/AnchorNav';
import { Attributes } from '@/components/establishment/Attributes';
import { ContactSidebar } from '@/components/establishment/ContactSidebar';
import { Description } from '@/components/establishment/Description';
import { Gallery } from '@/components/establishment/Gallery';
import { InfoCard } from '@/components/establishment/InfoCard';
import { Location as LocationSection } from '@/components/establishment/Location';
import { MenuBlock } from '@/components/establishment/MenuBlock';
import { PromotionBanner } from '@/components/establishment/PromotionBanner';
import { ReviewCarousel } from '@/components/establishment/ReviewCarousel';

/*
 * /[city]/[category]/[slug] — Establishment detail composite (Brief 4).
 *
 * Server Component. Validates city+category slugs, fetches the full detail
 * via getBySlug (404 → notFound() through Next's not-found.tsx boundary),
 * then in parallel fetches menu items + reviews. Composes seven sections
 * into a Booking-inspired two-column layout (single-column on mobile).
 *
 * `getCachedBySlug` wraps `getBySlug` in React.cache so both
 * `generateMetadata` and the page body share a single backend roundtrip per
 * request (mirrors Brief 3 `getMetadata` pattern in metadata.ts). The cache
 * lasts only for the current request, so each ISR revalidation triggers a
 * fresh fetch (and a fresh view_count increment — F3 from Discovery).
 *
 * Layout philosophy: Booking-style — photo grid + anchor nav + main content
 * (~65-70% width on desktop) + sticky right sidebar with contact card and
 * rating. On mobile the sidebar disappears (sections render single-column).
 */

export const revalidate = 3600;

type Params = { city: string; category: string; slug: string };

const getCachedBySlug = cache((slug: string) => getBySlug(slug));

export async function generateStaticParams(): Promise<Params[]> {
  // Defer to runtime — combinatorial explosion (cities × categories × slugs).
  // Future optimization may pre-warm popular slugs.
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { city, category, slug } = await params;

  let title = `${slug} — ${city}`;
  let description = `Заведение в городе ${city}`;

  try {
    const [detail, meta] = await Promise.all([
      getCachedBySlug(slug),
      getMetadata(),
    ]);
    const cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
    const categoryName =
      meta.categories.find((c) => c.slug === category)?.name ?? category;
    const lowerCategory = categoryName.toLowerCase();
    title = `${detail.establishment.name} — ${lowerCategory} в городе ${cityName}`;
    description = detail.establishment.description
      ? truncate(detail.establishment.description, 160)
      : `${detail.establishment.name} — ${lowerCategory} в городе ${cityName}. Меню, отзывы, контакты.`;
  } catch {
    // Slug invalid / backend hiccup — fall back to slug strings. Page render
    // path will call notFound() cleanly if the slug truly doesn't exist.
  }

  return { title, description };
}

export default async function EstablishmentPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { city, category, slug } = await params;

  // 1. Validate city + category slugs in parallel (React.cache dedup via
  //    getMetadata wrapper shared with validate* helpers).
  const [cityValid, categoryValid] = await Promise.all([
    validateCitySlug(city),
    validateCategorySlug(category),
  ]);
  if (!cityValid || !categoryValid) notFound();

  // 2. Fetch detail. ApiError 404 → notFound. Other errors propagate to
  //    error.tsx boundary.
  let detailResult;
  try {
    detailResult = await getCachedBySlug(slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }
  const { establishment } = detailResult;

  // 3. Parallel fetches: menu + reviews + metadata. Menu/reviews tolerate
  //    soft failures (return empty) — the page is still useful without them.
  const [menuItemsResult, reviewsResult, meta] = await Promise.all([
    getMenuItems(slug).catch(() => ({ menu_items: [] })),
    getReviews(slug, { limit: 5 }).catch(() => ({
      reviews: [],
      pagination: {
        page: 1,
        limit: 5,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      },
    })),
    getMetadata(),
  ]);

  const cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
  const categoryName =
    meta.categories.find((c) => c.slug === category)?.name ?? category;
  const displayCategory = establishment.categories[0]
    ? normalizeCategory(establishment.categories[0])
    : categoryName;

  // Split media: PDF menus → MenuBlock fallback; gallery photos → Gallery.
  const pdfMenus = establishment.media.filter(
    (m) => m.file_type === 'pdf' && m.type === 'menu',
  );

  // Anchor nav items — Reviews count appears in label suffix.
  const anchorItems = [
    { id: 'overview', label: 'Обзор' },
    { id: 'menu', label: 'Меню' },
    { id: 'amenities', label: 'Атрибуты' },
    { id: 'location', label: 'Расположение' },
    {
      id: 'reviews',
      label: 'Отзывы',
      suffix:
        reviewsResult.pagination.total > 0
          ? ` (${reviewsResult.pagination.total})`
          : undefined,
    },
  ];

  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-l p-l'>
      {/* Breadcrumbs */}
      <nav
        aria-label='Хлебные крошки'
        className='flex flex-wrap items-center gap-s text-caption-l text-muted-foreground'
      >
        <Link href='/' className='hover:text-foreground'>
          Главная
        </Link>
        <span aria-hidden='true'>/</span>
        <Link href={`/${city}`} className='hover:text-foreground'>
          {cityName}
        </Link>
        <span aria-hidden='true'>/</span>
        <Link
          href={`/${city}/${category}`}
          className='hover:text-foreground'
        >
          {categoryName.toLowerCase()}
        </Link>
        <span aria-hidden='true'>/</span>
        <span aria-current='page' className='text-foreground'>
          {establishment.name}
        </span>
      </nav>

      {/* Gallery */}
      <Gallery
        media={establishment.media}
        primaryImageUrl={establishment.primary_image_url}
        establishmentName={establishment.name}
      />

      {/* Title block */}
      <header className='flex flex-col gap-s'>
        <p className='text-caption-l text-muted-foreground'>
          {displayCategory.toLowerCase()} в городе {cityName}
        </p>
        <h1 className='text-display-l font-display'>{establishment.name}</h1>
      </header>

      {/* Sticky anchor nav */}
      <AnchorNav items={anchorItems} />

      {/* Two-column grid: main content + sticky sidebar (desktop) */}
      <div className='grid grid-cols-1 gap-l lg:grid-cols-[1fr_320px] lg:items-start'>
        <div className='flex flex-col gap-xl'>
          <section id='overview' className='flex flex-col gap-l scroll-mt-16'>
            <InfoCard establishment={establishment} />
            {establishment.promotions.length > 0 ? (
              <PromotionBanner promotions={establishment.promotions} />
            ) : null}
            {establishment.description ? (
              <Description text={establishment.description} />
            ) : null}
          </section>

          <section id='menu' className='scroll-mt-16'>
            <MenuBlock
              menuItems={menuItemsResult.menu_items}
              pdfFallbacks={pdfMenus}
              establishmentName={establishment.name}
            />
          </section>

          <section id='amenities' className='scroll-mt-16'>
            <Attributes attributes={establishment.attributes} />
          </section>

          <section id='location' className='scroll-mt-16'>
            <LocationSection
              latitude={establishment.latitude}
              longitude={establishment.longitude}
              address={establishment.address}
              city={establishment.city}
            />
          </section>

          <section id='reviews' className='scroll-mt-16'>
            <ReviewCarousel
              reviews={reviewsResult.reviews}
              totalCount={reviewsResult.pagination.total}
              averageRating={establishment.average_rating}
            />
          </section>
        </div>

        <aside className='hidden lg:sticky lg:top-l lg:block lg:self-start'>
          <ContactSidebar establishment={establishment} />
        </aside>
      </div>
    </main>
  );
}

// -- helpers ---------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
