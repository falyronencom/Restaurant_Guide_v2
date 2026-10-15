/**
 * catalog-labels — the hand-curated listing forms, read by slugs that come
 * straight from the address.
 *
 * A plain object also answers its prototype keys. On production 12.10.2026
 * `/constructor` titled the city page «Заведения function Object() { [native
 * code] }», and `/minsk/constructor` failed generateMetadata (an error digest
 * in the response, no title): `.toLowerCase()` of the inherited function.
 */
import {
  catalogBackLink,
  catalogHeading,
  categoryPlural,
  cityGenitive,
  cityHeading,
} from '@/lib/catalog-labels';

describe('listing forms are read by own key only', () => {
  // The fallback name differs from the slug on purpose: a helper that fell
  // back to the slug itself would otherwise pass unnoticed.
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'the inherited key %s falls back to the metadata name',
    (key) => {
      expect(categoryPlural(key, 'Категория')).toBe('Категория');
      expect(cityGenitive(key, 'Город')).toBe('Город');
      expect(cityHeading(key, 'Город')).toBe('Заведения Город');
      expect(catalogHeading(key, 'Категория', 'minsk', 'Минск')).toBe(
        'Категория Минска',
      );
    },
  );

  it('known slugs keep their listing forms', () => {
    expect(catalogHeading('fast-food', 'Фаст-фуд', 'grodno', 'Гродно')).toBe(
      'Фастфуд Гродно',
    );
    expect(cityHeading('gomel', 'Гомель')).toBe('Заведения Гомеля');
  });
});

describe('catalogBackLink — the way back from a missing establishment', () => {
  it('the category in that city', () => {
    expect(catalogBackLink('minsk', 'restaurants')).toEqual({
      href: '/minsk/restaurants',
      label: 'Посмотреть рестораны Минска',
    });
    expect(catalogBackLink('grodno', 'fast-food')).toEqual({
      href: '/grodno/fast-food',
      label: 'Посмотреть фастфуд Гродно',
    });
  });

  it('the city when the category part is unknown or missing', () => {
    const city = { href: '/gomel', label: 'Посмотреть заведения Гомеля' };
    expect(catalogBackLink('gomel', 'zz-kategoriya')).toEqual(city);
    expect(catalogBackLink('gomel', 'constructor')).toEqual(city);
    expect(catalogBackLink('gomel', undefined)).toEqual(city);
  });

  it('the home page when the city part is unknown or missing', () => {
    const home = { href: '/', label: 'На главную' };
    expect(catalogBackLink('zz-gorod', 'restaurants')).toEqual(home);
    expect(catalogBackLink('toString', 'restaurants')).toEqual(home);
    expect(catalogBackLink(undefined, undefined)).toEqual(home);
  });
});
