'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { catalogBackLink } from '@/lib/catalog-labels';

/*
 * CatalogBackLink — the way back from the catalog's «не найдено» pages.
 *
 * not-found.tsx receives no props, so the city and category of the address
 * are read here with useParams (Next: path-dependent not-found content is the
 * client's job). The link leads to the category in that city, falling back to
 * the city and then to the home page when a part of the address is unknown.
 *
 * `cityOnly` — for the category's own «не найдено»: a link to the category
 * would lead back to the page that was not found, so the city is the top.
 */
export function CatalogBackLink({ cityOnly = false }: { cityOnly?: boolean }) {
  const { city, category } = useParams<{ city?: string; category?: string }>();
  const { href, label } = catalogBackLink(
    city,
    cityOnly ? undefined : category,
  );

  return (
    <Link
      href={href}
      className='text-primary underline-offset-4 hover:underline'
    >
      {label}
    </Link>
  );
}
