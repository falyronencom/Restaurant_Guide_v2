/**
 * Numbers and checks of the cabinet's «Меню» section. Pure, client-safe.
 *
 * Prices read as on the card's public page (MenuItemsList formatPrice):
 * «14 BYN», «14,50 BYN», «—» without a price (decision В3 of the directive).
 * The reasons of «Требует внимания» use the moderator panel's words with the
 * site's numbers (T7): money as above without the currency, confidence in
 * whole percent, a ratio as the panel writes it («в 4 раза», «в 5 раз»,
 * «в 3,5 раза» — admin-web moderation_vocabulary.dart _ratio/_times).
 */

import { FLAG_TEXTS, MENU_TEXTS } from '@/lib/partner/cabinet-texts';
import type { PartnerMenuItem, SanityFlag } from '@/lib/partner/menu';

/** «14», «14,50» — a sum without the currency. */
export function formatMoney(byn: number): string {
  if (byn % 1 === 0) return String(byn);
  return byn.toFixed(2).replace('.', ',');
}

/** «14 BYN», «14,50 BYN»; «—» when there is no price. */
export function formatMenuPrice(byn: number | null): string {
  return byn == null ? '—' : `${formatMoney(byn)} BYN`;
}

/** 0.62 → «62%». */
export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** 4 → «в 4 раза», 5 → «в 5 раз», 3.5 → «в 3,5 раза». */
export function formatTimes(ratio: number): string {
  if (ratio % 1 === 0) {
    const n = Math.round(ratio);
    const mod10 = n % 10;
    const mod100 = n % 100;
    // 1 раз, 2–4 раза, 5–20 раз, 21 раз, 22 раза — the panel's plural().
    const word = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'раза' : 'раз';
    return `в ${n} ${word}`;
  }
  // A fraction declines the denominator: «в 3,5 раза».
  return `в ${ratio.toFixed(1).replace('.', ',')} раза`;
}

const numberOf = (details: Record<string, unknown>, key: string): number | null => {
  const value = details[key];
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Why a line needs attention, with its numbers — by `sanity_flag.reason`.
 * An unknown reason, or one without the numbers it needs, gets the general
 * sentence: no raw code or details ever reach the screen.
 */
export function flagReasonText(flag: SanityFlag): string {
  const d = flag.details;
  switch (flag.reason) {
    case 'price_below_threshold':
    case 'price_above_threshold': {
      const price = numberOf(d, 'price');
      const threshold = numberOf(d, 'threshold');
      if (price == null || threshold == null) return FLAG_TEXTS.generic;
      const say = flag.reason === 'price_below_threshold' ? FLAG_TEXTS.priceBelow : FLAG_TEXTS.priceAbove;
      return say(formatMoney(price), formatMoney(threshold));
    }
    case 'low_confidence': {
      const confidence = numberOf(d, 'confidence');
      const threshold = numberOf(d, 'threshold');
      if (confidence == null || threshold == null) return FLAG_TEXTS.generic;
      return FLAG_TEXTS.lowConfidence(formatPercent(confidence), formatPercent(threshold));
    }
    case 'price_delta_anomaly': {
      const previous = numberOf(d, 'previousPrice');
      const current = numberOf(d, 'currentPrice');
      if (previous == null || current == null) return FLAG_TEXTS.generic;
      const ratio = numberOf(d, 'ratio');
      return FLAG_TEXTS.priceDelta(
        current > previous,
        formatMoney(previous),
        formatMoney(current),
        ratio == null ? null : formatTimes(ratio),
      );
    }
    default:
      return FLAG_TEXTS.generic;
  }
}

// ---------------------------------------------------------------------------
// The editor's fields. The server checks none of them: a name over 255
// characters, a section over 100, a price of 100 000 000 or more answer 500
// «Сбой на сервере» (backend partnerMenuItemService.updateMenuItem, columns
// varchar(255) / varchar(100) / numeric(10,2)). Lengths are counted as the
// database counts — by characters, not UTF-16 units.
// ---------------------------------------------------------------------------

export const NAME_MAX = 255;
export const SECTION_MAX = 100;
export const PRICE_MAX = 99_999_999.99;

const lengthOf = (text: string): number => [...text].length;

const PRICE_SHAPE = /^\d+(?:[.,]\d{1,2})?$/;

export type FieldCheck<T> = { ok: true; value: T } | { ok: false; error: string };

/** The name as it goes to the server: without edge spaces, required, at most 255. */
export function checkName(text: string): FieldCheck<string> {
  const name = text.trim();
  if (name === '') return { ok: false, error: MENU_TEXTS.nameRequired };
  if (lengthOf(name) > NAME_MAX) return { ok: false, error: MENU_TEXTS.nameTooLong };
  return { ok: true, value: name };
}

/** The price: empty — no price (null); a comma or a point; 0 … 99 999 999,99; two decimals at most. */
export function checkPrice(text: string): FieldCheck<number | null> {
  const raw = text.trim().replace(/\s+/g, '');
  if (raw === '') return { ok: true, value: null };
  if (!PRICE_SHAPE.test(raw)) return { ok: false, error: MENU_TEXTS.priceInvalid };
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > PRICE_MAX) {
    return { ok: false, error: MENU_TEXTS.priceInvalid };
  }
  return { ok: true, value };
}

/** The section: free text, without edge spaces, at most 100; empty — no section (''). */
export function checkSection(text: string): FieldCheck<string> {
  const section = text.trim();
  if (lengthOf(section) > SECTION_MAX) return { ok: false, error: MENU_TEXTS.sectionTooLong };
  return { ok: true, value: section };
}

/** What the editor sends: only the fields that changed. */
export type MenuItemChanges = {
  item_name?: string;
  price_byn?: number | null;
  category_raw?: string;
};

const sameMoney = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.round(a * 100) === Math.round(b * 100);

/**
 * The changes of an edit, from the fields as typed: the checks first, then
 * only what differs from the line as it is. A cleared section goes as '' —
 * what the app sends; the server reads '' and null alike (backend
 * utils/menuItemName.js dishKey: `text ?? ''`), so copies stay one line
 * either way.
 */
export function changesOf(
  item: Pick<PartnerMenuItem, 'item_name' | 'price_byn' | 'category_raw'>,
  input: { name: string; price: string; section: string },
): { ok: true; changes: MenuItemChanges } | { ok: false; errors: { name?: string; price?: string; section?: string } } {
  const name = checkName(input.name);
  const price = checkPrice(input.price);
  const section = checkSection(input.section);
  if (!name.ok || !price.ok || !section.ok) {
    return {
      ok: false,
      errors: {
        ...(name.ok ? {} : { name: name.error }),
        ...(price.ok ? {} : { price: price.error }),
        ...(section.ok ? {} : { section: section.error }),
      },
    };
  }
  const changes: MenuItemChanges = {};
  if (name.value !== item.item_name) changes.item_name = name.value;
  if (!sameMoney(price.value, item.price_byn)) changes.price_byn = price.value;
  if (section.value !== (item.category_raw ?? '')) changes.category_raw = section.value;
  return { ok: true, changes };
}

/** The price as the editor shows it to start with: «6,50», «14», '' without a price. */
export function priceInputOf(byn: number | null): string {
  return byn == null ? '' : formatMoney(byn);
}

/**
 * «Всё верно» (T8): the line as it is, sent back — the server clears the mark
 * of the line and its copies. The price when there is one, otherwise the name.
 */
export function confirmChangesOf(item: Pick<PartnerMenuItem, 'item_name' | 'price_byn'>): MenuItemChanges {
  return item.price_byn != null ? { price_byn: item.price_byn } : { item_name: item.item_name };
}
