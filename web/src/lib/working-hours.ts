/**
 * Working Hours — pure utilities, the same rule as
 * mobile/lib/models/establishment.dart (parseDayHours / openStatusAt).
 *
 * Safe in both server and client environments — no I/O, no React, no
 * browser/server-only APIs. Status badge (client island) imports
 * `computeOpenStatus`; the info card, the schema markup and the cabinet form read
 * the same parser.
 *
 * Dual-format support (matches backend JSONB shape):
 *   string  "10:00-22:00"               → { open: '10:00', close: '22:00', isOpen: true }
 *   object  { open, close }             → same
 *   object  { is_open: false }          → closed marker
 *   object  { is_open: true, open, close } → same as { open, close }
 *
 * Whatever else arrives must not reach a guest: empty strings (the cabinet used
 * to send { is_open: true, open: '', close: '' }), «25:99», «abc», a number.
 * A status for such a day is `unknown`, not «Открыто» (Coordinator, 06.11.2026).
 *
 * A shift of day D runs from its opening to its closing; a close at or before the
 * open is on the next day (18:00–02:00; 12:00–12:00 and 00:00–00:00 are a full 24
 * hours from the opening). So the night belongs to yesterday's shift: yesterday's
 * tail is looked at first, then today's record.
 */

export type WorkingHoursMap = Record<string, unknown>;

export type DayHours = {
  open: string | null;
  close: string | null;
  isOpen: boolean;
};

export type OpenState = 'open' | 'closed' | 'unknown';

export type OpenStatus = {
  state: OpenState;
  /** The close of the shift under way; null unless the place is open. */
  closingTime: string | null;
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

const CLOCK_TIME = /^(\d{1,2}):(\d{2})(?::[0-5]\d)?$/;

/** Minutes since midnight of an «HH:MM» time; null for anything that is not one. */
export function clockMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = CLOCK_TIME.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The time in its one form, «09:05»; null when it is not a time. */
function cleanTime(value: unknown): string | null {
  const total = clockMinutes(value);
  if (total == null) return null;
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const minutes = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Parse a single day's working_hours entry into a normalized shape.
 * Returns null when the entry is missing or nothing in it reads as hours. An
 * object marked open keeps being an open day, with null for a time it lacks: the
 * partner has to see that day as unfinished, not as a day off.
 */
export function parseDayHours(entry: unknown): DayHours | null {
  if (typeof entry === 'string') {
    const parts = entry.split('-');
    if (parts.length !== 2) return null;
    const open = cleanTime(parts[0]);
    const close = cleanTime(parts[1]);
    return open && close ? { open, close, isOpen: true } : null;
  }

  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
    const obj = entry as Record<string, unknown>;
    if (obj.is_open === false) {
      return { open: null, close: null, isOpen: false };
    }
    return { open: cleanTime(obj.open), close: cleanTime(obj.close), isOpen: true };
  }

  return null;
}

/**
 * Compute open/closed/unknown status from working_hours and current time.
 *
 * @param workingHours - raw JSONB from listing projection (dual format per day)
 * @param status - establishment.status; decides only when the hours are unknown:
 *                 a published card reads unknown, one off the catalog closed
 * @param now - current time (default: new Date()); read with local getters
 * @returns { state, closingTime } — closingTime only when state is 'open'.
 */
export function computeOpenStatus(
  workingHours: unknown,
  status: string,
  now: Date = new Date(),
): OpenStatus {
  const hours =
    typeof workingHours === 'object' && workingHours !== null
      ? (workingHours as WorkingHoursMap)
      : null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // JS getDay() is Sun=0…Sat=6, DAY_KEYS is Mon…Sun.
  const todayIdx = (now.getDay() + 6) % 7;

  // Yesterday's tail first. No data for yesterday: today's record decides —
  // «Часы не указаны» at night for a place with today's hours would be odd.
  const yesterday = parseDayHours(hours?.[DAY_KEYS[(todayIdx + 6) % 7]]);
  const yesterdayOpen = clockMinutes(yesterday?.open);
  const yesterdayClose = clockMinutes(yesterday?.close);
  if (
    yesterdayOpen != null &&
    yesterdayClose != null &&
    yesterdayClose <= yesterdayOpen &&
    nowMin < yesterdayClose
  ) {
    return { state: 'open', closingTime: yesterday?.close ?? null };
  }

  const today = parseDayHours(hours?.[DAY_KEYS[todayIdx]]);
  if (today && !today.isOpen) return { state: 'closed', closingTime: null };

  const openMin = clockMinutes(today?.open);
  const closeMin = clockMinutes(today?.close);
  if (openMin == null || closeMin == null) {
    return {
      state: status === 'active' ? 'unknown' : 'closed',
      closingTime: null,
    };
  }

  const inShift =
    closeMin <= openMin
      ? nowMin >= openMin
      : nowMin >= openMin && nowMin < closeMin;

  return inShift
    ? { state: 'open', closingTime: today?.close ?? null }
    : { state: 'closed', closingTime: null };
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
