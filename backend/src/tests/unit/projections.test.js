/* eslint-env jest */
/**
 * Unit tests for public projection functions.
 *
 * Focus: sensitive field exclusion, derived field computation, pure-function
 * idempotency, edge cases (null/undefined/empty arrays).
 *
 * Excluded fields verified absent:
 *   partner_id, partner_name, partner_email, subscription_tier,
 *   subscription_started_at, subscription_expires_at, base_score, boost_score,
 *   is_seed, claimed_at, claimed_by, moderation_notes, moderated_by, moderated_at.
 */

import {
  toPublicEstablishment,
  toPublicEstablishmentListing,
  toPublicEstablishmentMapMarker,
} from '../../projections/establishmentProjections.js';
import { toPublicReview, toPublicUserReview } from '../../projections/reviewProjections.js';
import { toPublicMenuItem } from '../../projections/menuItemProjections.js';

const SENSITIVE_FIELDS = [
  'partner_id',
  'partner_name',
  'partner_email',
  'subscription_tier',
  'subscription_started_at',
  'subscription_expires_at',
  'base_score',
  'boost_score',
  'is_seed',
  'claimed_at',
  'claimed_by',
  'moderation_notes',
  'moderated_by',
  'moderated_at',
];

// Realistic raw establishment row mirroring searchService output shape
const rawEstablishmentRow = {
  id: 'est-123',
  partner_id: 'partner-456',
  partner_name: 'Иван Иванов',
  partner_email: 'partner@example.com',
  name: 'Кафе Весна',
  slug: 'kafe-vesna',
  description: 'Уютное кафе в центре',
  city: 'Минск',
  address: 'ул. Ленина 1',
  latitude: '53.9',
  longitude: '27.5',
  phone: '+375291234567',
  email: 'cafe@example.com',
  website: 'https://cafe.by',
  categories: ['Кафе', 'Ресторан'],
  cuisines: ['Европейская'],
  price_range: '$$',
  working_hours: { monday: '10:00-22:00' },
  special_hours: null,
  attributes: { wifi: true, parking: false },
  status: 'active',
  moderation_notes: '{"approval":"OK"}',
  moderated_by: 'admin-uuid',
  moderated_at: '2025-01-01',
  subscription_tier: 'premium',
  subscription_started_at: '2025-01-01',
  subscription_expires_at: '2026-01-01',
  base_score: 85,
  boost_score: 10,
  view_count: '120',
  favorite_count: '15',
  review_count: '8',
  average_rating: '4.5',
  primary_image_url: 'https://cdn.example.com/img.jpg',
  is_seed: false,
  claimed_at: null,
  claimed_by: null,
  booking_enabled: true,
  has_promotion: true,
  promotion_count: 2,
  published_at: '2025-01-15',
  created_at: '2024-12-01',
  updated_at: '2025-02-01',
};

describe('toPublicEstablishment — full detail projection', () => {
  test('excludes all sensitive fields', () => {
    const result = toPublicEstablishment(rawEstablishmentRow);
    for (const field of SENSITIVE_FIELDS) {
      expect(result).not.toHaveProperty(field);
    }
  });

  test('includes core public fields', () => {
    const result = toPublicEstablishment(rawEstablishmentRow);
    expect(result.id).toBe('est-123');
    expect(result.slug).toBe('kafe-vesna');
    expect(result.name).toBe('Кафе Весна');
    expect(result.description).toBe('Уютное кафе в центре');
    expect(result.city).toBe('Минск');
    expect(result.address).toBe('ул. Ленина 1');
    expect(result.phone).toBe('+375291234567');
    expect(result.email).toBe('cafe@example.com');
    expect(result.website).toBe('https://cafe.by');
    expect(result.price_range).toBe('$$');
    expect(result.primary_image_url).toBe('https://cdn.example.com/img.jpg');
    expect(result.booking_enabled).toBe(true);
  });

  test('preserves status (mobile non-nullable cast guard)', () => {
    // Mobile establishment.dart:149 does `status: json['status'] as String`
    // (non-nullable). Removing status would crash mobile Dart parsing.
    const result = toPublicEstablishment(rawEstablishmentRow);
    expect(result.status).toBe('active');
  });

  test('listing projection also preserves status', () => {
    const result = toPublicEstablishmentListing(rawEstablishmentRow);
    expect(result.status).toBe('active');
  });

  test('parses numeric strings to numbers', () => {
    const result = toPublicEstablishment(rawEstablishmentRow);
    expect(result.latitude).toBe(53.9);
    expect(result.longitude).toBe(27.5);
    expect(result.average_rating).toBe(4.5);
    expect(result.review_count).toBe(8);
    expect(result.favorite_count).toBe(15);
    expect(result.view_count).toBe(120);
  });

  test('derives city_slug from Cyrillic city', () => {
    const result = toPublicEstablishment(rawEstablishmentRow);
    expect(result.city_slug).toBe('minsk');
  });

  test('derives category_slug from first category', () => {
    const result = toPublicEstablishment(rawEstablishmentRow);
    expect(result.category_slug).toBe('cafes');
  });

  test('derives category_slug as null when categories empty', () => {
    const result = toPublicEstablishment({ ...rawEstablishmentRow, categories: [] });
    expect(result.category_slug).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(toPublicEstablishment(null)).toBeNull();
    expect(toPublicEstablishment(undefined)).toBeNull();
  });

  test('handles missing media/promotions as empty arrays', () => {
    const result = toPublicEstablishment(rawEstablishmentRow);
    expect(result.media).toEqual([]);
    expect(result.promotions).toEqual([]);
  });

  test('preserves media/promotions when provided', () => {
    const withMedia = {
      ...rawEstablishmentRow,
      media: [{ url: 'x', type: 'interior' }],
      promotions: [{ id: 'p1', title: 'Sale' }],
    };
    const result = toPublicEstablishment(withMedia);
    expect(result.media).toHaveLength(1);
    expect(result.promotions).toHaveLength(1);
  });

  test('idempotent — same input gives same output', () => {
    const r1 = toPublicEstablishment(rawEstablishmentRow);
    const r2 = toPublicEstablishment(rawEstablishmentRow);
    expect(r1).toEqual(r2);
  });

  test('Mogilev city derives correct slug', () => {
    const minsk = toPublicEstablishment({ ...rawEstablishmentRow, city: 'Могилев' });
    expect(minsk.city_slug).toBe('mogilev');
    const minskYo = toPublicEstablishment({ ...rawEstablishmentRow, city: 'Могилёв' });
    expect(minskYo.city_slug).toBe('mogilev');
  });
});

describe('toPublicEstablishmentListing — lightweight projection', () => {
  test('excludes all sensitive fields', () => {
    const result = toPublicEstablishmentListing(rawEstablishmentRow);
    for (const field of SENSITIVE_FIELDS) {
      expect(result).not.toHaveProperty(field);
    }
  });

  test('excludes media and promotions arrays (listing is lightweight)', () => {
    const withMedia = {
      ...rawEstablishmentRow,
      media: [{ url: 'x' }],
      promotions: [{ id: 'p1' }],
    };
    const result = toPublicEstablishmentListing(withMedia);
    expect(result).not.toHaveProperty('media');
    expect(result).not.toHaveProperty('promotions');
  });

  test('excludes detailed-only fields (description-light listing)', () => {
    const result = toPublicEstablishmentListing(rawEstablishmentRow);
    // email kept off listing (only contact phone + website for listing card)
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('special_hours');
    expect(result).not.toHaveProperty('view_count');
  });

  test('includes all fields mobile Establishment.fromJson parses non-nullably', () => {
    // mobile/lib/models/establishment.dart fromJson casts these fields as
    // non-nullable Strings (some then DateTime.parse'd). Any missing field
    // throws TypeError, the exception bubbles up to the UI provider, and
    // the user sees "Не удалось загрузить данные" with no list rendered.
    // Map endpoint uses the same projection — per-item try/catch silently
    // skips failures, so the map shows zero markers instead of throwing.
    // This test asserts the consumer contract on Brief 1's listing shape.
    const result = toPublicEstablishmentListing(rawEstablishmentRow);
    expect(typeof result.name).toBe('string');
    expect(typeof result.address).toBe('string');
    expect(typeof result.city).toBe('string');
    expect(typeof result.status).toBe('string');
    expect(typeof result.created_at).toBe('string');
    expect(typeof result.updated_at).toBe('string');
  });

  test('includes derived city_slug and category_slug', () => {
    const result = toPublicEstablishmentListing(rawEstablishmentRow);
    expect(result.city_slug).toBe('minsk');
    expect(result.category_slug).toBe('cafes');
  });

  test('includes distance_km and distance when present', () => {
    const withDistance = { ...rawEstablishmentRow, distance_km: 2.5 };
    const result = toPublicEstablishmentListing(withDistance);
    expect(result.distance_km).toBe(2.5);
    expect(result.distance).toBe(2.5);
  });

  test('omits distance fields when not present', () => {
    const result = toPublicEstablishmentListing(rawEstablishmentRow);
    expect(result).not.toHaveProperty('distance_km');
    expect(result).not.toHaveProperty('distance');
  });

  test('returns null for null input', () => {
    expect(toPublicEstablishmentListing(null)).toBeNull();
  });
});

describe('toPublicEstablishmentMapMarker — minimum projection', () => {
  test('excludes all sensitive fields', () => {
    const result = toPublicEstablishmentMapMarker(rawEstablishmentRow);
    for (const field of SENSITIVE_FIELDS) {
      expect(result).not.toHaveProperty(field);
    }
  });

  test('contains only minimum marker fields', () => {
    const result = toPublicEstablishmentMapMarker(rawEstablishmentRow);
    const allowedKeys = [
      'id', 'slug', 'name', 'city', 'city_slug',
      'latitude', 'longitude', 'primary_image_url',
      'average_rating', 'has_promotion',
    ];
    expect(Object.keys(result).sort()).toEqual(allowedKeys.sort());
  });

  test('parses lat/lng to numbers', () => {
    const result = toPublicEstablishmentMapMarker(rawEstablishmentRow);
    expect(result.latitude).toBe(53.9);
    expect(result.longitude).toBe(27.5);
  });

  test('returns null for null input', () => {
    expect(toPublicEstablishmentMapMarker(null)).toBeNull();
  });
});

describe('toPublicReview — review projection', () => {
  const formattedReview = {
    id: 'rev-1',
    establishment_id: 'est-1',
    rating: 5,
    content: 'Отлично!',
    partner_response: 'Спасибо!',
    partner_response_at: '2025-02-01',
    partner_responder_id: 'partner-uuid-LEAK',
    is_visible: true,
    is_deleted: false,
    is_edited: false,
    created_at: '2025-01-30',
    updated_at: '2025-01-30',
    author: { id: 'user-1', name: 'Анна', avatar_url: 'avatar.jpg' },
  };

  test('excludes partner_responder_id', () => {
    const result = toPublicReview(formattedReview);
    expect(result).not.toHaveProperty('partner_responder_id');
  });

  test('excludes is_visible and is_deleted', () => {
    const result = toPublicReview(formattedReview);
    expect(result).not.toHaveProperty('is_visible');
    expect(result).not.toHaveProperty('is_deleted');
  });

  test('includes core fields including author wrapper', () => {
    const result = toPublicReview(formattedReview);
    expect(result.id).toBe('rev-1');
    expect(result.rating).toBe(5);
    expect(result.content).toBe('Отлично!');
    expect(result.partner_response).toBe('Спасибо!');
    expect(result.author).toEqual({ id: 'user-1', name: 'Анна', avatar_url: 'avatar.jpg' });
  });

  test('handles raw DB row shape (no pre-formatted author)', () => {
    const rawRow = {
      id: 'rev-2',
      establishment_id: 'est-1',
      user_id: 'user-2',
      author_name: 'Петр',
      author_avatar: 'avatar2.jpg',
      rating: 4,
      content: 'Хорошо',
      partner_response: null,
      partner_response_at: null,
      is_edited: false,
      created_at: '2025-01-30',
      updated_at: '2025-01-30',
    };
    const result = toPublicReview(rawRow);
    expect(result.author).toEqual({ id: 'user-2', name: 'Петр', avatar_url: 'avatar2.jpg' });
  });

  test('returns null for null input', () => {
    expect(toPublicReview(null)).toBeNull();
  });
});

describe('toPublicUserReview — user review projection', () => {
  const formattedUserReview = {
    id: 'rev-3',
    establishment_id: 'est-1',
    rating: 4,
    content: 'Хорошее место',
    partner_response: 'Спасибо за визит!',
    partner_response_at: '2025-02-01',
    partner_responder_id: 'partner-uuid-LEAK',
    is_visible: true,
    is_deleted: false,
    is_edited: true,
    created_at: '2025-01-30',
    updated_at: '2025-01-30',
    establishment: { id: 'est-1', name: 'Test Restaurant', city: 'Минск', category: 'Ресторан' },
  };

  test('excludes partner_responder_id', () => {
    const result = toPublicUserReview(formattedUserReview);
    expect(result).not.toHaveProperty('partner_responder_id');
  });

  test('excludes is_visible and is_deleted', () => {
    const result = toPublicUserReview(formattedUserReview);
    expect(result).not.toHaveProperty('is_visible');
    expect(result).not.toHaveProperty('is_deleted');
  });

  test('preserves establishment wrapper', () => {
    const result = toPublicUserReview(formattedUserReview);
    expect(result.establishment).toEqual({
      id: 'est-1',
      name: 'Test Restaurant',
      city: 'Минск',
      category: 'Ресторан',
    });
  });

  test('includes core public fields', () => {
    const result = toPublicUserReview(formattedUserReview);
    expect(result.id).toBe('rev-3');
    expect(result.rating).toBe(4);
    expect(result.content).toBe('Хорошее место');
    expect(result.partner_response).toBe('Спасибо за визит!');
    expect(result.is_edited).toBe(true);
  });

  test('does not surface author wrapper (user is implicit in path param)', () => {
    const result = toPublicUserReview(formattedUserReview);
    expect(result).not.toHaveProperty('author');
  });

  test('null-fallback for missing partner_response (preserves field, sets null)', () => {
    const reviewNoResponse = { ...formattedUserReview, partner_response: undefined, partner_response_at: undefined };
    const result = toPublicUserReview(reviewNoResponse);
    expect(result).toHaveProperty('partner_response');
    expect(result.partner_response).toBeNull();
    expect(result.partner_response_at).toBeNull();
  });

  test('returns null for null input', () => {
    expect(toPublicUserReview(null)).toBeNull();
  });
});

describe('toPublicMenuItem — menu item projection', () => {
  const rawItem = {
    id: 'mi-1',
    establishment_id: 'est-1',
    media_id: 'media-uuid-LEAK',
    item_name: 'Драники',
    price_byn: '12.50',
    category_raw: 'Основные блюда',
    confidence: 0.95,
    sanity_flag: { reason: 'low_confidence', score: 0.3 },
    is_hidden_by_admin: false,
    hidden_reason: 'admin note LEAK',
    position: 3,
    created_at: '2025-01-01',
    updated_at: '2025-01-15',
  };

  test('excludes admin/moderation/OCR metadata', () => {
    const result = toPublicMenuItem(rawItem);
    expect(result).not.toHaveProperty('media_id');
    expect(result).not.toHaveProperty('sanity_flag');
    expect(result).not.toHaveProperty('is_hidden_by_admin');
    expect(result).not.toHaveProperty('hidden_reason');
    expect(result).not.toHaveProperty('confidence');
  });

  test('includes public fields', () => {
    const result = toPublicMenuItem(rawItem);
    expect(result.id).toBe('mi-1');
    expect(result.establishment_id).toBe('est-1');
    expect(result.item_name).toBe('Драники');
    expect(result.price_byn).toBe(12.5);
    expect(result.category_raw).toBe('Основные блюда');
    expect(result.position).toBe(3);
  });

  test('parses price_byn to number', () => {
    const result = toPublicMenuItem({ ...rawItem, price_byn: '8.99' });
    expect(typeof result.price_byn).toBe('number');
    expect(result.price_byn).toBe(8.99);
  });

  test('handles null price', () => {
    const result = toPublicMenuItem({ ...rawItem, price_byn: null });
    expect(result.price_byn).toBeNull();
  });

  test('returns null for null input', () => {
    expect(toPublicMenuItem(null)).toBeNull();
  });
});
