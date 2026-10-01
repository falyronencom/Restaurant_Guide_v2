import 'server-only';

import { serverFetch } from '../client';
import type { PaginationMeta, PublicEstablishmentListing } from '../types';

/*
 * Smart search — POST /api/v1/search/smart, the endpoint behind the mobile
 * search bar (free-text phrase → AI-parsed intent → the same search engine).
 *
 * Wire contract (backend smartSearchController):
 *   - `query` is required; city / categories / cuisines are the backend's
 *     CYRILLIC values (not the web's URL slugs) — callers translate first;
 *   - screen filters use the names the classic GET reads from the query string
 *     (one backend parser for both endpoints), lists as arrays;
 *   - a filter the user never touched is OMITTED, never sent as a default: an
 *     explicit `sort_by` overrides the order the phrase asked for («недорого»)
 *     and the name-first ranking (feedback_untouched_default_is_not_explicit).
 *     JSON.stringify drops `undefined` keys, so leaving a field undefined is
 *     the whole mechanism.
 * The establishments come back through the same listing projection as the
 * public catalog (searchService → toPublicEstablishmentListing), so catalog
 * cards render them unchanged.
 */

export type SmartSearchBody = {
  query: string;
  /** Cyrillic city name, e.g. «Минск» */
  city?: string;
  /** Cyrillic category values, e.g. ['Ресторан'] */
  categories?: string[];
  /** Cyrillic cuisine values, e.g. ['Итальянская'] */
  cuisines?: string[];
  priceRange?: string[];
  features?: string[];
  minRating?: number;
  hours_filter?: 'until_22' | 'until_morning' | '24_hours';
  sort_by?: string;
  page?: number;
  limit?: number;
};

/** The parsed phrase, as the backend normalises it (smartSearchService intentSchema). */
export type SmartSearchIntent = {
  category: string | null;
  cuisine: string[] | null;
  dish: string | null;
  dish_variants?: string[];
  meal_type: string | null;
  price_max: number | null;
  location: string | null;
  sort: string | null;
  tags: string[];
  error?: string | null;
};

export type SmartSearchResponse = {
  /** null when the AI was unavailable and the backend searched the raw phrase */
  intent: SmartSearchIntent | null;
  establishments: PublicEstablishmentListing[];
  pagination: PaginationMeta;
  /** true = the backend fell back to the classic text search (no parse) */
  fallback: boolean;
};

/*
 * How long the site waits for the smart endpoint. The backend budgets its AI
 * parse 20 s for both attempts — a cold model start through OpenRouter takes
 * 10–15 s (smartSearchService API_TIMEOUT_MS) — then runs the SQL. Cutting
 * the call at the transport's default 10 s would turn exactly that cold start
 * into the classic text search («терраса» → «Ничего не найдено») while the
 * backend finishes and caches the parse a moment later. The visitor waits
 * behind the «Ищем…» button / loading skeleton instead.
 */
export const SMART_SEARCH_TIMEOUT_MS = 25_000;

export async function smartSearch(
  body: SmartSearchBody,
): Promise<SmartSearchResponse> {
  return serverFetch<SmartSearchResponse>(
    '/api/v1/search/smart',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: SMART_SEARCH_TIMEOUT_MS },
  );
}
