/**
 * Establishment detail-page shared helpers (Brief 4).
 *
 * Pure functions used across multiple `components/establishment/*` files.
 * No DOM, no I/O — safe in both Server and Client components.
 */

/**
 * Format rating as Russian-locale string with comma decimal separator.
 * Mirrors mobile and Brief 3 EstablishmentCard: `4.8 → '4,8'`.
 * Returns '—' when rating is null/undefined.
 */
export function formatRating(rating: number | null | undefined): string {
  if (rating == null) return '—';
  return rating.toFixed(1).replace('.', ',');
}

/**
 * Rating badge background class — two-tier per the design: green
 * (success-status, #34C759) at/above 4.5, the milder figma-rating-mid
 * (#8BC34A) below. Shared by the catalog card, the detail title, the reviews
 * header and the contact sidebar.
 */
export function ratingColorClass(rating: number): string {
  return rating >= 4.5 ? 'bg-success-status' : 'bg-figma-rating-mid';
}

/**
 * Booking-style verbal rating label by score.
 * Score range 1-5 (Russian rating convention, not Booking's 1-10).
 * Mapping inspired by Booking «Превосходно/Очень хорошо/Хорошо/Средне».
 */
export function ratingLabel(rating: number | null | undefined): string | null {
  if (rating == null) return null;
  if (rating >= 4.5) return 'Превосходно';
  if (rating >= 4.0) return 'Очень хорошо';
  if (rating >= 3.5) return 'Хорошо';
  if (rating >= 3.0) return 'Средне';
  return 'Слабо';
}

/**
 * Map attribute boolean key → display label.
 * Mirrors mobile `_buildAttributesSection` labels exactly (note: mobile has
 * 'Терасса' typo; preserved for cross-platform consistency).
 */
export const ATTRIBUTE_LABELS: Record<string, string> = {
  delivery: 'Доставка еды',
  wifi: 'Wi-Fi',
  terrace: 'Терасса',
  parking: 'Парковка',
  live_music: 'Живая музыка',
  kids_zone: 'Детская зона',
  banquet: 'Банкет',
  pets_allowed: 'Животные',
  smoking: 'Курение',
};

/** Stable order matching mobile rendering. */
export const ATTRIBUTE_ORDER: ReadonlyArray<string> = [
  'delivery',
  'wifi',
  'terrace',
  'parking',
  'live_music',
  'kids_zone',
  'banquet',
  'pets_allowed',
  'smoking',
];

/**
 * Extract truthy attribute keys from the raw JSONB attributes object.
 * Returns them in the canonical ATTRIBUTE_ORDER (consistency across renders).
 */
export function extractActiveAttributes(
  attributes: unknown,
): ReadonlyArray<string> {
  if (attributes == null || typeof attributes !== 'object') return [];
  const obj = attributes as Record<string, unknown>;
  return ATTRIBUTE_ORDER.filter((key) => obj[key] === true);
}

/**
 * Build a Yandex Maps routing deep-link ("Как добраться") to the given point —
 * destination only, with an empty origin so Yandex fills the user's start
 * (geolocation / manual entry).
 *
 * NOTE the coordinate order: `rtext` is the one Yandex param that takes
 * latitude FIRST (`lat,lon`), unlike `pt`/`ll` which are longitude-first.
 * Route points are `~`-separated; a leading `~` means "no start point set".
 * `rtt=auto` selects the driving route. yandex.by — the Belarus ccTLD, matching
 * the local audience.
 */
export function yandexRouteUrl(latitude: number, longitude: number): string {
  return `https://yandex.by/maps/?rtext=~${latitude},${longitude}&rtt=auto`;
}

/**
 * Build a Yandex Static API image URL centered on the given coordinates, or
 * null when no API key is configured — so MapPreview falls back to its
 * placeholder (local dev without the key, or a deploy missing the env var).
 *
 * `ll` is longitude,latitude (Yandex convention, longitude first). No `pt`
 * placemark: MapPreview overlays its own brand pin on the centered point. `size` is within the API max (650×450); we request a wide
 * frame and let the card crop via object-cover. Built as a raw string (not
 * URLSearchParams) so the commas in `ll`/`size` stay unescaped, matching the
 * format in Yandex's own examples.
 *
 * The key rides in the image URL, so it reaches the browser — expected for the
 * Static API, and mitigated by the HTTP-Referer domain lock set on the key in
 * the Yandex developer cabinet (see YANDEX_MAPS_API_KEY in .env.example). That
 * lock is also why the <img> must load client-side (browser sends the page
 * Referer); do NOT route it through next/image, which fetches server-side and
 * would fail the Referer check.
 */
export function yandexStaticMapUrl(
  latitude: number,
  longitude: number,
  apiKey: string | undefined,
): string | null {
  if (!apiKey) return null;
  return (
    'https://static-maps.yandex.ru/v1' +
    `?ll=${longitude},${latitude}` +
    '&z=16' +
    '&size=650,360' +
    '&lang=ru_RU' +
    `&apikey=${apiKey}`
  );
}

/**
 * Parse social/website URL → (display label, icon hint).
 * Port from mobile `_parseSocialLink`. Returns icon NAME (string) so the
 * caller can map it to a lucide component — keeps this helper UI-framework-
 * agnostic.
 */
export function parseSocialLink(url: string): { label: string; kind: SocialKind } {
  const lower = url.toLowerCase();
  if (lower.includes('instagram')) return { label: 'Instagram', kind: 'instagram' };
  if (lower.includes('facebook.com') || lower.includes('fb.com')) {
    return { label: 'Facebook', kind: 'facebook' };
  }
  if (lower.includes('t.me') || lower.includes('telegram')) {
    return { label: 'Telegram', kind: 'telegram' };
  }
  if (lower.includes('vk.com') || lower.includes('vkontakte')) {
    return { label: 'VK', kind: 'vk' };
  }
  return { label: 'Сайт', kind: 'website' };
}

export type SocialKind = 'instagram' | 'facebook' | 'telegram' | 'vk' | 'website';

/**
 * Ensure a URL has a scheme. Backend stores website strings users typed —
 * may lack protocol. Port from mobile `_launchSocialUrl` first-line fix.
 */
export function ensureUrlScheme(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

/**
 * Format an ISO date string as Russian short date — mirrors mobile
 * `_formatDate` in detail_screen.dart (e.g. '12 мая').
 */
const MONTH_NAMES_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

export function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTH_NAMES_RU[d.getMonth()]}`;
}

/**
 * Russian noun pluralisation for review count: 1 отзыв, 2-4 отзыва, 5+ отзывов.
 * Handles 11-14 special case (uses genitive plural).
 */
export function pluralizeReviews(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} отзывов`;
  if (mod10 === 1) return `${count} отзыв`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} отзыва`;
  return `${count} отзывов`;
}

/**
 * Normalize raw working_hours JSONB into a per-day map of structured records.
 *
 * Backend stores working_hours in two possible per-day shapes:
 *   - String: '10:00-22:00'
 *   - Object: { is_open: true, open: '10:00', close: '22:00' }
 *   - Object closed: { is_open: false }
 *
 * Returns null when the input is malformed (defensive — caller renders
 * a 'график не указан' fallback). Mirrors `Establishment.parseDayHours`
 * from mobile/lib/models/establishment.dart:214.
 */
export type ParsedDayHours = {
  is_open: boolean;
  open?: string;
  close?: string;
};

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

export function normalizeWorkingHours(
  raw: unknown,
): Record<string, ParsedDayHours | null> | null {
  if (raw == null || typeof raw !== 'object') return null;
  const wh = raw as Record<string, unknown>;
  const result: Record<string, ParsedDayHours | null> = {};
  let anyParsed = false;
  for (const dayKey of DAY_KEYS) {
    const value = wh[dayKey];
    const parsed = parseDay(value);
    result[dayKey] = parsed;
    if (parsed != null) anyParsed = true;
  }
  return anyParsed ? result : null;
}

function parseDay(value: unknown): ParsedDayHours | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const parts = value.split('-');
    if (parts.length === 2) {
      return { is_open: true, open: parts[0].trim(), close: parts[1].trim() };
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.is_open === false) return { is_open: false };
    const open = typeof obj.open === 'string' ? obj.open : undefined;
    const close = typeof obj.close === 'string' ? obj.close : undefined;
    if (open && close) return { is_open: true, open, close };
  }
  return null;
}
