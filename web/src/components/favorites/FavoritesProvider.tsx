'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
 *
 * State is mirrored to a ref (the authoritative copy) so rapid same-card taps
 * compose correctly — toggle reads/writes mapRef synchronously rather than a
 * stale render closure, avoiding double-add desync.
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
  const mapRef = useRef<Record<string, boolean>>({});

  // Single writer for both the authoritative ref and the render state.
  const commit = useCallback((nextMap: Record<string, boolean>) => {
    mapRef.current = nextMap;
    setMap(nextMap);
  }, []);

  const idsKey = establishmentIds.join(',');

  // Batch-load favorite state once authenticated. Optimistic local edits (held
  // in mapRef) win over the server batch to avoid clobbering an in-flight toggle.
  useEffect(() => {
    if (status !== 'authenticated' || establishmentIds.length === 0) return;
    let cancelled = false;
    getFavoritesForIds(establishmentIds)
      .then((favorites) => {
        if (!cancelled) commit({ ...favorites, ...mapRef.current });
      })
      .catch(() => {
        /* favorites read must never break the page */
      });
    return () => {
      cancelled = true;
    };
    // establishmentIds tracked via idsKey to avoid re-runs on array identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, idsKey, commit]);

  // Reset hearts when the user logs out (avoid stale-filled state). Guarded
  // adjustment during render (react.dev "adjusting state when a prop changes")
  // instead of setState-in-effect — React re-renders immediately, so the
  // logged-out frame never paints stale-filled hearts.
  const [prevStatus, setPrevStatus] = useState(status);
  if (prevStatus !== status) {
    setPrevStatus(status);
    if (status === 'anonymous') setMap({});
  }

  // The authoritative ref clears post-commit (render-phase ref writes are
  // off-limits). The brief map/ref divergence is unobservable: by then status
  // is committed as anonymous, and both mapRef readers — toggle and the
  // batch-load effect — are auth-gated.
  useEffect(() => {
    if (status === 'anonymous') mapRef.current = {};
  }, [status]);

  const isFavorite = useCallback((id: string) => map[id] ?? false, [map]);

  const toggle = useCallback(
    async (id: string) => {
      if (!isAuthenticated) {
        requestLogin();
        return;
      }
      // Read/write the authoritative ref synchronously so rapid same-card taps
      // compose correctly (no stale-closure double-add).
      const previous = mapRef.current[id] ?? false;
      const next = !previous;
      commit({ ...mapRef.current, [id]: next }); // optimistic
      const result = next
        ? await addFavoriteAction(id)
        : await removeFavoriteAction(id);
      if (!result.ok) {
        commit({ ...mapRef.current, [id]: previous }); // rollback
      }
    },
    [isAuthenticated, requestLogin, commit],
  );

  const value = useMemo(() => ({ isFavorite, toggle }), [isFavorite, toggle]);

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}
