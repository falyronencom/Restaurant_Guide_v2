/**
 * Working Hours — pure utilities ported from
 * mobile/lib/models/establishment.dart (parseDayHours / isCurrentlyOpen /
 * todayClosingTime).
 *
 * Safe in both server and client environments — no I/O, no React, no
 * browser/server-only APIs. Status badge (client island) imports
 * `computeOpenStatus`; server-side rendering of static hours (future use)
 * can import the same parser.
 *
 * Dual-format support (matches backend JSONB shape):
 *   string  "10:00-22:00"               → { open: '10:00', close: '22:00', isOpen: true }
 *   object  { open, close }             → same
 *   object  { is_open: false }          → closed marker
 *   object  { is_open: true, open, close } → same as { open, close }
 *
 * Overnight handling (close ≤ open): treats as wrap-around — open at 18:00,
 * close at 02:00 → "open" between 18:00 and 23:59 OR 00:00 and 01:59.
 */

export type WorkingHoursMap = Record<string, unknown>;

export type DayHours = {
  open: string | null;
  close: string | null;
  isOpen: boolean;
};

export type OpenStatus = {
  isOpen: boolean;
  closingTime: string | null;
  source: 'workingHours' | 'statusFallback';
};

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/**
 * Parse a single day's working_hours entry into a normalized shape.
 * Returns null when the entry is missing or malformed.
 */
export function parseDayHours(entry: unknown): DayHours | null {
  if (entry == null) return null;

  if (typeof entry === 'string') {
    const parts = entry.split('-');
    if (parts.length !== 2) return null;
    const open = parts[0].trim();
    const close = parts[1].trim();
    if (!open || !close) return null;
    return { open, close, isOpen: true };
  }

  if (typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    if (obj.is_open === false) {
      return { open: null, close: null, isOpen: false };
    }
    const open = typeof obj.open === 'string' ? obj.open : null;
    const close = typeof obj.close === 'string' ? obj.close : null;
    return { open, close, isOpen: true };
  }

  return null;
}

/**
 * Get parsed hours for the day matching `now`. JS `getDay()` returns Sun=0,
 * Mon=1, ..., Sat=6; `DAY_KEYS` is ordered Mon..Sun (index 0..6). Convert
 * Sunday to index 6 explicitly; other days shift down by 1.
 */
function getDayHours(
  workingHours: WorkingHoursMap | null,
  now: Date,
): DayHours | null {
  if (!workingHours) return null;
  const jsDay = now.getDay();
  const dayKeysIndex = jsDay === 0 ? 6 : jsDay - 1;
  const key = DAY_KEYS[dayKeysIndex];
  return parseDayHours(workingHours[key]);
}

function timeToMinutes(time: string): number | null {
  const parts = time.split(':');
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Compute open/closed status from working_hours and current time.
 *
 * @param workingHours - raw JSONB from listing projection (dual format per day)
 * @param status - establishment.status (used as fallback when hours missing)
 * @param now - current time (default: new Date())
 * @returns { isOpen, closingTime, source } — closingTime is the "close" string
 *          when isOpen=true and hours are known; null otherwise.
 */
export function computeOpenStatus(
  workingHours: unknown,
  status: string,
  now: Date = new Date(),
): OpenStatus {
  const hoursMap =
    typeof workingHours === 'object' && workingHours !== null
      ? (workingHours as WorkingHoursMap)
      : null;

  const today = getDayHours(hoursMap, now);

  // No working_hours data — fall back to status field
  if (!today) {
    return {
      isOpen: status === 'active',
      closingTime: null,
      source: 'statusFallback',
    };
  }

  if (!today.isOpen) {
    return { isOpen: false, closingTime: null, source: 'workingHours' };
  }

  if (!today.open || !today.close) {
    // Marked open but missing strings → status fallback. Drop closingTime
    // so the badge doesn't show "/ до null" or pair the fallback's open
    // verdict with a partial close time (review MEDIUM).
    return {
      isOpen: status === 'active',
      closingTime: null,
      source: 'statusFallback',
    };
  }

  const openMin = timeToMinutes(today.open);
  const closeMin = timeToMinutes(today.close);
  if (openMin == null || closeMin == null) {
    return {
      isOpen: status === 'active',
      closingTime: null,
      source: 'statusFallback',
    };
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();

  let isOpen: boolean;
  if (closeMin <= openMin) {
    // Overnight: open through midnight
    isOpen = nowMin >= openMin || nowMin < closeMin;
  } else {
    isOpen = nowMin >= openMin && nowMin < closeMin;
  }

  return {
    isOpen,
    closingTime: today.close,
    source: 'workingHours',
  };
}

/**
 * Legacy English→Russian translation maps mirrored from
 * mobile/lib/models/establishment.dart (lines 4-41). Production seed data
 * contains English category/cuisine values that predate the canonical
 * Cyrillic vocabulary; backend projection cannot derive a slug for these
 * (returns null in city_slug / category_slug). Web normalizes display
 * locally; canonical URL falls back to page params.
 *
 * Source of truth: mobile establishment.dart. Keep both in sync if entries
 * are added on either side.
 */
const CATEGORY_LEGACY_TO_RU: Record<string, string> = {
  restaurant: 'Ресторан',
  cafe: 'Кофейня',
  cafe_dining: 'Кафе',
  fast_food: 'Фаст-фуд',
  pizzeria: 'Пиццерия',
  bar: 'Бар',
  pub: 'Паб',
  bakery: 'Пекарня',
  confectionery: 'Кондитерская',
  karaoke: 'Караоке',
  canteen: 'Столовая',
  hookah_bar: 'Кальянная',
  hookah_lounge: 'Кальянная',
  bowling: 'Боулинг',
  billiards: 'Бильярд',
  nightclub: 'Клуб',
};

const CUISINE_LEGACY_TO_RU: Record<string, string> = {
  belarusian: 'Народная',
  national: 'Народная',
  author: 'Авторская',
  fusion: 'Авторская',
  asian: 'Азиатская',
  american: 'Американская',
  vegetarian: 'Вегетарианская',
  japanese: 'Японская',
  georgian: 'Грузинская',
  italian: 'Итальянская',
  mixed: 'Смешанная',
  international: 'Смешанная',
  continental: 'Европейская',
  european: 'Европейская',
  chinese: 'Китайская',
  eastern: 'Восточная',
};

/**
 * Normalize a category value to its Russian display form. If the input is
 * already Russian (or any unknown string), returns it as-is.
 */
export function normalizeCategory(raw: string): string {
  return CATEGORY_LEGACY_TO_RU[raw.toLowerCase()] ?? raw;
}

export function normalizeCuisine(raw: string): string {
  return CUISINE_LEGACY_TO_RU[raw.toLowerCase()] ?? raw;
}
