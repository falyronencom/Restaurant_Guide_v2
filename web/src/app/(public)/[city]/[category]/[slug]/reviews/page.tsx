import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { ApiError } from '@/lib/api/types';
import { getBySlug, getReviews } from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { CatalogPagination } from '@/components/catalog/CatalogPagination';
import { ReviewCard } from '@/components/establishment/ReviewCard';
import { ReviewSchema } from '@/components/establishment/ReviewSchema';
import {
  formatRating,
  pluralizeReviews,
  ratingLabel,
} from '@/lib/establishment-helpers';

/*
 * /[city]/[category]/[slug]/reviews — dedicated all-reviews page (Phase A).
 *
 * Server Component, one segment deeper than the establishment detail page;
 * reuses the same slug-validation → fetch → 404 chain. Renders the full
 * paginated review list vertically (the detail page's ReviewCarousel shows only
 * the first ~5 with a "Все N отзывов →" link pointing here).
 *
 * Two server-only fetches:
 *   - getCachedBySlug(slug): establishment entity (name, rating, count, slug) for
 *     the H1 / rating summary / breadcrumb / metadata / Review JSON-LD. Wrapped
 *     in React.cache so generateMetadata + the page body share one roundtrip.
 *   - getReviews(slug, {page, limit}): the paginated review page. An empty list
 *     is a VALID state (graceful empty-state), NOT a 404. A genuine fetch error
 *     is NOT swallowed — it propagates to (public)/error.tsx rather than
 *     masquerading as "no reviews" (reviews ARE this page's content).
 */

// force-dynamic: reads searchParams (?page) → Next 16 cannot statically generate
// a searchParams-reading page (ISR keys by pathname, not query →
// DYNAMIC_SERVER_USAGE 500 in prod `next start`; `next dev` masks it). Per-request
// SSR keeps reviews in HTML — this page's indexed content. (Trunk decision
// 2026-06-19.)
export const dynamic = 'force-dynamic';

const REVIEWS_PER_PAGE = 10;

type Params = { city: string; category: string; slug: string };
type SearchParams = { [key: string]: string | string[] | undefined };

const getCachedBySlug = cache((slug: string) => getBySlug(slug));

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { city, category, slug } = await params;

  let title = `Отзывы — ${slug}`;
  let description = `Отзывы о заведении в городе ${city}`;
  let canonicalSlug = slug;
  let ogImageUrl: string | null = null;

  try {
    const [detail, meta] = await Promise.all([
      getCachedBySlug(slug),
      getMetadata(),
    ]);
    const cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
    const categoryName =
      meta.categories.find((c) => c.slug === category)?.name ?? category;
    const lowerCategory = categoryName.toLowerCase();
    title = `Отзывы — ${detail.establishment.name}`;
    description = `Все отзывы о «${detail.establishment.name}» — ${lowerCategory} в городе ${cityName}. Оценки и мнения посетителей.`;
    canonicalSlug = detail.establishment.slug;
    ogImageUrl = detail.establishment.primary_image_url;
  } catch {
    // Slug invalid / backend hiccup — fall back to slug strings + skip OG image.
    // The page render path calls notFound() cleanly if the slug truly is unknown.
  }

  // canonical → clean /reviews on ALL pages (no ?page) per CAT-C-2.3, anchored on
  // the establishment's own slug (not the raw route slug, F4). robots is NOT
  // overridden — reviews carry no filters, and the global NOINDEX gate (root
  // layout) governs pre-launch. metadataBase promotes the relative path →
  // absolute. title.template ('%s | Nirivio') appends the brand suffix.
  return {
    title,
    description,
    alternates: {
      canonical: `/${city}/${category}/${canonicalSlug}/reviews`,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      ...(ogImageUrl ? { images: [{ url: ogImageUrl, alt: title }] } : {}),
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { city, category, slug } = await params;
  const sp = await searchParams;
  const page = parsePage(sp.page);

  // 1. Validate city + category slugs (React.cache dedups getMetadata across
  //    these calls + the getMetadata() below + generateMetadata).
  const [cityValid, categoryValid] = await Promise.all([
    validateCitySlug(city),
    validateCategorySlug(category),
  ]);
  if (!cityValid || !categoryValid) notFound();

  // 2. Establishment entity. ApiError 404 → notFound; other errors propagate.
  let detailResult;
  try {
    detailResult = await getCachedBySlug(slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }
  const { establishment } = detailResult;

  // 3. Paginated reviews + display metadata. getReviews is intentionally NOT
  //    caught: an empty list is handled below as a valid state, while a real
  //    fetch error must surface (error boundary), not look like "no reviews".
  const [reviewsResult, meta] = await Promise.all([
    getReviews(slug, { page, limit: REVIEWS_PER_PAGE }),
    getMetadata(),
  ]);

  const cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
  const categoryName =
    meta.categories.find((c) => c.slug === category)?.name ?? category;
  const detailHref = `/${city}/${category}/${establishment.slug}`;
  const averageRating = establishment.average_rating;
  const label = ratingLabel(averageRating);
  const total = reviewsResult.pagination.total;

  return (
    <main className='mx-auto flex w-full max-w-3xl flex-1 flex-col gap-l p-l'>
      {/* Review JSON-LD (current page's reviews) — bound to the detail entity
          via @id/url. Not emitted for an empty list. */}
      <ReviewSchema
        establishment={establishment}
        reviews={reviewsResult.reviews}
        citySlug={city}
        categorySlug={category}
      />

      {/* Breadcrumbs — one level deeper than detail: …/{name → detail}/Отзывы */}
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
        <Link href={`/${city}/${category}`} className='hover:text-foreground'>
          {categoryName.toLowerCase()}
        </Link>
        <span aria-hidden='true'>/</span>
        <Link href={detailHref} className='hover:text-foreground'>
          {establishment.name}
        </Link>
        <span aria-hidden='true'>/</span>
        <span aria-current='page' className='text-foreground'>
          Отзывы
        </span>
      </nav>

      {/* Header: title + rating summary (same helpers as ReviewCarousel) */}
      <header className='flex flex-col gap-s'>
        <h1 className='text-display-s font-display'>
          Отзывы о «{establishment.name}»
        </h1>
        <div className='flex flex-wrap items-center gap-m'>
          {averageRating != null ? (
            <span className='inline-flex items-center gap-s'>
              <span className='inline-flex size-10 items-center justify-center rounded-s bg-success-status text-headline-m font-medium text-text-on-primary'>
                {formatRating(averageRating)}
              </span>
              {label ? (
                <span className='text-body-l text-foreground'>{label}</span>
              ) : null}
              <span className='text-body-m text-muted-foreground'>
                · {pluralizeReviews(total)}
              </span>
            </span>
          ) : (
            <span className='text-body-m text-muted-foreground'>
              {pluralizeReviews(total)}
            </span>
          )}
        </div>
      </header>

      {/* Review list (full content, clamp=false) or graceful empty-state */}
      {reviewsResult.reviews.length === 0 ? (
        <p className='rounded-l border border-border bg-figma-bg-warm p-l text-body-m text-muted-foreground'>
          Пока нет отзывов. Будьте первым, кто оставит отзыв!
        </p>
      ) : (
        <div className='flex flex-col gap-m'>
          {reviewsResult.reviews.map((review) => (
            <ReviewCard key={review.id} review={review} clamp={false} />
          ))}
        </div>
      )}

      <CatalogPagination
        currentPage={reviewsResult.pagination.page}
        totalPages={reviewsResult.pagination.totalPages}
        basePath={`/${city}/${category}/${establishment.slug}/reviews`}
        searchParams={{}}
      />
    </main>
  );
}

// ----- helpers -------------------------------------------------------------

function parsePage(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return n;
}
