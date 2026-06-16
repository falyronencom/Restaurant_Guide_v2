'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { MetadataSlug } from '@/lib/api/types';

const LS_KEY = 'nirivio:selected-city';
const DEFAULT_CITY = 'minsk';

type Props = {
  cities: MetadataSlug[];
  className?: string;
};

/*
 * City switcher — header control. The selected city persists in localStorage
 * (client-only; reading it server-side would force the public layout dynamic
 * and break ISR). The URL [city] segment stays the rendered source of truth:
 * on a city route the switcher reflects that city; changing it navigates to the
 * chosen city's overview.
 *
 * Hydration: localStorage is read AFTER mount and the resulting setState is
 * deferred a tick. A lazy useState initializer would diverge from the
 * server-rendered HTML (SSR mismatch); a synchronous setState in the effect
 * trips react-hooks/set-state-in-effect (feedback_react_localstorage_hydration_defer).
 */
export function CitySwitcher({ cities, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  // City implied by the URL when the first path segment is a known city slug.
  const firstSegment = pathname.split('/')[1] ?? '';
  const urlCity = cities.some((c) => c.slug === firstSegment)
    ? firstSegment
    : null;

  const [storedCity, setStoredCity] = useState<string>(DEFAULT_CITY);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LS_KEY);
    } catch {
      saved = null;
    }
    if (!saved || !cities.some((c) => c.slug === saved)) return undefined;
    const persisted = saved;
    const timer = setTimeout(() => setStoredCity(persisted), 0);
    return () => clearTimeout(timer);
  }, [cities]);

  // URL wins when present; otherwise the persisted / default choice.
  const current = urlCity ?? storedCity;

  function onChange(slug: string) {
    try {
      localStorage.setItem(LS_KEY, slug);
    } catch {
      /* private mode / quota — non-fatal */
    }
    setStoredCity(slug);
    router.push(`/${slug}`);
  }

  return (
    <select
      aria-label="Выбрать город"
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {cities.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
