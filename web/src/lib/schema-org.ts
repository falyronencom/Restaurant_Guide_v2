import 'server-only';

import type { PublicEstablishmentDetail } from '@/lib/api/types';

/**
 * Schema.org JSON-LD shared primitives.
 *
 * Extracted from RestaurantSchema.tsx (Brief 5) so both the establishment
 * detail page (full Restaurant node) and the dedicated /reviews route (minimal
 * Restaurant node carrying Review[]) emit consistent, non-duplicated structured
 * data. Server-only — these run during RSC render, never in the client bundle.
 */

/**
 * Map establishment category (Cyrillic canonical OR legacy English seed) to a
 * Schema.org subtype. Targets per Brief 5 directive:
 *   Restaurant / CafeOrCoffeeShop / BarOrPub / Bakery / FastFoodRestaurant
 * Unknown values → FoodEstablishment (most generic).
 *
 * Both vocabularies must be supported: backend seeds may contain English
 * category strings that predate the Cyrillic canonical set; without legacy
 * mapping, those rows would always degrade to FoodEstablishment.
 */
export const CATEGORY_TO_SCHEMA_SUBTYPE: Record<string, string> = {
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

/**
 * Resolve an establishment category to its Schema.org subtype. Exact match
 * handles Cyrillic (backend uses specific case); lowercase match handles legacy
 * English (case-insensitive). Falls back to FoodEstablishment.
 */
export function mapCategoryToSchemaSubtype(categoryRaw: string | undefined): string {
  if (!categoryRaw) return 'FoodEstablishment';
  return (
    CATEGORY_TO_SCHEMA_SUBTYPE[categoryRaw] ??
    CATEGORY_TO_SCHEMA_SUBTYPE[categoryRaw.toLowerCase()] ??
    'FoodEstablishment'
  );
}

/** Schema.org AggregateRating node (1–5 Russian rating convention). */
export type AggregateRatingSchema = {
  '@type': 'AggregateRating';
  ratingValue: number;
  reviewCount: number;
  bestRating: 5;
  worstRating: 1;
};

/**
 * Build the AggregateRating node under the locked honest-emission gate:
 * `review_count >= 3 AND average_rating != null`. Small samples produce
 * misleading ratings; honest abstention is the locked default (Trunk decision,
 * Brief 5). Returns undefined when the gate is not met.
 *
 * ratingValue uses raw `average_rating` — the value InfoCard / ReviewCarousel /
 * ContactSidebar all render (markup=visible constraint satisfied). Shared by
 * RestaurantSchema (detail) and ReviewSchema (/reviews) so the gate lives once.
 */
export function buildAggregateRating(
  establishment: Pick<PublicEstablishmentDetail, 'review_count' | 'average_rating'>,
): AggregateRatingSchema | undefined {
  if (establishment.review_count >= 3 && establishment.average_rating != null) {
    return {
      '@type': 'AggregateRating',
      ratingValue: establishment.average_rating,
      reviewCount: establishment.review_count,
      bestRating: 5,
      worstRating: 1,
    };
  }
  return undefined;
}
