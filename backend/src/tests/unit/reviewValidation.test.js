/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: reviewValidation.js
 *
 * Tests express-validator chains for review endpoints.
 * Verifies that validation rules match current business logic,
 * including the removal of the 20-character minimum for review content.
 */

import { validationResult } from 'express-validator';
import {
  validateCreateReview,
  validateGetReview,
  validateGetEstablishmentReviews,
  validateGetUserReviews,
  validateUpdateReview,
  validateDeleteReview,
  validateGetQuota,
  validatePartnerResponse,
  validateDeletePartnerResponse,
} from '../../validators/reviewValidation.js';

/**
 * Helper: run an array of express-validator chains against a mock req
 * and return the validation result.
 */
async function runValidation(chains, req) {
  for (const chain of chains) {
    await chain.run(req);
  }
  return validationResult(req);
}

/**
 * Build a minimal mock request compatible with express-validator.
 */
function mockReq({ body = {}, params = {}, query = {} } = {}) {
  return { body, params, query };
}

// ─── validateCreateReview ───────────────────────────────────────────────────

describe('validateCreateReview', () => {
  const validBody = {
    establishmentId: '550e8400-e29b-41d4-a716-446655440000',
    rating: 5,
    content: 'Great place!',
  };

  test('should pass with valid data', async () => {
    const req = mockReq({ body: { ...validBody } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  // ── Short content (20-char minimum removed) ──

  test('should accept 1-character content (20-char min removed)', async () => {
    const req = mockReq({ body: { ...validBody, content: 'A' } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should accept 5-character content', async () => {
    const req = mockReq({ body: { ...validBody, content: 'Short' } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should accept 19-character content (under old 20-char min)', async () => {
    const req = mockReq({ body: { ...validBody, content: '1234567890123456789' } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  // ── Content edge cases ──

  test('should reject empty content', async () => {
    const req = mockReq({ body: { ...validBody, content: '' } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
    const errors = result.array();
    expect(errors.some(e => (e.path || e.param) === 'content')).toBe(true);
  });

  test('should reject missing content', async () => {
    const { content, ...noContent } = validBody;
    const req = mockReq({ body: noContent });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject content over 1000 characters', async () => {
    const req = mockReq({ body: { ...validBody, content: 'A'.repeat(1001) } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
    const errors = result.array();
    expect(errors.some(e => (e.path || e.param) === 'content')).toBe(true);
  });

  test('should accept content of exactly 1000 characters', async () => {
    const req = mockReq({ body: { ...validBody, content: 'A'.repeat(1000) } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  // ── Rating range ──

  test('should accept rating 1 (minimum)', async () => {
    const req = mockReq({ body: { ...validBody, rating: 1 } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should accept rating 5 (maximum)', async () => {
    const req = mockReq({ body: { ...validBody, rating: 5 } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should accept rating 3 (middle)', async () => {
    const req = mockReq({ body: { ...validBody, rating: 3 } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject rating 0', async () => {
    const req = mockReq({ body: { ...validBody, rating: 0 } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
    const errors = result.array();
    expect(errors.some(e => (e.path || e.param) === 'rating')).toBe(true);
  });

  test('should reject rating 6', async () => {
    const req = mockReq({ body: { ...validBody, rating: 6 } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject negative rating', async () => {
    const req = mockReq({ body: { ...validBody, rating: -1 } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject non-integer rating (3.5)', async () => {
    const req = mockReq({ body: { ...validBody, rating: 3.5 } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject missing rating', async () => {
    const { rating, ...noRating } = validBody;
    const req = mockReq({ body: noRating });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  // ── Establishment ID format ──

  test('should accept valid UUID for establishmentId', async () => {
    const req = mockReq({ body: { ...validBody } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject non-UUID establishmentId', async () => {
    const req = mockReq({ body: { ...validBody, establishmentId: 'not-a-uuid' } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
    const errors = result.array();
    expect(errors.some(e => (e.path || e.param) === 'establishmentId')).toBe(true);
  });

  test('should reject empty establishmentId', async () => {
    const req = mockReq({ body: { ...validBody, establishmentId: '' } });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject missing establishmentId', async () => {
    const { establishmentId, ...noId } = validBody;
    const req = mockReq({ body: noId });
    const result = await runValidation(validateCreateReview, req);
    expect(result.isEmpty()).toBe(false);
  });
});

// ─── validateGetReview ──────────────────────────────────────────────────────

describe('validateGetReview', () => {
  test('should pass with valid UUID param', async () => {
    const req = mockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } });
    const result = await runValidation(validateGetReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject non-UUID param', async () => {
    const req = mockReq({ params: { id: 'abc123' } });
    const result = await runValidation(validateGetReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject empty id param', async () => {
    const req = mockReq({ params: { id: '' } });
    const result = await runValidation(validateGetReview, req);
    expect(result.isEmpty()).toBe(false);
  });
});

// ─── validateGetEstablishmentReviews ────────────────────────────────────────

describe('validateGetEstablishmentReviews', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  test('should pass with valid UUID and no query params', async () => {
    const req = mockReq({ params: { id: validId } });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should pass with all valid query params', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { page: '1', limit: '10', sort: 'newest' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should accept sort=highest', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { sort: 'highest' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should accept sort=lowest', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { sort: 'lowest' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject invalid sort value', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { sort: 'random' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject page=0', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { page: '0' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject negative page', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { page: '-1' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject limit=0', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { limit: '0' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject limit over 50', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { limit: '51' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should accept limit=50 (boundary)', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { limit: '50' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should accept valid ISO 8601 date_from', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { date_from: '2025-01-01' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject invalid date_from', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { date_from: 'not-a-date' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should accept valid ISO 8601 date_to', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { date_to: '2026-12-31T23:59:59Z' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject invalid date_to', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { date_to: '31/12/2026' },
    });
    const result = await runValidation(validateGetEstablishmentReviews, req);
    expect(result.isEmpty()).toBe(false);
  });
});

// ─── validateGetUserReviews ─────────────────────────────────────────────────

describe('validateGetUserReviews', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  test('should pass with valid UUID', async () => {
    const req = mockReq({ params: { id: validId } });
    const result = await runValidation(validateGetUserReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should pass with valid pagination', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { page: '2', limit: '20' },
    });
    const result = await runValidation(validateGetUserReviews, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject non-UUID user id', async () => {
    const req = mockReq({ params: { id: 'abc' } });
    const result = await runValidation(validateGetUserReviews, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject limit over 50', async () => {
    const req = mockReq({
      params: { id: validId },
      query: { limit: '100' },
    });
    const result = await runValidation(validateGetUserReviews, req);
    expect(result.isEmpty()).toBe(false);
  });
});

// ─── validateUpdateReview ───────────────────────────────────────────────────

describe('validateUpdateReview', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  test('should pass with rating only', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { rating: 4 },
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should pass with content only', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { content: 'Updated review' },
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should pass with both rating and content', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { rating: 3, content: 'Updated' },
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject empty body (no fields to update)', async () => {
    const req = mockReq({
      params: { id: validId },
      body: {},
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject rating out of range on update', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { rating: 10 },
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject content over 1000 chars on update', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { content: 'X'.repeat(1001) },
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should accept short content on update (1 char)', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { content: 'X' },
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject non-UUID review id', async () => {
    const req = mockReq({
      params: { id: '123' },
      body: { rating: 3 },
    });
    const result = await runValidation(validateUpdateReview, req);
    expect(result.isEmpty()).toBe(false);
  });
});

// ─── validateDeleteReview ───────────────────────────────────────────────────

describe('validateDeleteReview', () => {
  test('should pass with valid UUID', async () => {
    const req = mockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } });
    const result = await runValidation(validateDeleteReview, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject non-UUID', async () => {
    const req = mockReq({ params: { id: 'not-uuid' } });
    const result = await runValidation(validateDeleteReview, req);
    expect(result.isEmpty()).toBe(false);
  });
});

// ─── validateGetQuota ───────────────────────────────────────────────────────

describe('validateGetQuota', () => {
  test('should pass with empty validators (no input needed)', async () => {
    const req = mockReq();
    const result = await runValidation(validateGetQuota, req);
    expect(result.isEmpty()).toBe(true);
  });
});

// ─── validatePartnerResponse ────────────────────────────────────────────────

describe('validatePartnerResponse', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  test('should pass with valid response text', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { response: 'Thank you for your feedback!' },
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject response under 10 characters', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { response: 'Thanks' },
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(false);
    const errors = result.array();
    expect(errors.some(e => (e.path || e.param) === 'response')).toBe(true);
  });

  test('should accept response of exactly 10 characters', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { response: 'Thank you!' },
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject response over 1000 characters', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { response: 'A'.repeat(1001) },
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should accept response of exactly 1000 characters', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { response: 'A'.repeat(1000) },
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject empty response', async () => {
    const req = mockReq({
      params: { id: validId },
      body: { response: '' },
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject missing response', async () => {
    const req = mockReq({
      params: { id: validId },
      body: {},
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(false);
  });

  test('should reject non-UUID review id', async () => {
    const req = mockReq({
      params: { id: 'bad' },
      body: { response: 'Valid response text here' },
    });
    const result = await runValidation(validatePartnerResponse, req);
    expect(result.isEmpty()).toBe(false);
  });
});

// ─── validateDeletePartnerResponse ──────────────────────────────────────────

describe('validateDeletePartnerResponse', () => {
  test('should pass with valid UUID', async () => {
    const req = mockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } });
    const result = await runValidation(validateDeletePartnerResponse, req);
    expect(result.isEmpty()).toBe(true);
  });

  test('should reject non-UUID', async () => {
    const req = mockReq({ params: { id: 'xyz' } });
    const result = await runValidation(validateDeletePartnerResponse, req);
    expect(result.isEmpty()).toBe(false);
  });
});
