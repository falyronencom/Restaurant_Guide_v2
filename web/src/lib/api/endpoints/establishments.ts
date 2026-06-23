import 'server-only';

import { serverFetch } from '../client';
import type {
  PublicEstablishmentListing,
  PublicEstablishmentDetail,
  PublicEstablishmentMapMarker,
  PublicReview,
  PublicMenuItem,
  PaginationMeta,
} from '../types';

/*
 * Public establishments — typed endpoint functions over /api/v1/public/*.
 *
 * Endpoint coverage (per Brief 1 — Discovery Q5):
 *   GET /establishments                                — catalog list
 *   GET /establishments/map                            — map markers
 *   GET /establishments/by-slug/:slug                  — full detail
 *   GET /establishments/by-slug/:slug/menu-items
 *   GET /establishments/by-slug/:slug/reviews
 *
 * Parameter names match backend convention exactly (snake_case where
 * backend expects snake — sort_by, hours_filter). Arrays (cuisines,
 * priceRange) serialised as comma-separated; backend parseListParam
 * accepts both forms.
 */

// ============================================================================
// Catalog
// ============================================================================

export type CatalogParams = {
  city?: string;
  category?: string;
  cuisines?: string[];
  priceRange?: string[];
  features?: string[];
  minRating?: number;
  hours_filter?: 'until_22' | 'until_morning' | '24_hours';
  search?: string;
  sort_by?: string;
  limit?: number;
  page?: number;
};

export type CatalogResponse = {
  establishments: PublicEstablishmentListing[];
  pagination: PaginationMeta;
};

export async function getCatalog(
  params: CatalogParams = {},
): Promise<CatalogResponse> {
  return serverFetch<CatalogResponse>(
    `/api/v1/public/establishments${buildQuery(params)}`,
  );
}

// ============================================================================
// Map
// ============================================================================

export type MapParams = {
  city?: string;
  category?: string;
  cuisines?: string[];
  priceRange?: string[];
  minRating?: number;
  hours_filter?: 'until_22' | 'until_morning' | '24_hours';
  search?: string;
  limit?: number;
  /**
   * Viewport rectangle (camera-driven map). All four together, or none —
   * present → backend filters to the visible box via searchByBounds; partial
   * → backend 422. City is implied by the box, so omit it when sending bounds.
   */
  neLat?: number;
  neLon?: number;
  swLat?: number;
  swLon?: number;
};

export type MapResponse = {
  establishments: PublicEstablishmentMapMarker[];
};

export async function getMap(params: MapParams = {}): Promise<MapResponse> {
  return serverFetch<MapResponse>(
    `/api/v1/public/establishments/map${buildQuery(params)}`,
  );
}

// ============================================================================
// Detail by slug
// ============================================================================

export type DetailResponse = {
  establishment: PublicEstablishmentDetail;
};

export async function getBySlug(slug: string): Promise<DetailResponse> {
  return serverFetch<DetailResponse>(
    `/api/v1/public/establishments/by-slug/${encodeURIComponent(slug)}`,
  );
}

// ============================================================================
// Menu items by slug
// ============================================================================

export type MenuItemsResponse = {
  menu_items: PublicMenuItem[];
};

export async function getMenuItems(slug: string): Promise<MenuItemsResponse> {
  return serverFetch<MenuItemsResponse>(
    `/api/v1/public/establishments/by-slug/${encodeURIComponent(slug)}/menu-items`,
  );
}

// ============================================================================
// Reviews by slug
// ============================================================================

export type ReviewsParams = {
  page?: number;
  limit?: number;
};

export type ReviewsResponse = {
  reviews: PublicReview[];
  pagination: PaginationMeta;
};

export async function getReviews(
  slug: string,
  params: ReviewsParams = {},
): Promise<ReviewsResponse> {
  return serverFetch<ReviewsResponse>(
    `/api/v1/public/establishments/by-slug/${encodeURIComponent(slug)}/reviews${buildQuery(params)}`,
  );
}

// ============================================================================
// Helpers
// ============================================================================

type QueryValue = string | string[] | number | boolean | undefined | null;

function buildQuery(params: Record<string, QueryValue>): string {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.join(','))}`);
    } else {
      entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return entries.length > 0 ? `?${entries.join('&')}` : '';
}
