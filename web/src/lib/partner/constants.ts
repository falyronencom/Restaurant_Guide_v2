/**
 * Partner cabinet — canonical write-side dictionaries (Phase C Slice 1, Segment B).
 *
 * Source of truth: backend/src/validators/establishmentValidation.js
 *   (VALID_CATEGORIES / VALID_CUISINES / VALID_CITIES / VALID_PRICE_RANGES,
 *    BELARUS_PHONE_REGEX). The wizard writes these Cyrillic names DIRECTLY
 *   (Decision 2, ratified) — no internal-id layer. Any drift here surfaces as a
 *   backend 422, so these strings must match the validator's isIn() sets exactly.
 */

// --- Classification -------------------------------------------------------

/** 15 categories — exact VALID_CATEGORIES order. */
export const CATEGORIES = [
  'Ресторан',
  'Кофейня',
  'Кафе',
  'Фаст-фуд',
  'Бар',
  'Кондитерская',
  'Пиццерия',
  'Пекарня',
  'Паб',
  'Столовая',
  'Кальянная',
  'Боулинг',
  'Караоке',
  'Бильярд',
  'Клуб',
] as const;
export const MAX_CATEGORIES = 2;

/** 12 cuisines — exact VALID_CUISINES order. */
export const CUISINES = [
  'Народная',
  'Авторская',
  'Азиатская',
  'Американская',
  'Вегетарианская',
  'Японская',
  'Грузинская',
  'Итальянская',
  'Смешанная',
  'Европейская',
  'Китайская',
  'Восточная',
] as const;
export const MAX_CUISINES = 3;

/** Validator accepts only these three (DB CHECK is looser — '$$$$' — but 422s here). */
export const PRICE_RANGES = ['$', '$$', '$$$'] as const;

// --- Address --------------------------------------------------------------

/**
 * Cities. The backend isIn() set accepts BOTH 'Могилёв' and 'Могилев', so the
 * picker shows the ё form (it validates either way — feedback_mogilev_yo). One
 * entry per distinct city.
 */
export const CITIES = [
  'Минск',
  'Гомель',
  'Могилёв',
  'Витебск',
  'Гродно',
  'Брест',
  'Бобруйск',
] as const;

/**
 * City-center coordinates (lat, lng) — derived from backend CITY_BOUNDS, ported
 * from mobile CityOptions._cityCoordinates. The lat/lng assist (Decision 5)
 * substituted until the partner geocodes or hand-edits. Keyed for both ё/е
 * Могилёв spellings so a value from either source resolves.
 */
export const CITY_CENTER: Record<string, { lat: number; lng: number }> = {
  Минск: { lat: 53.925, lng: 27.575 },
  Гродно: { lat: 53.665, lng: 23.85 },
  Брест: { lat: 52.09, lng: 23.7 },
  Гомель: { lat: 52.42, lng: 31.0 },
  Витебск: { lat: 55.19, lng: 30.2 },
  Могилёв: { lat: 53.91, lng: 30.35 },
  Могилев: { lat: 53.91, lng: 30.35 },
  Бобруйск: { lat: 53.15, lng: 29.25 },
};

/** Минск — ultimate fallback when a city has no center entry. */
export const DEFAULT_CITY_CENTER = { lat: 53.925, lng: 27.575 };

// --- Attributes -----------------------------------------------------------

/**
 * Attribute write canon (Decision 4, ratified): the 9 reader keys
 * (mobile detail ∩ web establishment-helpers ATTRIBUTE_ORDER) + accessible_environment.
 *
 * The wizard writes ONLY these keys, superseding the mobile WRITER's broken keys
 * (banquets/kids/pets — never read by any detail, the prod data defect from
 * Discovery Q7). Labels here are clean INPUT affordances; the public detail page
 * renders attributes through its own reader labels (incl. the preserved 'Терасса'
 * typo) — not these.
 *
 * `accessible_environment` is FORWARD-CANON: no reader renders it yet, so it will
 * not appear on public detail until the reader dictionaries gain the key (out of
 * this slice — AF1).
 */
export const ATTRIBUTES = [
  { key: 'delivery', label: 'Доставка еды' },
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'terrace', label: 'Летняя терраса' },
  { key: 'parking', label: 'Парковка' },
  { key: 'live_music', label: 'Живая музыка' },
  { key: 'kids_zone', label: 'Детская зона' },
  { key: 'banquet', label: 'Банкет' },
  { key: 'pets_allowed', label: 'Можно с животными' },
  { key: 'smoking', label: 'Зал для курящих' },
  { key: 'accessible_environment', label: 'Доступная среда' },
] as const;

export const ATTRIBUTE_KEYS: readonly string[] = ATTRIBUTES.map((a) => a.key);

// --- Working hours --------------------------------------------------------

/** Canonical per-day order (Q10). Monday-first (Russian week). */
export const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  monday: 'Понедельник',
  tuesday: 'Вторник',
  wednesday: 'Среда',
  thursday: 'Четверг',
  friday: 'Пятница',
  saturday: 'Суббота',
  sunday: 'Воскресенье',
};

// --- Contact / media limits ----------------------------------------------

/** Mirrors backend BELARUS_PHONE_REGEX (+375 then 29|33|44|25 then 7 digits). */
export const BELARUS_PHONE_RE = /^\+375(29|33|44|25)\d{7}$/;

/**
 * Per-bucket media caps — mirror of the unified server MEDIA_LIMITS exported from
 * backend mediaService (9fcf6c5: {interior: 30, menu: 30}). No shared package
 * between targets (Brief 2 D1 — manual cross-target sync, like tokens.ts); keep
 * these in sync with the backend constant. Client-side guard only — the server
 * enforces the real cap on create/PUT-sync.
 */
export const MEDIA_LIMITS = { interior: 30, menu: 30 } as const;
export const MAX_MENU_PDFS = 2;

// --- E1 procedural gate (sticky sidebar) ----------------------------------

/**
 * The web-side submit minimum (E1). STRICTER than the backend submit-gate, which
 * checks 7 content fields and treats media as a phantom TODO (Discovery Q2). E1
 * is the binding gate that enables Submit in the cabinet.
 */
export const E1_MIN_PHOTOS = 5;
export const E1_MIN_DESCRIPTION = 120;
