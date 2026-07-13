'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { EstablishmentCard } from '@/components/catalog/EstablishmentCard';
import {
  FavoritesProvider,
  useFavorites,
} from '@/components/favorites/FavoritesProvider';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { loadFavorites } from '@/lib/account/client';
import type {
  FavoriteListItem,
  PublicEstablishmentListing,
} from '@/lib/api/types';
import { cn } from '@/lib/utils';

/*
 * Favorites list island (user-ЛК Slice 1). Hydrates the authed list via the
 * buffered Route Handler (httpOnly tokens → ask the server, cabinet pattern);
 * anonymous → client redirect to /login?returnTo=/favorites — the (account)
 * shell is static, so the guard lives here (NO_SESSION from the handler).
 *
 * Cards reuse the catalog EstablishmentCard verbatim (its built-in
 * FavoriteButton included). Unfavoriting removes the card in place: the grid
 * watches the FavoritesProvider optimistic map — a card seen favorited that is
 * now not (heart toggled off) unmounts immediately and reappears on rollback
 * (failed remove). Collections >50 load in pages via «Показать ещё».
 */

/*
 * Detail links: the card builds /{city_slug}/{category_slug}/{slug} from the
 * item's own backend-derived slugs; these fallbacks only cover rows whose
 * city/category sit outside the URL canon (the detail route resolves by the
 * establishment slug, so an imperfect prefix still lands).
 */
const FALLBACK_CITY_SLUG = 'minsk';
const FALLBACK_CATEGORY_SLUG = 'restaurants';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | {
      phase: 'ready';
      items: FavoriteListItem[];
      page: number;
      hasNext: boolean;
      loadingMore: boolean;
    };

/**
 * Wire row → catalog listing shape for EstablishmentCard. Fields absent from
 * the favorites projection and never read by the card (promo/booking flags,
 * phone/website, counters) are stubbed neutrally — the visible gap is only the
 * АКЦИЯ badge, which the favorites wire does not carry.
 */
function toListing(item: FavoriteListItem): PublicEstablishmentListing {
  return {
    id: item.establishment_id,
    slug: item.establishment_slug ?? '',
    name: item.establishment_name,
    description: item.establishment_description,
    city: item.establishment_city,
    city_slug: item.establishment_city_slug,
    address: item.establishment_address,
    latitude: item.establishment_latitude,
    longitude: item.establishment_longitude,
    phone: null,
    website: null,
    categories: item.establishment_categories ?? [],
    category_slug: item.establishment_category_slug,
    cuisines: item.establishment_cuisines ?? [],
    price_range: item.establishment_price_range,
    working_hours: item.establishment_working_hours,
    attributes: null,
    status: item.establishment_status,
    primary_image_url: item.establishment_primary_image,
    review_count: item.establishment_review_count,
    average_rating: item.establishment_average_rating,
    favorite_count: 0,
    booking_enabled: false,
    has_promotion: false,
    promotion_count: 0,
    published_at: null,
    created_at: item.created_at,
    updated_at: item.created_at,
  };
}

export function FavoritesList() {
  const router = useRouter();
  const { markAnonymous } = useAuth();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadFavorites()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.code === 'NO_SESSION') {
            // Sync the client auth context first: /login's AuthRedirect would
            // bounce a stale 'authenticated' status straight back here
            // (redirect ping-pong). Non-destructive — cookies stay intact.
            markAnonymous();
            router.replace('/login?returnTo=/favorites');
            return; // keep the skeleton while the redirect lands
          }
          setState({ phase: 'error' });
          return;
        }
        setState({
          phase: 'ready',
          items: res.favorites,
          page: res.page,
          hasNext: res.hasNext,
          loadingMore: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [router, markAnonymous]);

  const loadMore = async () => {
    if (state.phase !== 'ready' || state.loadingMore || !state.hasNext) return;
    const nextPage = state.page + 1;
    setState({ ...state, loadingMore: true });
    const res = await loadFavorites(nextPage);
    setState((prev) => {
      if (prev.phase !== 'ready') return prev;
      if (!res.ok) return { ...prev, loadingMore: false };
      return {
        phase: 'ready',
        items: [...prev.items, ...res.favorites],
        page: res.page,
        hasNext: res.hasNext,
        loadingMore: false,
      };
    });
  };

  if (state.phase === 'loading') return <ListSkeleton />;
  if (state.phase === 'error') return <ListError />;
  if (state.items.length === 0 && !state.hasNext) return <EmptyState />;

  return (
    <FavoritesProvider
      establishmentIds={state.items.map((item) => item.establishment_id)}
    >
      <FavoritesGrid
        items={state.items}
        hasNext={state.hasNext}
        loadingMore={state.loadingMore}
        onLoadMore={() => void loadMore()}
      />
    </FavoritesProvider>
  );
}

function FavoritesGrid({
  items,
  hasNext,
  loadingMore,
  onLoadMore,
}: {
  items: FavoriteListItem[];
  hasNext: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const { isFavorite } = useFavorites();
  // Ratchet: ids seen favorited at least once — the provider hydrates its map
  // after mount, so a bare !isFavorite can't distinguish "not hydrated yet"
  // from "unfavorited". Guarded state adjustment during render (react.dev
  // "adjusting state when a prop changes" — the same pattern as
  // FavoritesProvider's status reset): React re-renders immediately.
  const [everFavorite, setEverFavorite] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const newlyFavorited = items.filter(
    (item) =>
      isFavorite(item.establishment_id) &&
      !everFavorite.has(item.establishment_id),
  );
  if (newlyFavorited.length > 0) {
    setEverFavorite((prev) => {
      const next = new Set(prev);
      for (const item of newlyFavorited) next.add(item.establishment_id);
      return next;
    });
  }
  const visible = items.filter(
    (item) =>
      !(
        everFavorite.has(item.establishment_id) &&
        !isFavorite(item.establishment_id)
      ),
  );

  // Empty only when nothing is left server-side either — with hasNext the
  // list still has unloaded pages, so keep the load-more path visible.
  if (visible.length === 0 && !hasNext) return <EmptyState />;

  return (
    <div className="flex flex-col gap-l">
      <div className="grid gap-m sm:grid-cols-2">
        {visible.map((item) => (
          <EstablishmentCard
            key={item.id}
            establishment={toListing(item)}
            fallbackCitySlug={FALLBACK_CITY_SLUG}
            fallbackCategorySlug={FALLBACK_CATEGORY_SLUG}
          />
        ))}
      </div>
      {hasNext && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Загрузка…' : 'Показать ещё'}
          </Button>
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-m sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="aspect-[3/2] w-full rounded-card" />
      ))}
    </div>
  );
}

function ListError() {
  return (
    <div className="rounded-[var(--radius-l)] border border-border bg-background p-l text-center">
      <p className="text-body-m text-foreground">
        Не удалось загрузить избранное. Обновите страницу.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-m rounded-[var(--radius-l)] border border-dashed border-border bg-background p-xl text-center">
      <p className="text-headline-s text-foreground">В избранном пока пусто</p>
      <p className="max-w-md text-body-m text-figma-text-grey">
        Нажимайте на сердечко на карточке заведения, чтобы сохранить его здесь.
      </p>
      <Link href="/" className={cn(buttonVariants({ size: 'cta' }))}>
        В каталог
      </Link>
    </div>
  );
}
