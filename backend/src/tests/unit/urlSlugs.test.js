/* eslint-env jest */
/**
 * Unit tests for URL slug ↔ Cyrillic mappings.
 *
 * Focus: bidirectional correctness, Mogilev ё/е edge case, unknown input
 * handling, type safety. Pure function tests — no I/O, no mocks.
 */

import {
  CITY_SLUG_MAP,
  CATEGORY_SLUG_MAP,
  CUISINE_SLUG_MAP,
  citySlugToCyrillic,
  cityCyrillicToSlug,
  categorySlugToCyrillic,
  categoryCyrillicToSlug,
  cuisineSlugToCyrillic,
  cuisineCyrillicToSlug,
  expandCityForQuery,
} from '../../constants/urlSlugs.js';

describe('urlSlugs — City mappings', () => {
  test('CITY_SLUG_MAP includes all 7 cities + both Mogilev variants', () => {
    expect(Object.keys(CITY_SLUG_MAP)).toHaveLength(8);
    expect(CITY_SLUG_MAP['Минск']).toBe('minsk');
    expect(CITY_SLUG_MAP['Гродно']).toBe('grodno');
    expect(CITY_SLUG_MAP['Брест']).toBe('brest');
    expect(CITY_SLUG_MAP['Гомель']).toBe('gomel');
    expect(CITY_SLUG_MAP['Витебск']).toBe('vitebsk');
    expect(CITY_SLUG_MAP['Могилев']).toBe('mogilev');
    expect(CITY_SLUG_MAP['Могилёв']).toBe('mogilev');
    expect(CITY_SLUG_MAP['Бобруйск']).toBe('bobruisk');
  });

  test('citySlugToCyrillic returns canonical Cyrillic for known slugs', () => {
    expect(citySlugToCyrillic('minsk')).toBe('Минск');
    expect(citySlugToCyrillic('grodno')).toBe('Гродно');
    expect(citySlugToCyrillic('brest')).toBe('Брест');
    expect(citySlugToCyrillic('gomel')).toBe('Гомель');
    expect(citySlugToCyrillic('vitebsk')).toBe('Витебск');
    expect(citySlugToCyrillic('bobruisk')).toBe('Бобруйск');
  });

  test('citySlugToCyrillic — Mogilev canonical without ё', () => {
    expect(citySlugToCyrillic('mogilev')).toBe('Могилев');
  });

  test('citySlugToCyrillic is case-insensitive', () => {
    expect(citySlugToCyrillic('MINSK')).toBe('Минск');
    expect(citySlugToCyrillic('Minsk')).toBe('Минск');
  });

  test('citySlugToCyrillic returns null for unknown slug', () => {
    expect(citySlugToCyrillic('moscow')).toBeNull();
    expect(citySlugToCyrillic('unknown-city')).toBeNull();
    expect(citySlugToCyrillic('')).toBeNull();
  });

  test('citySlugToCyrillic returns null for non-string input', () => {
    expect(citySlugToCyrillic(null)).toBeNull();
    expect(citySlugToCyrillic(undefined)).toBeNull();
    expect(citySlugToCyrillic(123)).toBeNull();
    expect(citySlugToCyrillic({})).toBeNull();
  });

  test('cityCyrillicToSlug — both Mogilev variants map to same slug', () => {
    expect(cityCyrillicToSlug('Могилев')).toBe('mogilev');
    expect(cityCyrillicToSlug('Могилёв')).toBe('mogilev');
  });

  test('cityCyrillicToSlug returns null for unknown city', () => {
    expect(cityCyrillicToSlug('Москва')).toBeNull();
    expect(cityCyrillicToSlug('')).toBeNull();
    expect(cityCyrillicToSlug(null)).toBeNull();
  });

  test('cityCyrillicToSlug round-trips canonical cities', () => {
    const canonicalCities = ['Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Бобруйск'];
    for (const city of canonicalCities) {
      const slug = cityCyrillicToSlug(city);
      const back = citySlugToCyrillic(slug);
      expect(back).toBe(city);
    }
  });

  test('cityCyrillicToSlug for Могилёв round-trips to canonical Могилев', () => {
    const slug = cityCyrillicToSlug('Могилёв');
    expect(slug).toBe('mogilev');
    expect(citySlugToCyrillic(slug)).toBe('Могилев');
  });
});

describe('urlSlugs — expandCityForQuery (Mogilev ё/е edge case)', () => {
  test('Могилев expands to both variants', () => {
    expect(expandCityForQuery('Могилев')).toEqual(['Могилев', 'Могилёв']);
  });

  test('Могилёв expands to both variants', () => {
    expect(expandCityForQuery('Могилёв')).toEqual(['Могилев', 'Могилёв']);
  });

  test('non-Mogilev cities return single-element array', () => {
    expect(expandCityForQuery('Минск')).toEqual(['Минск']);
    expect(expandCityForQuery('Гродно')).toEqual(['Гродно']);
    expect(expandCityForQuery('Брест')).toEqual(['Брест']);
    expect(expandCityForQuery('Гомель')).toEqual(['Гомель']);
    expect(expandCityForQuery('Витебск')).toEqual(['Витебск']);
    expect(expandCityForQuery('Бобруйск')).toEqual(['Бобруйск']);
  });
});

describe('urlSlugs — Category mappings', () => {
  test('CATEGORY_SLUG_MAP has 15 entries', () => {
    expect(Object.keys(CATEGORY_SLUG_MAP)).toHaveLength(15);
  });

  test('categorySlugToCyrillic returns Cyrillic for known slugs', () => {
    expect(categorySlugToCyrillic('restaurants')).toBe('Ресторан');
    expect(categorySlugToCyrillic('cafes')).toBe('Кафе');
    expect(categorySlugToCyrillic('coffee')).toBe('Кофейня');
    expect(categorySlugToCyrillic('bars')).toBe('Бар');
    expect(categorySlugToCyrillic('pizza')).toBe('Пиццерия');
    expect(categorySlugToCyrillic('bakery')).toBe('Пекарня');
    expect(categorySlugToCyrillic('patisserie')).toBe('Кондитерская');
    expect(categorySlugToCyrillic('fast-food')).toBe('Фаст-фуд');
    expect(categorySlugToCyrillic('pubs')).toBe('Паб');
    expect(categorySlugToCyrillic('canteens')).toBe('Столовая');
    expect(categorySlugToCyrillic('hookah')).toBe('Кальянная');
    expect(categorySlugToCyrillic('bowling')).toBe('Боулинг');
    expect(categorySlugToCyrillic('karaoke')).toBe('Караоке');
    expect(categorySlugToCyrillic('billiards')).toBe('Бильярд');
    expect(categorySlugToCyrillic('clubs')).toBe('Клуб');
  });

  test('categorySlugToCyrillic is case-insensitive', () => {
    expect(categorySlugToCyrillic('RESTAURANTS')).toBe('Ресторан');
  });

  test('categorySlugToCyrillic returns null for unknown slug', () => {
    expect(categorySlugToCyrillic('vegan-bar')).toBeNull();
    expect(categorySlugToCyrillic('')).toBeNull();
    expect(categorySlugToCyrillic(null)).toBeNull();
  });

  test('categoryCyrillicToSlug returns slug for known categories', () => {
    expect(categoryCyrillicToSlug('Ресторан')).toBe('restaurants');
    expect(categoryCyrillicToSlug('Фаст-фуд')).toBe('fast-food');
    expect(categoryCyrillicToSlug('Бильярд')).toBe('billiards');
  });

  test('categoryCyrillicToSlug round-trips all 15 categories', () => {
    for (const cyrillic of Object.keys(CATEGORY_SLUG_MAP)) {
      const slug = categoryCyrillicToSlug(cyrillic);
      expect(categorySlugToCyrillic(slug)).toBe(cyrillic);
    }
  });

  test('categoryCyrillicToSlug returns null for unknown category', () => {
    expect(categoryCyrillicToSlug('Веган-Бар')).toBeNull();
    expect(categoryCyrillicToSlug(null)).toBeNull();
  });
});

describe('urlSlugs — Cuisine mappings', () => {
  test('CUISINE_SLUG_MAP has 12 entries', () => {
    expect(Object.keys(CUISINE_SLUG_MAP)).toHaveLength(12);
  });

  test('cuisineSlugToCyrillic returns Cyrillic for known slugs', () => {
    expect(cuisineSlugToCyrillic('belarusian')).toBe('Народная');
    expect(cuisineSlugToCyrillic('signature')).toBe('Авторская');
    expect(cuisineSlugToCyrillic('asian')).toBe('Азиатская');
    expect(cuisineSlugToCyrillic('american')).toBe('Американская');
    expect(cuisineSlugToCyrillic('vegetarian')).toBe('Вегетарианская');
    expect(cuisineSlugToCyrillic('japanese')).toBe('Японская');
    expect(cuisineSlugToCyrillic('georgian')).toBe('Грузинская');
    expect(cuisineSlugToCyrillic('italian')).toBe('Итальянская');
    expect(cuisineSlugToCyrillic('mixed')).toBe('Смешанная');
    expect(cuisineSlugToCyrillic('european')).toBe('Европейская');
    expect(cuisineSlugToCyrillic('chinese')).toBe('Китайская');
    expect(cuisineSlugToCyrillic('eastern')).toBe('Восточная');
  });

  test('cuisineSlugToCyrillic returns null for unknown slug', () => {
    expect(cuisineSlugToCyrillic('mexican')).toBeNull();
    expect(cuisineSlugToCyrillic('')).toBeNull();
    expect(cuisineSlugToCyrillic(null)).toBeNull();
  });

  test('cuisineCyrillicToSlug round-trips all 12 cuisines', () => {
    for (const cyrillic of Object.keys(CUISINE_SLUG_MAP)) {
      const slug = cuisineCyrillicToSlug(cyrillic);
      expect(cuisineSlugToCyrillic(slug)).toBe(cyrillic);
    }
  });

  test('cuisineCyrillicToSlug returns null for unknown cuisine', () => {
    expect(cuisineCyrillicToSlug('Мексиканская')).toBeNull();
  });
});
