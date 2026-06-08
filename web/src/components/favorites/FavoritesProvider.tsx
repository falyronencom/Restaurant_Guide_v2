'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import {
  addFavoriteAction,
  getFavoritesForIds,
  removeFavoriteAction,
} from '@/lib/favorites/actions';

/*
 * Client favorites coordinator (DECISION #4, ISR-preserving variant).
 *
 * The RSC parent (catalog / detail page) passes the PUBLIC establishment ids it
 * already holds — no cookies() read, so the page stays ISR-cached. Once the
 * session hydrates as authenticated, this provider does ONE batched server-side
 * check (getFavoritesForIds) and shares the per-id state with the nested
 * FavoriteButton islands. Anonymous visitors trigger no batch call and every
 * heart renders empty.
 */

type FavoritesContextValue = {
  isFavorite: (id: string) => boolean;
  toggle: (id: string) => Promise<void>;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error('useFavorites must be used within <FavoritesProvider>');
  }
  return ctx;
}

export function FavoritesProvider({
  establishmentIds,
  children,
}: {
  establishmentIds: string[];
  children: ReactNode;
}) {
  const { status, isAuthenticated, requestLogin } = useAuth();
  const [map, setMap] = useState<Record<string, boolean>>({});

  const idsKey = establishmentIds.join(',');

  // Batch-load favorite state once authenticated. Optimistic local edits (in
  // `prev`) win over the server batch to avoid clobbering an in-flight toggle.
  useEffect(() => {
    if (status !== 'authenticated' || establishmentIds.length === 0) return;
    let cancelled = false;
    getFavoritesForIds(establishmentIds)
      .then((favorites) => {
        if (!cancelled) setMap((prev) => ({ ...favorites, ...prev }));
      })
      .catch(() => {
        /* favorites read must never break the page */
      });
    return () => {
      cancelled = true;
    };
    // establishmentIds tracked via idsKey to avoid re-runs on array identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, idsKey]);

  // Reset hearts when the user logs out (avoid stale-filled state).
  useEffect(() => {
    if (status === 'anonymous') setMap({});
  }, [status]);

  const isFavorite = useCallback((id: string) => map[id] ?? false, [map]);

  const toggle = useCallback(
    async (id: string) => {
      if (!isAuthenticated) {
        requestLogin();
        return;
      }
      const previous = map[id] ?? false;
      const next = !previous;
      setMap((prev) => ({ ...prev, [id]: next })); // optimistic
      const result = next
        ? await addFavoriteAction(id)
        : await removeFavoriteAction(id);
      if (!result.ok) {
        setMap((prev) => ({ ...prev, [id]: previous })); // rollback
      }
    },
    [isAuthenticated, requestLogin, map],
  );

  return (
    <FavoritesContext.Provider value={{ isFavorite, toggle }}>
      {children}
    </FavoritesContext.Provider>
  );
}
