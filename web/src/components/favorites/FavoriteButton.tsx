'use client';

import { Heart } from 'lucide-react';
import type { MouseEvent } from 'react';

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
  variant = 'icon',
}: {
  establishmentId: string;
  className?: string;
  /** 'icon' = circle heart overlay (catalog cards); 'labeled' = outlined
   *  «Сохранить» button (establishment detail header). */
  variant?: 'icon' | 'labeled';
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(establishmentId);

  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void toggle(establishmentId);
  };

  if (variant === 'labeled') {
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`inline-flex items-center gap-2 rounded-m border border-border bg-background px-4 py-2.5 text-body-m font-medium text-foreground transition-colors hover:bg-muted ${className}`}
      >
        <Heart
          size={18}
          className={active ? 'fill-current text-brand' : 'text-brand'}
        />
        {active ? 'Сохранено' : 'Сохранить'}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? 'Убрать из избранного' : 'В избранное'}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-full bg-background text-brand shadow-sm backdrop-blur-sm transition-colors hover:bg-background ${className}`}
    >
      <Heart
        size={16}
        className={active ? 'fill-current text-brand' : 'text-brand'}
      />
    </button>
  );
}
