/*
 * Average check in words for each price tier the backend accepts
 * (VALID_PRICE_RANGES in backend/src/validators/establishmentValidation.js —
 * the same set as PRICE_RANGES in lib/partner/constants.ts). One source for
 * the whole site: the venue card (InfoCard), the filters (facets.ts) and the
 * partner wizard (BasicInfoSection). Before 30.10.2026 the card and the
 * filters each held their own copy, and the wizard showed bare «$$».
 *
 * The app shows the same words (mobile/lib/utils/venue_labels.dart); its test
 * reads this file, so keep one entry per line: `  $$: 'до 50 руб',`.
 */
export const PRICE_DESCRIPTION: Readonly<Record<string, string>> = {
  $: 'до 20 руб',
  $$: 'до 50 руб',
  $$$: 'более 50 руб',
};

/** «$$ · до 50 руб» — the tier and its words, as filters and the wizard show it. */
export function priceRangeLabel(value: string): string {
  const words = PRICE_DESCRIPTION[value];
  return words ? `${value} · ${words}` : value;
}
