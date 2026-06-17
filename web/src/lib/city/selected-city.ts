'use client';

import { useEffect, useState } from 'react';

import type { MetadataSlug } from '@/lib/api/types';

/*
 * Shared selected-city state for the public surface. The choice persists in
 * localStorage (client-only — reading it server-side would force the public
 * layout dynamic and break ISR) and defaults to Минск.
 *
 * Consumers layer their own side-effect on top of setCity: the header switcher
 * navigates to the chosen city, while the home hero's chip only retargets the
 * search and stays on `/`. URL-vs-stored precedence is likewise a consumer
 * concern (the header lets the [city] route win; the hero has no [city] segment).
 *
 * Hydration: localStorage is read AFTER mount and the resulting setState is
 * deferred a tick. A lazy useState initializer would diverge from the
 * server-rendered HTML (SSR mismatch); a synchronous setState in the effect
 * trips react-hooks/set-state-in-effect (feedback_react_localstorage_hydration_defer).
 */
export const CITY_LS_KEY = 'nirivio:selected-city';
export const DEFAULT_CITY = 'minsk';

export function useSelectedCity(cities: MetadataSlug[]) {
  const [city, setCityState] = useState<string>(DEFAULT_CITY);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(CITY_LS_KEY);
    } catch {
      saved = null;
    }
    if (!saved || !cities.some((c) => c.slug === saved)) return undefined;
    const persisted = saved;
    const timer = setTimeout(() => setCityState(persisted), 0);
    return () => clearTimeout(timer);
  }, [cities]);

  function setCity(slug: string) {
    try {
      localStorage.setItem(CITY_LS_KEY, slug);
    } catch {
      /* private mode / quota — non-fatal */
    }
    setCityState(slug);
  }

  return { city, setCity };
}
