'use client';

import { usePathname, useRouter } from 'next/navigation';

import type { MetadataSlug } from '@/lib/api/types';
import { useSelectedCity } from '@/lib/city/selected-city';

type Props = {
  cities: MetadataSlug[];
  className?: string;
};

/*
 * City switcher — header control. Persistence + hydration live in the shared
 * useSelectedCity hook (also consumed by the home hero's city chip, so both
 * honour the same stored choice). Here the URL [city] segment stays the rendered
 * source of truth: on a city route the switcher reflects that city; changing it
 * navigates to the chosen city's overview.
 */
export function CitySwitcher({ cities, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { city: storedCity, setCity } = useSelectedCity(cities);

  // City implied by the URL when the first path segment is a known city slug.
  const firstSegment = pathname.split('/')[1] ?? '';
  const urlCity = cities.some((c) => c.slug === firstSegment)
    ? firstSegment
    : null;

  // URL wins when present; otherwise the persisted / default choice.
  const current = urlCity ?? storedCity;

  function onChange(slug: string) {
    setCity(slug);
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
