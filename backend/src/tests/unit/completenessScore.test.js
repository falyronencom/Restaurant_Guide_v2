/* eslint-env jest */
/**
 * Unit Tests: calculateCompletenessScore()
 *
 * Tests the pure completeness score calculation function.
 * No database or I/O — pure input→output.
 */

import { jest } from '@jest/globals';

// Mock database (required because establishmentModel imports it)
jest.unstable_mockModule('../../config/database.js', () => ({
  default: { query: jest.fn() },
}));

const { calculateCompletenessScore } =
  await import('../../models/establishmentModel.js');

describe('calculateCompletenessScore', () => {
  // =========================================================================
  // Boundary cases
  // =========================================================================

  test('full card returns 100', () => {
    const establishment = {
      description: 'A great restaurant in Minsk',
      price_range: '$$',
      attributes: { wifi: true, parking: true },
      phone: '+375291234567',
      email: 'info@restaurant.by',
      website: 'https://restaurant.by',
    };
    expect(calculateCompletenessScore(establishment)).toBe(100);
  });

  test('empty card returns 0', () => {
    const establishment = {};
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });

  test('all fields null returns 0', () => {
    const establishment = {
      description: null,
      price_range: null,
      attributes: null,
      phone: null,
      email: null,
      website: null,
    };
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });

  test('all fields empty string returns 0', () => {
    const establishment = {
      description: '',
      price_range: null,
      attributes: '{}',
      phone: '',
      email: '',
      website: '',
    };
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });

  // =========================================================================
  // Individual field scores
  // =========================================================================

  test('description only = 25 points', () => {
    const establishment = { description: 'Some description' };
    expect(calculateCompletenessScore(establishment)).toBe(25);
  });

  test('price_range only = 25 points', () => {
    const establishment = { price_range: '$$' };
    expect(calculateCompletenessScore(establishment)).toBe(25);
  });

  test('attributes object only = 20 points', () => {
    const establishment = { attributes: { wifi: true } };
    expect(calculateCompletenessScore(establishment)).toBe(20);
  });

  test('attributes as JSON string = 20 points', () => {
    const establishment = { attributes: '{"wifi": true}' };
    expect(calculateCompletenessScore(establishment)).toBe(20);
  });

  test('empty attributes object = 0 points', () => {
    const establishment = { attributes: {} };
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });

  test('empty attributes string = 0 points', () => {
    const establishment = { attributes: '{}' };
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });

  test('phone only = 15 points', () => {
    const establishment = { phone: '+375291234567' };
    expect(calculateCompletenessScore(establishment)).toBe(15);
  });

  test('email only = 10 points', () => {
    const establishment = { email: 'test@test.com' };
    expect(calculateCompletenessScore(establishment)).toBe(10);
  });

  test('website only = 5 points', () => {
    const establishment = { website: 'https://example.com' };
    expect(calculateCompletenessScore(establishment)).toBe(5);
  });

  // =========================================================================
  // Partial completion
  // =========================================================================

  test('description + price_range = 50 (high-priority fields)', () => {
    const establishment = {
      description: 'Nice place',
      price_range: '$$$',
    };
    expect(calculateCompletenessScore(establishment)).toBe(50);
  });

  test('description + phone + website = 45', () => {
    const establishment = {
      description: 'A cafe',
      phone: '123',
      website: 'http://cafe.by',
    };
    expect(calculateCompletenessScore(establishment)).toBe(45);
  });

  test('all except website = 95', () => {
    const establishment = {
      description: 'Full info',
      price_range: '$$',
      attributes: { terrace: true },
      phone: '+375',
      email: 'a@b.com',
    };
    expect(calculateCompletenessScore(establishment)).toBe(95);
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  test('handles malformed attributes JSON string gracefully', () => {
    const establishment = { attributes: 'not-valid-json' };
    // Should not throw, should return 0 for attributes
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });

  test('attributes string "null" = 0 points', () => {
    const establishment = { attributes: 'null' };
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });

  test('price_range "$" is valid (truthy)', () => {
    const establishment = { price_range: '$' };
    expect(calculateCompletenessScore(establishment)).toBe(25);
  });

  test('does not count extra fields (e.g., name, city)', () => {
    const establishment = {
      name: 'Restaurant Name',
      city: 'Минск',
      address: 'Street 1',
      categories: ['Ресторан'],
      cuisines: ['Итальянская'],
    };
    expect(calculateCompletenessScore(establishment)).toBe(0);
  });
});
