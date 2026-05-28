/**
 * RestaurantSchema — Server Component (Brief 5).
 *
 * Inline JSON-LD Schema.org/Restaurant (or subtype) injection for the
 * establishment detail page. Mirrors the MenuBlock pattern (Discovery Q2):
 * standalone <script> tag with dangerouslySetInnerHTML — no wrapper
 * component, no library. Independent script tags per concern (one for Menu,
 * one for Restaurant); search engines parse each independently, no @id
 * cross-linking needed.
 *
 * Honest emission discipline (Trunk locked decisions):
 *   - Subtype mapping handles BOTH Cyrillic canonical AND legacy English seed
 *     values (Discovery Q5 — backend seeds predate the Cyrillic canonical
 *     vocabulary). Unknown values fall back to FoodEstablishment.
 *   - Field-presence gating: every property emitted ONLY when source data
 *     exists. We do not fabricate values to inflate SERP signals.
 *   - aggregateRating gated by review_count >= 3 AND average_rating != null
 *     — small samples produce misleading ratings; honest abstention is the
 *     locked default.
 *   - ratingValue uses raw `average_rating` (Discovery Q6 SR — the value
 *     InfoCard / ReviewCarousel / ContactSidebar all render; markup=visible
 *     constraint satisfied automatically; weighted_rating does not exist in
 *     the projection or DB schema).
 */

import type { PublicEstablishmentDetail } from '@/lib/api/types';
import { toAbsoluteUrl } from '@/lib/seo-gate';
import { normalizeCuisine } from '@/lib/working-hours';
import { normalizeWorkingHours } from '@/lib/establishment-helpers';

type Props = {
  establishment: PublicEstablishmentDetail;
  citySlug: string;
  categorySlug: string;
};

export function RestaurantSchema({ establishment, citySlug, categorySlug }: Props) {
  const schema = buildRestaurantSchema(establishment, citySlug, categorySlug);
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

// -- internals --------------------------------------------------------------

/**
 * Map establishment category (Cyrillic canonical OR legacy English seed) to
 * a Schema.org subtype. Targets per Brief 5 directive:
 *   Restaurant / CafeOrCoffeeShop / BarOrPub / Bakery / FastFoodRestaurant
 * Unknown values → FoodEstablishment (most generic).
 *
 * Both vocabularies must be supported (Discovery Q5): backend seeds may
 * contain English category strings that predate the Cyrillic canonical set;
 * without legacy mapping, those rows would always degrade to FoodEstablishment.
 */
const CATEGORY_TO_SCHEMA_SUBTYPE: Record<string, string> = {
  // Cyrillic canonical (backend constants/urlSlugs.js)
  'Ресторан': 'Restaurant',
  'Кафе': 'Restaurant',
  'Кофейня': 'CafeOrCoffeeShop',
  'Бар': 'BarOrPub',
  'Паб': 'BarOrPub',
  'Пиццерия': 'Restaurant',
  'Пекарня': 'Bakery',
  'Кондитерская': 'Bakery',
  'Фаст-фуд': 'FastFoodRestaurant',
  'Столовая': 'Restaurant',
  'Кальянная': 'BarOrPub',
  'Боулинг': 'Restaurant',
  'Караоке': 'BarOrPub',
  'Бильярд': 'Restaurant',
  'Клуб': 'BarOrPub',
  // Legacy English seed (mirrors working-hours.ts CATEGORY_LEGACY_TO_RU)
  'restaurant': 'Restaurant',
  'cafe': 'CafeOrCoffeeShop',
  'cafe_dining': 'Restaurant',
  'fast_food': 'FastFoodRestaurant',
  'pizzeria': 'Restaurant',
  'bar': 'BarOrPub',
  'pub': 'BarOrPub',
  'bakery': 'Bakery',
  'confectionery': 'Bakery',
  'karaoke': 'BarOrPub',
  'canteen': 'Restaurant',
  'hookah_bar': 'BarOrPub',
  'hookah_lounge': 'BarOrPub',
  'bowling': 'Restaurant',
  'billiards': 'Restaurant',
  'nightclub': 'BarOrPub',
};

function mapCategoryToSchemaSubtype(categoryRaw: string | undefined): string {
  if (!categoryRaw) return 'FoodEstablishment';
  // Exact match handles Cyrillic (backend uses specific case). Lowercase
  // match handles legacy English (case-insensitive).
  return (
    CATEGORY_TO_SCHEMA_SUBTYPE[categoryRaw] ??
    CATEGORY_TO_SCHEMA_SUBTYPE[categoryRaw.toLowerCase()] ??
    'FoodEstablishment'
  );
}

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;
const DAY_NAMES_SCHEMA = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const;

type OpeningHoursSpec = {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string;
  opens: string;
  closes: string;
};

function buildOpeningHoursSpec(workingHours: unknown): OpeningHoursSpec[] {
  const parsed = normalizeWorkingHours(workingHours);
  if (!parsed) return [];
  const specs: OpeningHoursSpec[] = [];
  for (let i = 0; i < 7; i++) {
    const day = parsed[DAY_KEYS[i]];
    if (!day || day.is_open === false) continue;
    if (!day.open || !day.close) continue;
    specs.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAY_NAMES_SCHEMA[i],
      opens: day.open,
      closes: day.close,
    });
  }
  return specs;
}

type RestaurantSchemaShape = {
  '@context': 'https://schema.org';
  '@type': string;
  name: string;
  url: string;
  address?: {
    '@type': 'PostalAddress';
    streetAddress: string;
    addressLocality: string;
    addressCountry: 'BY';
  };
  telephone?: string;
  image?: string;
  priceRange?: string;
  servesCuisine?: string[];
  geo?: {
    '@type': 'GeoCoordinates';
    latitude: number;
    longitude: number;
  };
  openingHoursSpecification?: OpeningHoursSpec[];
  acceptsReservations?: boolean;
  aggregateRating?: {
    '@type': 'AggregateRating';
    ratingValue: number;
    reviewCount: number;
    bestRating: 5;
    worstRating: 1;
  };
};

function buildRestaurantSchema(
  establishment: PublicEstablishmentDetail,
  citySlug: string,
  categorySlug: string,
): RestaurantSchemaShape {
  const subtype = mapCategoryToSchemaSubtype(establishment.categories[0]);

  const schema: RestaurantSchemaShape = {
    '@context': 'https://schema.org',
    '@type': subtype,
    name: establishment.name,
    url: toAbsoluteUrl(`/${citySlug}/${categorySlug}/${establishment.slug}`),
  };

  // address — emit only when both street and city present
  if (establishment.address && establishment.city) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: establishment.address,
      addressLocality: establishment.city,
      addressCountry: 'BY',
    };
  }

  // telephone
  if (establishment.phone) {
    schema.telephone = establishment.phone;
  }

  // image — primary_image_url is already absolute (Cloudinary CDN)
  if (establishment.primary_image_url) {
    schema.image = establishment.primary_image_url;
  }

  // priceRange — opaque string from backend (e.g. "$", "$$", "BYN 20-40")
  if (establishment.price_range) {
    schema.priceRange = establishment.price_range;
  }

  // servesCuisine — normalize legacy English to Russian for human-readable
  // values; Schema.org accepts both single string and array.
  if (establishment.cuisines && establishment.cuisines.length > 0) {
    schema.servesCuisine = establishment.cuisines.map(normalizeCuisine);
  }

  // geo — both coordinates required (PostGIS guarantees both or neither,
  // but defensive)
  if (establishment.latitude != null && establishment.longitude != null) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: establishment.latitude,
      longitude: establishment.longitude,
    };
  }

  // openingHoursSpecification — only emit when parseable hours exist
  const ohs = buildOpeningHoursSpec(establishment.working_hours);
  if (ohs.length > 0) {
    schema.openingHoursSpecification = ohs;
  }

  // acceptsReservations — emit when booking is enabled on the establishment
  if (establishment.booking_enabled) {
    schema.acceptsReservations = true;
  }

  // aggregateRating — locked gate: review_count >= 3 AND average_rating != null.
  // Small samples produce misleading ratings; honest abstention is default.
  if (
    establishment.review_count >= 3 &&
    establishment.average_rating != null
  ) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: establishment.average_rating,
      reviewCount: establishment.review_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return schema;
}
