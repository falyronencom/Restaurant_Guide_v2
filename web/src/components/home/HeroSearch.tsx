'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MetadataSlug } from '@/lib/api/types';
import { useSelectedCity } from '@/lib/city/selected-city';

type Props = {
  cities: MetadataSlug[];
};

/*
 * Hero search cluster — the interactive island of the home hero (the rest of
 * the hero is static, server-rendered). Owns the selected-city choice (shared
 * via useSelectedCity with the header switcher) and the search term.
 *
 * City is CONTEXT, not a gate: search navigates immediately to the city's
 * results, defaulting to Минск, with no forced city/filter step. serverFetch is
 * server-only, so this NAVIGATES (router.push) rather than calling the API.
 *   - city chip → retargets the search (stays on `/`, no navigation)
 *   - «Фильтры» → the city overview page, which carries the full filter rail
 *   - submit    → /{city}?search=<term>  (or /{city} when the term is empty)
 */
export function HeroSearch({ cities }: Props) {
  const router = useRouter();
  const { city, setCity } = useSelectedCity(cities);
  const [term, setTerm] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/${city}?search=${encodeURIComponent(q)}` : `/${city}`);
  }

  return (
    <>
      {/* City + Filters pills — mobile-faithful binding */}
      <div className="mt-xl flex items-center gap-m">
        <span className="relative inline-flex items-center">
          <select
            aria-label="Выбрать город"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="cursor-pointer appearance-none rounded-full border border-white/70 bg-transparent py-s pl-l pr-9 text-label-l text-white outline-none"
          >
            {cities.map((c) => (
              <option key={c.slug} value={c.slug} className="text-text-primary">
                {c.name}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-white/70"
          >
            ▾
          </span>
        </span>

        <Link
          href={`/${city}`}
          className="flex items-center gap-s rounded-full border border-white/70 px-l py-s text-label-l text-white transition-colors hover:bg-white/10"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
            <circle cx="15" cy="7" r="2" />
            <circle cx="9" cy="17" r="2" />
          </svg>
          Фильтры
        </Link>
      </div>

      {/* Search — orange button = primary action (Booking «Найти») */}
      <form
        onSubmit={onSubmit}
        className="mt-m flex w-full max-w-[34rem] items-stretch overflow-hidden rounded-full bg-white shadow-xl"
      >
        <input
          type="search"
          name="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Найти заведение"
          aria-label="Поиск заведения"
          className="flex-1 bg-transparent px-l py-m text-body-l text-foreground outline-none placeholder:text-text-tertiary"
        />
        <button
          type="submit"
          aria-label="Найти"
          className="flex items-center justify-center bg-brand px-l text-2xl text-white transition-colors hover:bg-brand-dark"
        >
          ›
        </button>
      </form>
    </>
  );
}
