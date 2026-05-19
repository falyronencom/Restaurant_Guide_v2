/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: slugGenerator.js
 *
 * Verifies transliteration + normalization + truncation pipeline,
 * plus async collision resolution via auto-suffix.
 */

import { jest } from '@jest/globals';
import {
  transliterate,
  normalizeSlug,
  truncateSlug,
  generateSlug,
  generateUniqueSlug,
} from '../../utils/slugGenerator.js';

describe('slugGenerator', () => {
  describe('transliterate', () => {
    test('basic Cyrillic lowercase', () => {
      expect(transliterate('кафе')).toBe('kafe');
      expect(transliterate('ресторан')).toBe('restoran');
      expect(transliterate('бар')).toBe('bar');
    });

    test('Cyrillic uppercase normalized to lowercase Latin', () => {
      expect(transliterate('КАФЕ')).toBe('kafe');
      expect(transliterate('Кафе')).toBe('kafe');
    });

    test('multi-character mappings', () => {
      expect(transliterate('щи')).toBe('shchi');
      expect(transliterate('борщ')).toBe('borshch');
      expect(transliterate('хлеб')).toBe('khleb');
      expect(transliterate('цех')).toBe('tsekh');
      expect(transliterate('чай')).toBe('chay');
      expect(transliterate('шашлык')).toBe('shashlyk');
      expect(transliterate('ёлка')).toBe('yolka');
      expect(transliterate('юг')).toBe('yug');
      expect(transliterate('яблоко')).toBe('yabloko');
      expect(transliterate('жираф')).toBe('zhiraf');
    });

    test('ъ and ь are dropped silently', () => {
      expect(transliterate('подъезд')).toBe('podezd');
      expect(transliterate('конь')).toBe('kon');
    });

    test('mixed cyrillic + latin', () => {
      expect(transliterate('Кафе Wine')).toBe('kafe Wine');
      expect(transliterate('Burger Брос')).toBe('Burger bros');
    });

    test('pure Latin passes through unchanged', () => {
      expect(transliterate('Wine Gallery')).toBe('Wine Gallery');
      expect(transliterate('Burger Brothers')).toBe('Burger Brothers');
    });

    test('digits and punctuation pass through', () => {
      expect(transliterate('Кафе 24')).toBe('kafe 24');
      expect(transliterate('"Бабушкины"')).toBe('"babushkiny"');
    });

    test('empty input', () => {
      expect(transliterate('')).toBe('');
      expect(transliterate(null)).toBe('');
      expect(transliterate(undefined)).toBe('');
    });

    test('real fixture names from establishments.js', () => {
      expect(transliterate('Васильки')).toBe('vasilki');
      expect(transliterate('Гамбринус')).toBe('gambrinus');
      expect(transliterate('Кофе Тайм')).toBe('kofe taym');
      expect(transliterate('Тбилиси')).toBe('tbilisi');
      expect(transliterate('Токио')).toBe('tokio');
      expect(transliterate('Сож')).toBe('sozh');
      expect(transliterate('Крыша')).toBe('krysha');
      expect(transliterate('Веранда')).toBe('veranda');
    });
  });

  describe('normalizeSlug', () => {
    test('lowercase and replace spaces with -', () => {
      expect(normalizeSlug('Wine Gallery')).toBe('wine-gallery');
      expect(normalizeSlug('Coffee Room')).toBe('coffee-room');
    });

    test('strip quotes and other punctuation', () => {
      expect(normalizeSlug('"Wine Gallery"')).toBe('wine-gallery');
      expect(normalizeSlug("Don't Stop")).toBe('don-t-stop');
      expect(normalizeSlug('Burger & Co.')).toBe('burger-co');
    });

    test('collapse multiple separators', () => {
      expect(normalizeSlug('a   b')).toBe('a-b');
      expect(normalizeSlug('a---b')).toBe('a-b');
      expect(normalizeSlug('a---b   c')).toBe('a-b-c');
    });

    test('trim leading/trailing separators', () => {
      expect(normalizeSlug('-wine-')).toBe('wine');
      expect(normalizeSlug('!!!gallery!!!')).toBe('gallery');
      expect(normalizeSlug('   spaces   ')).toBe('spaces');
    });

    test('preserve digits', () => {
      expect(normalizeSlug('kafe 24')).toBe('kafe-24');
      expect(normalizeSlug('24/7 kafe')).toBe('24-7-kafe');
    });

    test('empty after stripping all non-alphanumeric', () => {
      expect(normalizeSlug('"""')).toBe('');
      expect(normalizeSlug('   ')).toBe('');
      expect(normalizeSlug('---')).toBe('');
    });

    test('empty input', () => {
      expect(normalizeSlug('')).toBe('');
      expect(normalizeSlug(null)).toBe('');
    });
  });

  describe('truncateSlug', () => {
    test('no truncation if under limit', () => {
      expect(truncateSlug('short-slug', 150)).toBe('short-slug');
    });

    test('truncate to last dash boundary if dash is in second half', () => {
      const slug = 'a'.repeat(70) + '-' + 'b'.repeat(70);
      const result = truncateSlug(slug, 100);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result).toBe('a'.repeat(70));
    });

    test('hard truncate if dash is too far back', () => {
      const slug = 'ab-' + 'c'.repeat(100);
      const result = truncateSlug(slug, 50);
      expect(result.length).toBe(50);
      expect(result).toBe('ab-' + 'c'.repeat(47));
    });

    test('default maxLength is 150', () => {
      const longSlug = 'a'.repeat(200);
      expect(truncateSlug(longSlug).length).toBe(150);
    });

    test('exact match at boundary', () => {
      const slug = 'a'.repeat(150);
      expect(truncateSlug(slug, 150)).toBe(slug);
    });
  });

  describe('generateSlug (pure pipeline)', () => {
    test('basic Cyrillic restaurant name', () => {
      expect(generateSlug('Васильки')).toBe('vasilki');
      expect(generateSlug('Гамбринус')).toBe('gambrinus');
    });

    test('multi-word with spaces', () => {
      expect(generateSlug('Кофе Тайм')).toBe('kofe-taym');
      expect(generateSlug('Wine Gallery')).toBe('wine-gallery');
    });

    test('mixed cyrillic + latin', () => {
      expect(generateSlug('Кафе Wine')).toBe('kafe-wine');
      expect(generateSlug('Burger Брос')).toBe('burger-bros');
    });

    test('strip quotes', () => {
      expect(generateSlug('"Бабушкины рецепты"')).toBe('babushkiny-retsepty');
      expect(generateSlug('Семейный ресторан "Вкусы мира"'))
        .toBe('semeynyy-restoran-vkusy-mira');
    });

    test('long restaurant name fits within 150 chars', () => {
      const longName = 'Ресторан традиционной белорусской кухни "Бабушкины рецепты"';
      const slug = generateSlug(longName);
      expect(slug.length).toBeLessThanOrEqual(150);
      expect(slug).toBe('restoran-traditsionnoy-belorusskoy-kukhni-babushkiny-retsepty');
    });

    test('pure-digit name preserved', () => {
      expect(generateSlug('24/7')).toBe('24-7');
    });

    test('punctuation-only input returns empty', () => {
      expect(generateSlug('"""')).toBe('');
      expect(generateSlug('???')).toBe('');
    });

    test('empty input', () => {
      expect(generateSlug('')).toBe('');
      expect(generateSlug(null)).toBe('');
    });

    test('beginning/ending punctuation stripped', () => {
      expect(generateSlug('!Wine!')).toBe('wine');
      expect(generateSlug('-test-')).toBe('test');
    });

    test('all fixture names produce valid slugs', () => {
      expect(generateSlug('Васильки')).toBe('vasilki');
      expect(generateSlug('Гамбринус')).toBe('gambrinus');
      expect(generateSlug('La Scala')).toBe('la-scala');
      expect(generateSlug('Токио')).toBe('tokio');
      expect(generateSlug('Кофе Тайм')).toBe('kofe-taym');
      expect(generateSlug('Тбилиси')).toBe('tbilisi');
      expect(generateSlug('Burger Brothers')).toBe('burger-brothers');
      expect(generateSlug('Сож')).toBe('sozh');
    });
  });

  describe('generateUniqueSlug (async with collision)', () => {
    test('returns base slug when no collision', async () => {
      const checkDuplicate = jest.fn().mockResolvedValue(false);
      const result = await generateUniqueSlug('Кафе Весна', checkDuplicate);
      expect(result).toBe('kafe-vesna');
      expect(checkDuplicate).toHaveBeenCalledTimes(1);
      expect(checkDuplicate).toHaveBeenCalledWith('kafe-vesna');
    });

    test('appends -2 on first collision', async () => {
      const checkDuplicate = jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const result = await generateUniqueSlug('Кафе Весна', checkDuplicate);
      expect(result).toBe('kafe-vesna-2');
      expect(checkDuplicate).toHaveBeenCalledTimes(2);
    });

    test('appends -3 on second collision', async () => {
      const checkDuplicate = jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const result = await generateUniqueSlug('Кафе Весна', checkDuplicate);
      expect(result).toBe('kafe-vesna-3');
      expect(checkDuplicate).toHaveBeenCalledTimes(3);
    });

    test('throws when base slug is empty (punctuation-only name)', async () => {
      const checkDuplicate = jest.fn();
      await expect(generateUniqueSlug('"""', checkDuplicate))
        .rejects.toThrow(/Cannot generate slug/);
      expect(checkDuplicate).not.toHaveBeenCalled();
    });

    test('throws when name is empty string', async () => {
      const checkDuplicate = jest.fn();
      await expect(generateUniqueSlug('', checkDuplicate))
        .rejects.toThrow(/Cannot generate slug/);
    });

    test('long base slug — suffix space reserved via re-truncation', async () => {
      const longName = 'А'.repeat(150);
      const checkDuplicate = jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const result = await generateUniqueSlug(longName, checkDuplicate);
      expect(result.length).toBeLessThanOrEqual(150);
      expect(result).toMatch(/-2$/);
    });

    test('high collision count still resolves', async () => {
      // First 50 attempts taken, 51st free
      const checkDuplicate = jest.fn();
      for (let i = 0; i < 50; i++) {
        checkDuplicate.mockResolvedValueOnce(true);
      }
      checkDuplicate.mockResolvedValueOnce(false);

      const result = await generateUniqueSlug('Кафе', checkDuplicate);
      expect(result).toBe('kafe-51');
      expect(checkDuplicate).toHaveBeenCalledTimes(51);
    });
  });
});
