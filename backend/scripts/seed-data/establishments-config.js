/**
 * Establishment Configuration Templates for Seed Data
 *
 * This module defines structured templates for 75 establishments distributed
 * across 7 Belarus cities with comprehensive category and cuisine coverage.
 *
 * Distribution Strategy:
 * - Total: 75 establishments (target range 70-80)
 * - Geographic: Минск (35), other cities (~7 each)
 * - Categories: All 13 types with realistic distribution
 * - Cuisines: All 10 types with 1-3 per establishment
 * - Price range: ~30% '$', ~50% '$$', ~20% '$$$'
 * - Edge cases: 7 explicit scenarios for mobile UI testing
 */

/**
 * Valid category values (13 types)
 */
export const CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'fast_food',
  'pizzeria',
  'bakery',
  'pub',
  'canteen',
  'hookah_lounge',
  'bowling',
  'karaoke',
  'billiards',
  'nightclub',
];

/**
 * Valid cuisine values (10 types)
 */
export const CUISINES = [
  'belarusian',
  'european',
  'italian',
  'asian',
  'american',
  'georgian',
  'indian',
  'mediterranean',
  'vegetarian',
  'international',
];

/**
 * Valid price ranges
 */
export const PRICE_RANGES = ['$', '$$', '$$$'];

/**
 * Valid attribute values
 */
export const ATTRIBUTES = {
  wifi: 'WiFi',
  parking: 'Парковка',
  outdoor_seating: 'Летняя терраса',
  delivery: 'Доставка',
  takeaway: 'Еда навынос',
  live_music: 'Живая музыка',
  business_lunch: 'Бизнес-ланч',
  kids_menu: 'Детское меню',
  kids_area: 'Детская зона',
  pet_friendly: 'Можно с питомцами',
  vegan_options: 'Веганское меню',
  accepts_cards: 'Оплата картой',
  reservation: 'Бронирование столиков',
  smoking_area: 'Кальянная зона',
  banquet_hall: 'Банкетный зал',
  valet_parking: 'Valet парковка',
  wine_selection: 'Винная карта',
  terrace: 'Терраса',
};

/**
 * Working hours patterns by category
 *
 * Returns JSONB structure: { monday: "HH:MM-HH:MM", tuesday: ..., ... }
 */
export const WORKING_HOURS_PATTERNS = {
  restaurant: () => generateHours('12:00', '23:00', 0, 30),
  cafe: () => generateHours('07:00', '20:00', 0, 30),
  bar: () => generateHours('14:00', '03:00', 0, 60),
  pub: () => generateHours('14:00', '02:00', 0, 60),
  fast_food: () => generateHours('09:00', '22:00', 0, 30),
  pizzeria: () => generateHours('11:00', '23:00', 0, 30),
  bakery: () => generateHours('06:00', '20:00', 0, 30),
  canteen: () => generateHours('08:00', '18:00', 0, 30),
  hookah_lounge: () => generateHours('15:00', '02:00', 0, 60),
  bowling: () => generateHours('12:00', '00:00', 0, 60),
  karaoke: () => generateHours('15:00', '02:00', 0, 60),
  billiards: () => generateHours('14:00', '00:00', 0, 60),
  nightclub: () => generateHours('20:00', '06:00', 0, 60),
  always_open: () => ({
    monday: '00:00-23:59',
    tuesday: '00:00-23:59',
    wednesday: '00:00-23:59',
    thursday: '00:00-23:59',
    friday: '00:00-23:59',
    saturday: '00:00-23:59',
    sunday: '00:00-23:59',
  }),
};

/**
 * Generate working hours with random variation
 *
 * @param {string} baseOpen - Base opening time "HH:MM"
 * @param {string} baseClose - Base closing time "HH:MM"
 * @param {number} minVariation - Minimum variation in minutes
 * @param {number} maxVariation - Maximum variation in minutes
 * @returns {object} Working hours JSONB
 */
function generateHours(baseOpen, baseClose, minVariation, maxVariation) {
  const variation = Math.floor(Math.random() * (maxVariation - minVariation + 1)) + minVariation;
  const openTime = adjustTime(baseOpen, Math.random() < 0.5 ? -variation : variation);
  const closeTime = adjustTime(baseClose, Math.random() < 0.5 ? -variation : variation);

  // Weekdays same hours
  const weekdayHours = `${openTime}-${closeTime}`;

  // Weekend might have extended hours (50% chance)
  const hasExtendedWeekend = Math.random() < 0.5;
  const weekendHours = hasExtendedWeekend
    ? `${openTime}-${adjustTime(closeTime, 60)}`
    : weekdayHours;

  return {
    monday: weekdayHours,
    tuesday: weekdayHours,
    wednesday: weekdayHours,
    thursday: weekdayHours,
    friday: weekendHours,
    saturday: weekendHours,
    sunday: weekdayHours,
  };
}

/**
 * Adjust time by minutes
 */
function adjustTime(timeStr, minutesOffset) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  let totalMinutes = hours * 60 + minutes + minutesOffset;

  // Handle day overflow (for closing times after midnight)
  if (totalMinutes >= 24 * 60) totalMinutes = totalMinutes % (24 * 60);
  if (totalMinutes < 0) totalMinutes = 24 * 60 + totalMinutes;

  const newHours = Math.floor(totalMinutes / 60);
  const newMinutes = totalMinutes % 60;

  return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

/**
 * Random choice from array utility
 */
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Random multiple choices from array (1-3 items)
 */
function randomCuisines(count = null) {
  const shuffled = [...CUISINES].sort(() => Math.random() - 0.5);
  const numCuisines = count || Math.floor(Math.random() * 3) + 1; // 1-3
  return shuffled.slice(0, numCuisines);
}

/**
 * Random attributes selection
 */
function randomAttributes(count = 3) {
  const keys = Object.keys(ATTRIBUTES);
  const shuffled = keys.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  const result = {};
  selected.forEach((key) => {
    result[key] = true;
  });
  return result;
}

/**
 * Generate photo count configuration
 *
 * @param {string} photoCount - 'minimal', 'normal', 'rich', 'maximum'
 * @returns {object} {interiors: X, menus: Y}
 */
export function generatePhotoCount(photoCount = 'normal') {
  const configs = {
    minimal: { interiors: 1, menus: 1 }, // Edge Case 2
    normal: {
      interiors: Math.floor(Math.random() * 4) + 2, // 2-5
      menus: Math.floor(Math.random() * 3) + 1, // 1-3
    },
    rich: {
      interiors: Math.floor(Math.random() * 6) + 8, // 8-13
      menus: Math.floor(Math.random() * 5) + 5, // 5-9
    },
    maximum: { interiors: 20, menus: 20 }, // Edge Case 1
  };

  return configs[photoCount] || configs.normal;
}

/**
 * 75 Establishment Configuration Templates
 *
 * Each configuration includes:
 * - city: Target city
 * - categories: Array of 1-2 categories
 * - cuisines: Array of 1-3 cuisines
 * - price_range: $, $$, or $$$
 * - nameIndex: Index into ESTABLISHMENT_NAMES array (from content-templates.js)
 * - descriptionLength: 'short', 'medium', 'long'
 * - workingHoursPattern: Key from WORKING_HOURS_PATTERNS
 * - photoCount: 'minimal', 'normal', 'rich', 'maximum'
 * - attributes: Object with attribute flags
 * - status: 'active' or 'suspended'
 * - isEdgeCase: Optional edge case identifier
 */
export const ESTABLISHMENT_CONFIGS = [
  // ========================================
  // EDGE CASES (7 explicit)
  // ========================================

  // Edge Case 1: Maximum Photos (20 interior + 20 menu)
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['european', 'international'],
    price_range: '$$$',
    nameIndex: 42, // "Семейный ресторан европейской и азиатской кухни \"Вкусы мира\""
    descriptionLength: 'long',
    workingHoursPattern: 'restaurant',
    photoCount: 'maximum',
    attributes: { wifi: true, parking: true, accepts_cards: true, reservation: true },
    status: 'active',
    isEdgeCase: 'EDGE_CASE_1_MAXIMUM_PHOTOS',
  },

  // Edge Case 2: Minimum Content (1 interior, 1 menu, 50 words)
  {
    city: 'Гродно',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 37, // "Чай"
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'minimal',
    attributes: { wifi: true },
    status: 'active',
    isEdgeCase: 'EDGE_CASE_2_MINIMUM_CONTENT',
  },

  // Edge Case 3: Very Long Name (50+ characters)
  {
    city: 'Брест',
    categories: ['restaurant'],
    cuisines: ['belarusian', 'european'],
    price_range: '$$',
    nameIndex: 38, // "Ресторан традиционной белорусской кухни \"Бабушкины рецепты\""
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: { live_music: true, parking: true },
    status: 'active',
    isEdgeCase: 'EDGE_CASE_3_VERY_LONG_NAME',
  },

  // Edge Case 4: Very Long Description (300+ words)
  {
    city: 'Гомель',
    categories: ['restaurant', 'bar'],
    cuisines: ['italian', 'mediterranean'],
    price_range: '$$$',
    nameIndex: 28, // "Wine Gallery"
    descriptionLength: 'long',
    workingHoursPattern: 'restaurant',
    photoCount: 'rich',
    attributes: { wine_selection: true, reservation: true, valet_parking: true },
    status: 'active',
    isEdgeCase: 'EDGE_CASE_4_VERY_LONG_DESCRIPTION',
  },

  // Edge Case 5: Diverse Attributes (many simultaneous)
  {
    city: 'Витебск',
    categories: ['restaurant'],
    cuisines: ['european', 'international'],
    price_range: '$$',
    nameIndex: 19, // "Веранда"
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: {
      wifi: true,
      parking: true,
      outdoor_seating: true,
      kids_area: true,
      pet_friendly: true,
      terrace: true,
      live_music: true,
      accepts_cards: true,
      reservation: true,
    },
    status: 'active',
    isEdgeCase: 'EDGE_CASE_5_DIVERSE_ATTRIBUTES',
  },

  // Edge Case 6: Multiple Categories (2 categories - maximum allowed)
  {
    city: 'Могилев',
    categories: ['restaurant', 'karaoke'],
    cuisines: ['european', 'asian'],
    price_range: '$$',
    nameIndex: 20, // "Крыша"
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: { karaoke: true, banquet_hall: true, parking: true },
    status: 'active',
    isEdgeCase: 'EDGE_CASE_6_MULTIPLE_CATEGORIES',
  },

  // Edge Case 7: Temporarily Closed (status: 'suspended')
  // Semantic mapping: 'suspended' represents temporarily closed state
  {
    city: 'Бобруйск',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 11, // "Coffee Room"
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: { wifi: true, takeaway: true },
    status: 'suspended', // Temporarily closed - see semantic mapping comment
    isEdgeCase: 'EDGE_CASE_7_TEMPORARILY_CLOSED',
  },

  // ========================================
  // МИНСК - 35 establishments (including Edge Case 1)
  // ========================================

  // Restaurants (12)
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['belarusian', 'european'],
    price_range: '$$',
    nameIndex: 0,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['italian'],
    price_range: '$$$',
    nameIndex: 25,
    descriptionLength: 'long',
    workingHoursPattern: 'restaurant',
    photoCount: 'rich',
    attributes: randomAttributes(5),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['georgian'],
    price_range: '$$',
    nameIndex: 30,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['asian'],
    price_range: '$$$',
    nameIndex: 31,
    descriptionLength: 'long',
    workingHoursPattern: 'restaurant',
    photoCount: 'rich',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['vegetarian', 'european'],
    price_range: '$$',
    nameIndex: 32,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['belarusian'],
    price_range: '$$',
    nameIndex: 3,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['american'],
    price_range: '$$$',
    nameIndex: 33,
    descriptionLength: 'long',
    workingHoursPattern: 'restaurant',
    photoCount: 'rich',
    attributes: randomAttributes(5),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['indian', 'asian'],
    price_range: '$$',
    nameIndex: 34,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['european', 'international'],
    price_range: '$$$',
    nameIndex: 8,
    descriptionLength: 'long',
    workingHoursPattern: 'restaurant',
    photoCount: 'rich',
    attributes: randomAttributes(6),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['mediterranean'],
    price_range: '$$',
    nameIndex: 26,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['asian'],
    price_range: '$$',
    nameIndex: 27,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },

  // Cafes (6)
  {
    city: 'Минск',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 12,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$$',
    nameIndex: 24,
    descriptionLength: 'medium',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['cafe'],
    cuisines: ['international'],
    price_range: '$',
    nameIndex: 22,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$$',
    nameIndex: 13,
    descriptionLength: 'medium',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['cafe'],
    cuisines: ['international'],
    price_range: '$',
    nameIndex: 35,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 36,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },

  // Bars & Pubs (5)
  {
    city: 'Минск',
    categories: ['bar'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 2,
    descriptionLength: 'medium',
    workingHoursPattern: 'bar',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['pub'],
    cuisines: ['american'],
    price_range: '$$',
    nameIndex: 6,
    descriptionLength: 'medium',
    workingHoursPattern: 'pub',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['bar'],
    cuisines: ['european'],
    price_range: '$$$',
    nameIndex: 29,
    descriptionLength: 'medium',
    workingHoursPattern: 'bar',
    photoCount: 'rich',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['pub'],
    cuisines: ['american', 'european'],
    price_range: '$$',
    nameIndex: 21,
    descriptionLength: 'medium',
    workingHoursPattern: 'pub',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['bar'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 15,
    descriptionLength: 'short',
    workingHoursPattern: 'bar',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },

  // Fast Food & Pizzeria (4)
  {
    city: 'Минск',
    categories: ['fast_food'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 16,
    descriptionLength: 'short',
    workingHoursPattern: 'fast_food',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['pizzeria'],
    cuisines: ['italian'],
    price_range: '$$',
    nameIndex: 17,
    descriptionLength: 'medium',
    workingHoursPattern: 'pizzeria',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['fast_food'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 23,
    descriptionLength: 'short',
    workingHoursPattern: 'fast_food',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['pizzeria'],
    cuisines: ['italian'],
    price_range: '$$',
    nameIndex: 43,
    descriptionLength: 'medium',
    workingHoursPattern: 'pizzeria',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },

  // Bakery & Canteen (3)
  {
    city: 'Минск',
    categories: ['bakery'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 4,
    descriptionLength: 'short',
    workingHoursPattern: 'bakery',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['canteen'],
    cuisines: ['belarusian', 'european'],
    price_range: '$',
    nameIndex: 18,
    descriptionLength: 'short',
    workingHoursPattern: 'canteen',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['bakery'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 5,
    descriptionLength: 'short',
    workingHoursPattern: 'bakery',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },

  // Entertainment (5)
  {
    city: 'Минск',
    categories: ['bowling'],
    cuisines: ['american'],
    price_range: '$$',
    nameIndex: 40,
    descriptionLength: 'medium',
    workingHoursPattern: 'bowling',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['karaoke'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 41,
    descriptionLength: 'medium',
    workingHoursPattern: 'karaoke',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['hookah_lounge'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 44,
    descriptionLength: 'medium',
    workingHoursPattern: 'hookah_lounge',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['billiards'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 45,
    descriptionLength: 'short',
    workingHoursPattern: 'billiards',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Минск',
    categories: ['nightclub'],
    cuisines: ['international'],
    price_range: '$$$',
    nameIndex: 14,
    descriptionLength: 'medium',
    workingHoursPattern: 'nightclub',
    photoCount: 'rich',
    attributes: randomAttributes(4),
    status: 'active',
  },

  // ========================================
  // ГРОДНО - 7 establishments (including Edge Case 2)
  // ========================================

  {
    city: 'Гродно',
    categories: ['restaurant'],
    cuisines: ['belarusian'],
    price_range: '$$',
    nameIndex: 1,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Гродно',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 7,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Гродно',
    categories: ['pizzeria'],
    cuisines: ['italian'],
    price_range: '$$',
    nameIndex: 46,
    descriptionLength: 'medium',
    workingHoursPattern: 'pizzeria',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Гродно',
    categories: ['bar'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 47,
    descriptionLength: 'medium',
    workingHoursPattern: 'bar',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Гродно',
    categories: ['fast_food'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 48,
    descriptionLength: 'short',
    workingHoursPattern: 'fast_food',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Гродно',
    categories: ['bakery'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 49,
    descriptionLength: 'short',
    workingHoursPattern: 'bakery',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },

  // ========================================
  // БРЕСТ - 7 establishments (including Edge Case 3)
  // ========================================

  {
    city: 'Брест',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 50,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Брест',
    categories: ['restaurant'],
    cuisines: ['italian'],
    price_range: '$$$',
    nameIndex: 51,
    descriptionLength: 'long',
    workingHoursPattern: 'restaurant',
    photoCount: 'rich',
    attributes: randomAttributes(5),
    status: 'active',
  },
  {
    city: 'Брест',
    categories: ['pub'],
    cuisines: ['american'],
    price_range: '$$',
    nameIndex: 52,
    descriptionLength: 'medium',
    workingHoursPattern: 'pub',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Брест',
    categories: ['pizzeria'],
    cuisines: ['italian'],
    price_range: '$$',
    nameIndex: 53,
    descriptionLength: 'medium',
    workingHoursPattern: 'pizzeria',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Брест',
    categories: ['canteen'],
    cuisines: ['belarusian'],
    price_range: '$',
    nameIndex: 54,
    descriptionLength: 'short',
    workingHoursPattern: 'canteen',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Брест',
    categories: ['karaoke'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 55,
    descriptionLength: 'medium',
    workingHoursPattern: 'karaoke',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },

  // ========================================
  // ГОМЕЛЬ - 7 establishments (including Edge Case 4)
  // ========================================

  {
    city: 'Гомель',
    categories: ['restaurant'],
    cuisines: ['georgian'],
    price_range: '$$',
    nameIndex: 56,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Гомель',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 57,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Гомель',
    categories: ['fast_food'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 58,
    descriptionLength: 'short',
    workingHoursPattern: 'fast_food',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Гомель',
    categories: ['bar'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 59,
    descriptionLength: 'medium',
    workingHoursPattern: 'bar',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Гомель',
    categories: ['bakery'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 60,
    descriptionLength: 'short',
    workingHoursPattern: 'bakery',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Гомель',
    categories: ['bowling'],
    cuisines: ['american'],
    price_range: '$$',
    nameIndex: 61,
    descriptionLength: 'medium',
    workingHoursPattern: 'bowling',
    photoCount: 'normal',
    attributes: randomAttributes(4),
    status: 'active',
  },

  // ========================================
  // ВИТЕБСК - 7 establishments (including Edge Case 5)
  // ========================================

  {
    city: 'Витебск',
    categories: ['restaurant'],
    cuisines: ['asian'],
    price_range: '$$',
    nameIndex: 62,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Витебск',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 63,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Витебск',
    categories: ['pizzeria'],
    cuisines: ['italian'],
    price_range: '$$',
    nameIndex: 64,
    descriptionLength: 'medium',
    workingHoursPattern: 'pizzeria',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Витебск',
    categories: ['pub'],
    cuisines: ['american'],
    price_range: '$$',
    nameIndex: 65,
    descriptionLength: 'medium',
    workingHoursPattern: 'pub',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Витебск',
    categories: ['canteen'],
    cuisines: ['belarusian'],
    price_range: '$',
    nameIndex: 66,
    descriptionLength: 'short',
    workingHoursPattern: 'canteen',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Витебск',
    categories: ['hookah_lounge'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 67,
    descriptionLength: 'medium',
    workingHoursPattern: 'hookah_lounge',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },

  // ========================================
  // МОГИЛЕВ - 7 establishments (including Edge Case 6)
  // ========================================

  {
    city: 'Могилев',
    categories: ['restaurant'],
    cuisines: ['indian'],
    price_range: '$$',
    nameIndex: 68,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Могилев',
    categories: ['cafe'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 69,
    descriptionLength: 'short',
    workingHoursPattern: 'cafe',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Могилев',
    categories: ['bar'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 70,
    descriptionLength: 'medium',
    workingHoursPattern: 'bar',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Могилев',
    categories: ['fast_food'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 71,
    descriptionLength: 'short',
    workingHoursPattern: 'fast_food',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Могилев',
    categories: ['bakery'],
    cuisines: ['european'],
    price_range: '$',
    nameIndex: 72,
    descriptionLength: 'short',
    workingHoursPattern: 'bakery',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Могилев',
    categories: ['billiards'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 73,
    descriptionLength: 'short',
    workingHoursPattern: 'billiards',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },

  // ========================================
  // БОБРУЙСК - 7 establishments (including Edge Case 7)
  // ========================================

  {
    city: 'Бобруйск',
    categories: ['restaurant'],
    cuisines: ['belarusian'],
    price_range: '$$',
    nameIndex: 74,
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Бобруйск',
    categories: ['pizzeria'],
    cuisines: ['italian'],
    price_range: '$$',
    nameIndex: 9,
    descriptionLength: 'medium',
    workingHoursPattern: 'pizzeria',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Бобруйск',
    categories: ['bar'],
    cuisines: ['international'],
    price_range: '$$',
    nameIndex: 10,
    descriptionLength: 'medium',
    workingHoursPattern: 'bar',
    photoCount: 'normal',
    attributes: randomAttributes(3),
    status: 'active',
  },
  {
    city: 'Бобруйск',
    categories: ['fast_food'],
    cuisines: ['american'],
    price_range: '$',
    nameIndex: 39,
    descriptionLength: 'short',
    workingHoursPattern: 'fast_food',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Бобруйск',
    categories: ['canteen'],
    cuisines: ['belarusian'],
    price_range: '$',
    nameIndex: 44,
    descriptionLength: 'short',
    workingHoursPattern: 'canteen',
    photoCount: 'normal',
    attributes: randomAttributes(2),
    status: 'active',
  },
  {
    city: 'Бобруйск',
    categories: ['nightclub'],
    cuisines: ['international'],
    price_range: '$$$',
    nameIndex: 45,
    descriptionLength: 'medium',
    workingHoursPattern: 'nightclub',
    photoCount: 'rich',
    attributes: randomAttributes(4),
    status: 'active',
  },
];
