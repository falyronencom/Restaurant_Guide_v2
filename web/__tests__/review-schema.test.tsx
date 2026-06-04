/**
 * ReviewSchema — JSON-LD shape contract (/reviews route).
 *
 * Synchronous Server Component (plain prop-taking, no top-level await) — render
 * directly per the open-status-badge.test.tsx pattern. No API-client mock is
 * needed: the component is pure over its props and the schema-org/seo-gate
 * helpers it calls run their REAL logic (server-only is stubbed by jest.config;
 * toAbsoluteUrl falls back to http://localhost:3000 outside production).
 *
 * Assertions parse the emitted <script type="application/ld+json"> and inspect
 * the structured object — review[] entries and the aggregateRating gate
 * (review_count >= 3 AND average_rating != null, see @/lib/schema-org).
 */
import { render } from '@testing-library/react';

import { ReviewSchema } from '@/components/establishment/ReviewSchema';
import type {
  PublicEstablishmentDetail,
  PublicReview,
} from '@/lib/api/types';

// --- Fixtures ---------------------------------------------------------------

const baseEstablishment: PublicEstablishmentDetail = {
  id: 'est-1',
  slug: 'testo',
  name: 'Тесто',
  description: null,
  city: 'Минск',
  city_slug: 'minsk',
  address: 'ул. Тестовая 1',
  latitude: null,
  longitude: null,
  phone: null,
  website: null,
  categories: ['Ресторан'],
  category_slug: 'restorany',
  cuisines: [],
  price_range: null,
  working_hours: null,
  attributes: null,
  status: 'active',
  primary_image_url: null,
  review_count: 0,
  average_rating: null,
  favorite_count: 0,
  booking_enabled: false,
  has_promotion: false,
  promotion_count: 0,
  published_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  email: null,
  special_hours: null,
  view_count: 0,
  media: [],
  promotions: [],
};

const makeReview = (over: Partial<PublicReview> = {}): PublicReview => ({
  id: 'rev-1',
  establishment_id: 'est-1',
  rating: 5,
  content: 'Отличное место',
  partner_response: null,
  partner_response_at: null,
  is_edited: false,
  created_at: '2026-02-01T12:00:00.000Z',
  updated_at: '2026-02-01T12:00:00.000Z',
  author: { id: 'u-1', name: 'Иван', avatar_url: null },
  ...over,
});

const baseProps = {
  citySlug: 'minsk',
  categorySlug: 'restorany',
};

/** Parse the single ld+json <script> in the container, or null when absent. */
const parseLdJson = (container: HTMLElement): Record<string, unknown> | null => {
  const el = container.querySelector('script[type="application/ld+json"]');
  if (!el) return null;
  return JSON.parse(el.textContent ?? '');
};

// ---------------------------------------------------------------------------
// 1. Reviews present => emits a Review[]
// ---------------------------------------------------------------------------

describe('ReviewSchema — review[] emission', () => {
  it('emits JSON-LD carrying a Review entry per review with mapped fields', () => {
    const reviews = [
      makeReview({
        id: 'rev-1',
        rating: 5,
        content: 'Отличное место',
        created_at: '2026-02-01T12:00:00.000Z',
        author: { id: 'u-1', name: 'Иван', avatar_url: null },
      }),
      makeReview({
        id: 'rev-2',
        rating: 4,
        // Empty content => reviewBody omitted (field-presence discipline).
        content: '',
        created_at: '2026-03-01T09:30:00.000Z',
        author: { id: 'u-2', name: 'Мария', avatar_url: null },
      }),
    ];

    const { container } = render(
      <ReviewSchema {...baseProps} establishment={baseEstablishment} reviews={reviews} />,
    );

    const schema = parseLdJson(container);
    expect(schema).not.toBeNull();
    expect(schema!['@context']).toBe('https://schema.org');
    // 'Ресторан' maps to Restaurant subtype (schema-org CATEGORY map).
    expect(schema!['@type']).toBe('Restaurant');
    expect(schema!.name).toBe('Тесто');
    // @id/url bind to the detail-page URL (absolute, dev fallback host).
    expect(schema!['@id']).toBe('http://localhost:3000/minsk/restorany/testo');
    expect(schema!.url).toBe(schema!['@id']);

    const review = schema!.review as Array<Record<string, unknown>>;
    expect(review).toHaveLength(2);

    expect(review[0]['@type']).toBe('Review');
    expect(review[0].author).toEqual({ '@type': 'Person', name: 'Иван' });
    expect(review[0].reviewRating).toEqual({
      '@type': 'Rating',
      ratingValue: 5,
      bestRating: 5,
      worstRating: 1,
    });
    expect(review[0].reviewBody).toBe('Отличное место');
    expect(review[0].datePublished).toBe('2026-02-01T12:00:00.000Z');

    // Second review: empty content => reviewBody key omitted entirely.
    expect(review[1].reviewBody).toBeUndefined();
    expect(review[1]).not.toHaveProperty('reviewBody');
    expect((review[1].reviewRating as Record<string, unknown>).ratingValue).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty => emits nothing
// ---------------------------------------------------------------------------

describe('ReviewSchema — empty review list', () => {
  it('renders nothing (no ld+json script) when there are no reviews', () => {
    const { container } = render(
      <ReviewSchema {...baseProps} establishment={baseEstablishment} reviews={[]} />,
    );

    expect(
      container.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
    expect(parseLdJson(container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. aggregateRating gate (review_count >= 3 AND average_rating != null)
// ---------------------------------------------------------------------------

describe('ReviewSchema — aggregateRating gate', () => {
  const oneReview = [makeReview()];

  it('emits aggregateRating when count >= 3 AND average_rating is set', () => {
    const establishment: PublicEstablishmentDetail = {
      ...baseEstablishment,
      review_count: 3,
      average_rating: 4.5,
    };

    const { container } = render(
      <ReviewSchema {...baseProps} establishment={establishment} reviews={oneReview} />,
    );

    const schema = parseLdJson(container)!;
    expect(schema.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it('skips aggregateRating when review_count < 3 (small sample gate)', () => {
    const establishment: PublicEstablishmentDetail = {
      ...baseEstablishment,
      review_count: 2,
      average_rating: 5,
    };

    const { container } = render(
      <ReviewSchema {...baseProps} establishment={establishment} reviews={oneReview} />,
    );

    const schema = parseLdJson(container)!;
    // Script still present (review[] emitted), but no aggregateRating key.
    expect(schema.review).toHaveLength(1);
    expect(schema.aggregateRating).toBeUndefined();
    expect(schema).not.toHaveProperty('aggregateRating');
  });

  it('skips aggregateRating when average_rating is null (count alone insufficient)', () => {
    const establishment: PublicEstablishmentDetail = {
      ...baseEstablishment,
      review_count: 12,
      average_rating: null,
    };

    const { container } = render(
      <ReviewSchema {...baseProps} establishment={establishment} reviews={oneReview} />,
    );

    const schema = parseLdJson(container)!;
    expect(schema.aggregateRating).toBeUndefined();
    expect(schema).not.toHaveProperty('aggregateRating');
  });
});
