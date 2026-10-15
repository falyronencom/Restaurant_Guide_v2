'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { catalogBackLink } from '@/lib/catalog-labels';

/*
 * CatalogBackLink — the way back from the establishment «не найдено» page.
 *
 * not-found.tsx receives no props, so the city and category of the address
 * are read here with useParams (Next: path-dependent not-found content is the
 * client's job). The link leads to the category in that city, falling back to
 * the city and then to the home page when a part of the address is unknown.
 */
export function CatalogBackLink() {
  const { city, category } = useParams<{ city?: string; category?: string }>();
  const { href, label } = catalogBackLink(city, category);

  return (
    <Link
      href={href}
      className='text-primary underline-offset-4 hover:underline'
    >
      {label}
    </Link>
  );
}
