import type { Metadata } from 'next';

import { FavoritesList } from '@/components/account/FavoritesList';

/*
 * /favorites — the user's saved establishments (user-ЛК Slice 1). Static RSC
 * shell (no cookies() — ISR hygiene of the whole tree holds); the island loads
 * the authed list via the buffered Route Handler and redirects anonymous
 * visitors to /login?returnTo=/favorites.
 */

export const metadata: Metadata = {
  title: 'Избранное',
};

export default function FavoritesPage() {
  return (
    <div className="flex flex-col gap-l">
      <h1 className="font-display text-display-s text-foreground">Избранное</h1>
      <FavoritesList />
    </div>
  );
}
