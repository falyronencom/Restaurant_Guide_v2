'use client';

import { Heart } from 'lucide-react';

import { useFavorites } from './FavoritesProvider';

/*
 * Favorites proving-action — client island. Lives OUTSIDE the EstablishmentCard
 * <Link> (rendered as an absolutely-positioned sibling) so it is valid markup
 * and its click never triggers card navigation. stopPropagation is belt-and-
 * suspenders. Optimistic toggle + rollback is handled by FavoritesProvider;
 * an unauthenticated tap opens the login prompt instead of mutating.
 */
export function FavoriteButton({
  establishmentId,
  className = '',
}: {
  establishmentId: string;
  className?: string;
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(establishmentId);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? 'Убрать из избранного' : 'В избранное'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle(establishmentId);
      }}
      className={`flex size-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background ${className}`}
    >
      <Heart
        size={18}
        className={active ? 'fill-current text-brand' : 'text-foreground'}
      />
    </button>
  );
}
