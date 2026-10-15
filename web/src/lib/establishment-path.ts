import type { PublicEstablishmentListing } from '@/lib/api/types';

/*
 * The one address of an establishment card: /{city_slug}/{category_slug}/{slug}.
 *
 * The backend finds a card by its slug alone (slugs are globally unique), so
 * the city and category parts of the address carry no lookup meaning — any
 * known pair would open the card. The detail page and its /reviews page build
 * the address from the CARD (this function), redirect every other address to
 * it and use it as rel=canonical; the site's links (catalog, map, favorites,
 * sitemap) already build it from the same two API fields.
 *
 * A card whose city/category sits outside the URL canon gets null slugs from
 * the backend projection (none of the 46 production cards on 13.10.2026: the
 * city has a DB CHECK, the category canon is enforced by the validators). Such
 * a card keeps an address — the fallbacks most of the site's links already use
 * for it (favorites, home «Популярное», the city page, the map without a
 * category; a category page links it under its own category, one redirect
 * away) — rather than a 404 for a card that is active and listed; the sitemap
 * still leaves it out.
 */

export const FALLBACK_CITY_SLUG = 'minsk';
export const FALLBACK_CATEGORY_SLUG = 'restaurants';

type AddressedEstablishment = Pick<
  PublicEstablishmentListing,
  'slug' | 'city_slug' | 'category_slug'
>;

export type EstablishmentAddress = {
  citySlug: string;
  categorySlug: string;
  /** /{citySlug}/{categorySlug}/{slug} */
  path: string;
};

export function establishmentAddress(
  establishment: AddressedEstablishment,
): EstablishmentAddress {
  const citySlug = establishment.city_slug ?? FALLBACK_CITY_SLUG;
  const categorySlug = establishment.category_slug ?? FALLBACK_CATEGORY_SLUG;
  return {
    citySlug,
    categorySlug,
    path: `/${citySlug}/${categorySlug}/${establishment.slug}`,
  };
}
