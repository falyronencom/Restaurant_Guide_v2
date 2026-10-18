import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Suspense, cache } from 'react';

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
import {
  DETAIL_REVIEWS_LIMIT,
  formatRating,
  pluralizeReviews,
  ratingColorClass,
} from '@/lib/establishment-helpers';
import { establishmentAddress } from '@/lib/establishment-path';
import { NOT_FOUND_TITLE } from '@/lib/not-found-titles';
import { normalizeCategory, normalizeCuisine } from '@/lib/working-hours';
import { OpenStatusBadge } from '@/components/catalog/OpenStatusBadge';
import { AnchorNav } from '@/components/establishment/AnchorNav';
import { Attributes } from '@/components/establishment/Attributes';
import { ContactSidebar } from '@/components/establishment/ContactSidebar';
import { EstablishmentMapOverlay } from '@/components/establishment/EstablishmentMapOverlay';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { FavoritesProvider } from '@/components/favorites/FavoritesProvider';
import { Description } from '@/components/establishment/Description';
import { Gallery } from '@/components/establishment/Gallery';
import { InfoCard } from '@/components/establishment/InfoCard';
import { Location as LocationSection } from '@/components/establishment/Location';
import { MenuBlock } from '@/components/establishment/MenuBlock';
import { PromotionBanner } from '@/components/establishment/PromotionBanner';
import { RestaurantSchema } from '@/components/establishment/RestaurantSchema';
import { ReviewCarousel } from '@/components/establishment/ReviewCarousel';
import { ReviewsLoadFailed } from '@/components/establishment/ReviewsLoadFailed';

/*
 * /[city]/[category]/[slug] — Establishment detail composite (Brief 4).
 *
 * Server Component. Validates city+category slugs, fetches the full detail
 * via getBySlug (404 → notFound() through Next's not-found.tsx boundary),
 * redirects every other address of the card to its own (establishmentAddress),
 * then in parallel fetches menu items + reviews. Composes seven sections into
 * a Booking-inspired two-column layout (single-column on mobile).
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
  let canonical: string | null = null;
  let ogImageUrl: string | null = null;

  try {
    // The page's own checks, in its order: an unknown city/category or a
    // backend 404 render not-found.tsx, and the tab says the same.
    const [cityValid, categoryValid] = await Promise.all([
      validateCitySlug(city),
      validateCategorySlug(category),
    ]);
    if (!cityValid || !categoryValid) {
      return { title: NOT_FOUND_TITLE.establishment };
    }
    const [detail, meta] = await Promise.all([
      // Only the card's own 404 is «не найдено» — the body maps exactly that
      // one to notFound(); a 404 from anything else is an error there.
      getCachedBySlug(slug).catch((err: unknown) => {
        if (err instanceof ApiError && err.statusCode === 404) return null;
        throw err;
      }),
      getMetadata(),
    ]);
    if (!detail) return { title: NOT_FOUND_TITLE.establishment };
    // Names and canonical come from the card, not from the address it was
    // requested under: a foreign city/category redirects (page body), and
    // the redirecting response points crawlers at the same address.
    const address = establishmentAddress(detail.establishment);
    const cityName =
      meta.cities.find((c) => c.slug === address.citySlug)?.name ??
      address.citySlug;
    const categoryName =
      meta.categories.find((c) => c.slug === address.categorySlug)?.name ??
      address.categorySlug;
    const lowerCategory = categoryName.toLowerCase();
    title = `${detail.establishment.name} — ${lowerCategory} в городе ${cityName}`;
    description = detail.establishment.description
      ? truncate(detail.establishment.description, 160)
      : `${detail.establishment.name} — ${lowerCategory} в городе ${cityName}. Меню, отзывы, контакты.`;
    canonical = address.path;
    ogImageUrl = detail.establishment.primary_image_url;
  } catch {
    // Backend hiccup — fall back to slug strings, skip the OG image override
    // and the canonical (no card, no address to point at); the page body
    // surfaces the error boundary.
  }

  // openGraph.title does NOT inherit title.template (Discovery F5) — set
  // explicitly. canonical uses relative path; metadataBase in root layout
  // auto-promotes it to absolute. Per-establishment OG image overrides root
  // layout's opengraph-image.tsx file convention; if image fetch failed
  // above we fall back to the brand default by omitting `images`.
  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title,
      description,
      type: 'website',
      ...(ogImageUrl ? { images: [{ url: ogImageUrl, alt: title }] } : {}),
    },
    twitter: {
      title,
      description,
      // twitter:image inherits openGraph.images when absent (X spec)
    },
  };
}

export default async function EstablishmentPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { city, category, slug } = await params;

  // 1. Validate city + category slugs in parallel (React.cache dedup via
  //    getMetadata wrapper shared with validate* helpers). An unknown one is
  //    a 404, not a redirect: only a known city/category makes a foreign
  //    address of the card (step 3).
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

  // 3. One address per card. The slug alone found it, so a known but foreign
  //    city/category would open it as well — every such address redirects
  //    permanently to the card's own, before menu and reviews are fetched.
  //    (public)/loading.tsx streams this page, so the status is already 200
  //    here (the reason notFound() answers 200 + noindex): Next sends the
  //    redirect as <meta http-equiv="refresh" content="0;url=…"> plus a
  //    client-side replace — checked on `next start`, 13.10.2026. Google reads
  //    an instant meta refresh as a permanent redirect, Yandex as a temporary
  //    one (its webmaster help, «Meta tags»); the response's canonical
  //    (generateMetadata) names the same address for both.
  //    The redirect is cached like the page (ISR, an hour) and nothing
  //    revalidates a card on edit: when a card's address changes (city, or
  //    its first category), the old and the new address can point at each
  //    other until the older cache entry expires.
  const address = establishmentAddress(establishment);
  if (address.path !== `/${city}/${category}/${slug}`) {
    permanentRedirect(address.path);
  }

  // 4. Parallel fetches: menu + reviews + metadata. The page is still useful
  //    without menu/reviews, so their failures do not fail the page. A reviews
  //    failure is NOT turned into an empty list: that read as «Пока нет
  //    отзывов» and this ISR page kept it for up to an hour. `null` renders
  //    ReviewsLoadFailed instead — it loads the reviews from the visitor's
  //    browser and, on success, drops the cached page (reloadReviewsAction).
  const [menuItemsResult, reviewsResult, meta] = await Promise.all([
    getMenuItems(slug).catch(() => ({ menu_items: [] })),
    getReviews(slug, { limit: DETAIL_REVIEWS_LIMIT }).catch(() => null),
    getMetadata(),
  ]);

  const { citySlug, categorySlug } = address;
  const cityName =
    meta.cities.find((c) => c.slug === citySlug)?.name ?? citySlug;
  const categoryName =
    meta.categories.find((c) => c.slug === categorySlug)?.name ?? categorySlug;
  const displayCategory = establishment.categories[0]
    ? normalizeCategory(establishment.categories[0])
    : categoryName;
  const primaryCuisine = establishment.cuisines[0]
    ? normalizeCuisine(establishment.cuisines[0])
    : null;

  // Split media: PDF menus → MenuBlock fallback; gallery photos → Gallery.
  const pdfMenus = establishment.media.filter(
    (m) => m.file_type === 'pdf' && m.type === 'menu',
  );
  const menuPhotos = establishment.media.filter(
    (m) => m.type === 'menu' && m.file_type !== 'pdf' && m.url,
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
        reviewsResult && reviewsResult.pagination.total > 0
          ? ` (${reviewsResult.pagination.total})`
          : undefined,
    },
  ];

  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-l p-l'>
      {/* JSON-LD place-level schema (Brief 5) — invisible script tag, Server
          Component, MenuBlock injection pattern. citySlug/categorySlug are
          the card's own address (establishmentAddress — fallbacks for a card
          outside the URL canon), the one canonical points at. */}
      <RestaurantSchema
        establishment={establishment}
        citySlug={citySlug}
        categorySlug={categorySlug}
      />

      {/* Breadcrumbs */}
      <nav
        aria-label='Хлебные крошки'
        className='flex flex-wrap items-center gap-s text-caption-l text-muted-foreground'
      >
        <Link href='/' className='hover:text-foreground'>
          Главная
        </Link>
        <span aria-hidden='true'>/</span>
        <Link href={`/${citySlug}`} className='hover:text-foreground'>
          {cityName}
        </Link>
        <span aria-hidden='true'>/</span>
        <Link
          href={`/${citySlug}/${categorySlug}`}
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

      {/* Title block — favorites proving-action lives in the header (always
          visible; ContactSidebar is hidden on mobile). */}
      <FavoritesProvider establishmentIds={[establishment.id]}>
        <header className='flex flex-wrap items-end justify-between gap-m'>
          {/* min-w-0 + wrap-anywhere: a long word in the name («…Рождественской»)
              wraps inside the column instead of running past a phone screen,
              where html/body overflow-x: clip would cut it off. */}
          <div className='flex min-w-0 max-w-full flex-col gap-1.5'>
            <p className='text-body-m text-muted-foreground'>
              {displayCategory.toLowerCase()}
              {primaryCuisine ? ` · ${primaryCuisine.toLowerCase()} кухня` : ''}
              {' · '}
              {cityName}
            </p>
            <h1 className='font-display text-[38px] leading-[1.05] font-bold tracking-[-0.5px] wrap-anywhere'>
              {establishment.name}
            </h1>
            <div className='mt-1 flex flex-wrap items-center gap-3 text-body-m text-muted-foreground'>
              {establishment.average_rating != null &&
              establishment.review_count > 0 ? (
                <span
                  className={`inline-flex items-center rounded-[var(--radius-s)] px-2.5 py-1 text-[15px] leading-none font-semibold text-text-on-primary ${ratingColorClass(
                    establishment.average_rating,
                  )}`}
                >
                  {formatRating(establishment.average_rating)}
                </span>
              ) : null}
              {establishment.review_count > 0 ? (
                <>
                  <span>{pluralizeReviews(establishment.review_count)}</span>
                  <span
                    className='size-1 rounded-full bg-border'
                    aria-hidden='true'
                  />
                </>
              ) : null}
              <OpenStatusBadge
                workingHours={establishment.working_hours}
                status={establishment.status}
              />
            </div>
          </div>
          <FavoriteButton
            establishmentId={establishment.id}
            variant='labeled'
            className='shrink-0'
          />
        </header>
      </FavoritesProvider>

      {/* Sticky anchor nav */}
      <AnchorNav items={anchorItems} />

      {/* Two-column grid: main content + sticky sidebar (desktop) */}
      <div className='grid grid-cols-1 gap-l lg:grid-cols-[1fr_320px] lg:items-start'>
        <div className='flex flex-col gap-xl'>
          <section id='overview' className='flex flex-col gap-l scroll-mt-32'>
            <InfoCard establishment={establishment} />
            {establishment.promotions.length > 0 ? (
              <PromotionBanner promotions={establishment.promotions} />
            ) : null}
            {establishment.description ? (
              <Description text={establishment.description} />
            ) : null}
          </section>

          <section id='menu' className='scroll-mt-32'>
            <MenuBlock
              menuItems={menuItemsResult.menu_items}
              menuPhotos={menuPhotos}
              pdfFallbacks={pdfMenus}
              establishmentName={establishment.name}
            />
          </section>

          <section id='amenities' className='scroll-mt-32'>
            <Attributes attributes={establishment.attributes} />
          </section>

          <section id='location' className='scroll-mt-32'>
            <LocationSection
              latitude={establishment.latitude}
              longitude={establishment.longitude}
              address={establishment.address}
              city={establishment.city}
            />
          </section>

          <section id='reviews' className='scroll-mt-32'>
            {reviewsResult ? (
              <ReviewCarousel
                reviews={reviewsResult.reviews}
                totalCount={reviewsResult.pagination.total}
                averageRating={establishment.average_rating}
                reviewsHref={`${address.path}/reviews`}
                establishmentId={establishment.id}
                establishmentName={establishment.name}
                detailPath={address.path}
              />
            ) : (
              <ReviewsLoadFailed
                slug={establishment.slug}
                averageRating={establishment.average_rating}
                reviewsHref={`${address.path}/reviews`}
                establishmentId={establishment.id}
                establishmentName={establishment.name}
                detailPath={address.path}
              />
            )}
          </section>
        </div>

        {/* top-24 (96px): clears the sticky site header (72px + 1px border,
            SiteHeader) — at top-l the card's first ~49px slid under it. */}
        <aside className='hidden lg:sticky lg:top-24 lg:block lg:self-start'>
          <ContactSidebar establishment={establishment} />
        </aside>
      </div>

      {/* In-page interactive-map overlay (D-2A) — one per page; the MapPreview
          triggers (main column + sidebar) open it via ?map=1. Suspense: it reads
          useSearchParams and this page is ISR (prod-build requirement). */}
      <Suspense fallback={null}>
        <EstablishmentMapOverlay
          citySlug={citySlug}
          slug={establishment.slug}
          name={establishment.name}
          latitude={establishment.latitude}
          longitude={establishment.longitude}
        />
      </Suspense>
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
