/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Reviews Management Integration Tests
 *
 * Tests review management endpoints (Segment B — Phase 2):
 *   #14 GET  /api/v1/admin/reviews                    — all reviews (admin view)
 *   #15 POST /api/v1/admin/reviews/:id/toggle-visibility — toggle visibility
 *   #16 POST /api/v1/admin/reviews/:id/delete          — soft delete
 *
 * Setup strategy:
 *   beforeAll  — create admin user, reviewer user, active establishment (shared)
 *   beforeEach — truncate reviews + audit_log (each test starts with clean review state)
 *   afterAll   — clearAllData()
 *
 * Notes:
 *   - Admin sees ALL reviews including is_visible=false and is_deleted=true
 *   - toggle-visibility uses WHERE is_deleted=false — deleted reviews return 404
 *   - delete is soft (is_deleted=true) — record remains in DB
 *   - Audit log writes are non-blocking (no await in service), but complete fast enough
 *     in test environment to be asserted without explicit delays
 *   - audit_log table is guaranteed deployed (Phase 0 migration)
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
  checkAuditLogExists,
} from '../utils/adminTestHelpers.js';

let adminToken;
let reviewerUserId;
let testEstablishmentId;

beforeAll(async () => {
  // Admin for API calls
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;

  // Regular user as review author
  const reviewer = await createUserAndGetTokens({
    email: `reviewer-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: 'Test Reviewer',
    role: 'user',
    authMethod: 'email',
  });
  reviewerUserId = reviewer.user.id;

  // Active establishment to attach reviews to
  const { establishment } = await createPartnerWithEstablishment('active');
  testEstablishmentId = establishment.id;
});

beforeEach(async () => {
  // Reset reviews and audit_log between tests; keep users and establishment
  await query('TRUNCATE TABLE audit_log CASCADE');
  await query('TRUNCATE TABLE reviews CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// #14 — GET /api/v1/admin/reviews
// ============================================================================

describe('GET /api/v1/admin/reviews (#14)', () => {
  test('should return empty list when no reviews exist', async () => {
    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  test('should return all reviews including hidden (is_visible=false)', async () => {
    await createTestReview(null, testEstablishmentId, { is_visible: true });
    await createTestReview(null, testEstablishmentId, { is_visible: false });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
  });

  test('should return all reviews including deleted (is_deleted=true)', async () => {
    await createTestReview(null, testEstablishmentId, { is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);

    const hasDeleted = response.body.data.some(r => r.is_deleted === true);
    expect(hasDeleted).toBe(true);
  });

  test('should return expected fields for each review', async () => {
    await createTestReview(reviewerUserId, testEstablishmentId, { rating: 5 });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const review = response.body.data[0];

    // Core review fields
    expect(review.id).toBeDefined();
    expect(review.rating).toBe(5);
    expect(review.content).toBeDefined();
    expect(review.is_visible).toBeDefined();
    expect(review.is_deleted).toBeDefined();
    expect(review.created_at).toBeDefined();

    // Author info (from JOIN users)
    expect(review.author_name).toBeDefined();
    expect(review.author_email).toBeDefined();

    // Establishment info (from JOIN establishments)
    expect(review.establishment_name).toBeDefined();
    expect(review.establishment_id).toBe(testEstablishmentId);
  });

  test('should filter by status=visible (only not-deleted visible reviews)', async () => {
    await createTestReview(null, testEstablishmentId, { is_visible: true, is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_visible: false, is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews?status=visible')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].is_visible).toBe(true);
    expect(response.body.data[0].is_deleted).toBe(false);
  });

  test('should filter by status=hidden (not-deleted, not-visible)', async () => {
    await createTestReview(null, testEstablishmentId, { is_visible: true, is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_visible: false, is_deleted: false });

    const response = await request(app)
      .get('/api/v1/admin/reviews?status=hidden')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].is_visible).toBe(false);
    expect(response.body.data[0].is_deleted).toBe(false);
  });

  test('should filter by status=deleted', async () => {
    await createTestReview(null, testEstablishmentId, { is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews?status=deleted')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].is_deleted).toBe(true);
  });

  test('should support pagination', async () => {
    await createTestReview(null, testEstablishmentId);
    await createTestReview(null, testEstablishmentId);
    await createTestReview(null, testEstablishmentId);

    const response = await request(app)
      .get('/api/v1/admin/reviews?page=2&per_page=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.per_page).toBe(2);
    expect(response.body.data).toHaveLength(1); // 3 total, 2 on page 1, 1 on page 2
    expect(response.body.meta.total).toBe(3);
  });

  test('should require admin authentication', async () => {
    await request(app)
      .get('/api/v1/admin/reviews')
      .expect(401);
  });
});

// ============================================================================
// #15 — POST /api/v1/admin/reviews/:id/toggle-visibility
// ============================================================================

describe('POST /api/v1/admin/reviews/:id/toggle-visibility (#15)', () => {
  test('should toggle visible review to hidden (is_visible: true → false)', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(review.id);
    expect(response.body.data.is_visible).toBe(false);
  });

  test('should toggle hidden review to visible (is_visible: false → true)', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: false });

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.is_visible).toBe(true);
  });

  test('should verify is_visible actually changes in database after toggle', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    // Toggle
    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Read back via admin list
    const listResponse = await request(app)
      .get(`/api/v1/admin/reviews?status=hidden`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const toggled = listResponse.body.data.find(r => r.id === review.id);
    expect(toggled).toBeDefined();
    expect(toggled.is_visible).toBe(false);
  });

  test('should return 404 REVIEW_NOT_FOUND for non-existent UUID', async () => {
    const response = await request(app)
      .post('/api/v1/admin/reviews/00000000-0000-0000-0000-000000000000/toggle-visibility')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  test('should return 404 when toggling a deleted review (WHERE is_deleted=false)', async () => {
    // toggleReviewVisibility has WHERE is_deleted = false, so deleted reviews return null → 404
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  test('should return error for invalid UUID format', async () => {
    const response = await request(app)
      .post('/api/v1/admin/reviews/not-a-uuid/toggle-visibility')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.body.success).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test('should create audit_log entry with review_hide action when hiding', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // After toggle, is_visible = false → action should be 'review_hide'
    expect(response.body.data.is_visible).toBe(false);

    const auditExists = await checkAuditLogExists(review.id, 'review_hide');
    expect(auditExists).toBe(true);
  });

  test('should create audit_log entry with review_show action when showing', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: false });

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // After toggle, is_visible = true → action should be 'review_show'
    expect(response.body.data.is_visible).toBe(true);

    const auditExists = await checkAuditLogExists(review.id, 'review_show');
    expect(auditExists).toBe(true);
  });

  test('should double-toggle restore original visibility state', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    // First toggle: true → false
    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Second toggle: false → true
    const secondResponse = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(secondResponse.body.data.is_visible).toBe(true);
  });

  test('should require admin authentication', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/toggle-visibility`)
      .expect(401);
  });
});

// ============================================================================
// #16 — POST /api/v1/admin/reviews/:id/delete
// ============================================================================

describe('POST /api/v1/admin/reviews/:id/delete (#16)', () => {
  test('should soft-delete review — row remains in DB with is_deleted=true', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toBe('Review deleted successfully');

    // Verify row still exists in DB with is_deleted=true
    const dbResult = await query('SELECT id, is_deleted FROM reviews WHERE id = $1', [review.id]);
    expect(dbResult.rows).toHaveLength(1);
    expect(dbResult.rows[0].is_deleted).toBe(true);
  });

  test('should still return deleted review in GET /admin/reviews (admin sees all)', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Admin list should still show it
    const listResponse = await request(app)
      .get('/api/v1/admin/reviews?status=deleted')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const deletedReview = listResponse.body.data.find(r => r.id === review.id);
    expect(deletedReview).toBeDefined();
    expect(deletedReview.is_deleted).toBe(true);
  });

  test('should return 400 REVIEW_ALREADY_DELETED when deleting an already-deleted review', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_ALREADY_DELETED');
  });

  test('should return 404 REVIEW_NOT_FOUND for non-existent UUID', async () => {
    const response = await request(app)
      .post('/api/v1/admin/reviews/00000000-0000-0000-0000-000000000000/delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  test('should return error for invalid UUID format', async () => {
    const response = await request(app)
      .post('/api/v1/admin/reviews/not-a-uuid/delete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.body.success).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test('should create audit_log entry with review_delete action', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditExists = await checkAuditLogExists(review.id, 'review_delete');
    expect(auditExists).toBe(true);
  });

  test('should accept optional reason body field without error', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Violates community guidelines' })
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  test('should work without reason field (reason is optional)', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  test('should require admin authentication', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .expect(401);
  });
});
