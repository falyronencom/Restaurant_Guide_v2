/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Moderation Extended Integration Tests
 *
 * Tests extended moderation endpoints (Segment B — Phase 1):
 *   #3  GET /api/v1/admin/establishments/active   — active (approved) establishments
 *   #4  GET /api/v1/admin/establishments/rejected — rejection history from audit_log
 *   #5  GET /api/v1/admin/establishments/search   — search across all statuses
 *
 * Setup strategy:
 *   beforeAll  — create admin user (reused across tests)
 *   beforeEach — truncate establishments + audit_log (each test starts clean)
 *   afterAll   — clearAllData()
 *
 * Architectural observation (from directive):
 *   - getActiveEstablishments SELECT does NOT include 'status' field (same as pending).
 *     Tests do not assert status field in #3 responses.
 *   - searchAllEstablishments SELECT DOES include 'status' field — asserted in #5.
 *   - #4 (rejected) depends on audit_log table — requires Phase 0 migration deployed.
 *     getRejectedEstablishments reads from audit_log via AuditLogModel.getRejectionHistory.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
} from '../utils/adminTestHelpers.js';

let adminToken;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
});

beforeEach(async () => {
  // Each test starts with empty establishments and audit_log
  await query('TRUNCATE TABLE audit_log CASCADE');
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// #3 — GET /api/v1/admin/establishments/active
// ============================================================================

describe('GET /api/v1/admin/establishments/active (#3)', () => {
  test('should return empty list when no active establishments', async () => {
    const response = await request(app)
      .get('/api/v1/admin/establishments/active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta).toBeDefined();
    expect(response.body.meta.total).toBe(0);
  });

  test('should return only active establishments, not pending or draft', async () => {
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('draft');

    const response = await request(app)
      .get('/api/v1/admin/establishments/active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
  });

  test('should not include suspended establishments in active list', async () => {
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('suspended');

    const response = await request(app)
      .get('/api/v1/admin/establishments/active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(1);
  });

  test('should return expected list fields for each establishment', async () => {
    await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get('/api/v1/admin/establishments/active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    const est = response.body.data[0];

    // Fields confirmed present in getActiveEstablishments SELECT
    expect(est.id).toBeDefined();
    expect(est.name).toBeDefined();
    expect(est.city).toBeDefined();
    expect(est.categories).toBeDefined();
    expect(est.cuisines).toBeDefined();
    expect(est.review_count).toBeDefined();
    expect(est.average_rating).toBeDefined();

    // Observation: status field NOT in SELECT (same as getPendingEstablishments)
    // This is a consistency observation — not a bug, since all rows are 'active'.
    // We do not assert est.status here.
  });

  test('should include meta pagination fields', async () => {
    await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get('/api/v1/admin/establishments/active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const meta = response.body.meta;
    expect(meta.total).toBeDefined();
    expect(meta.page).toBeDefined();
    expect(meta.per_page).toBeDefined();
    expect(meta.pages).toBeDefined();
    expect(meta.page).toBe(1);
  });

  test('should support pagination (page, per_page params)', async () => {
    // Create 3 active establishments
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get('/api/v1/admin/establishments/active?page=2&per_page=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.per_page).toBe(2);
    expect(response.body.data).toHaveLength(1); // 3 total, 2 on page 1, 1 on page 2
    expect(response.body.meta.total).toBe(3);
  });

  test('should require admin authentication', async () => {
    await request(app)
      .get('/api/v1/admin/establishments/active')
      .expect(401);
  });
});

// ============================================================================
// #4 — GET /api/v1/admin/establishments/rejected
// ============================================================================

describe('GET /api/v1/admin/establishments/rejected (#4)', () => {
  test('should return empty list when no rejections in audit_log', async () => {
    const response = await request(app)
      .get('/api/v1/admin/establishments/rejected')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  test('should return rejection history after moderating to reject', async () => {
    // Setup: create pending establishment, then reject it via API
    const { establishment } = await createPartnerWithEstablishment('pending');

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject', moderation_notes: { name: 'Name is misleading' } })
      .expect(200);

    const response = await request(app)
      .get('/api/v1/admin/establishments/rejected')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(1);
  });

  test('should include expected fields in rejection record', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject', moderation_notes: { description: 'Too vague' } })
      .expect(200);

    const response = await request(app)
      .get('/api/v1/admin/establishments/rejected')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const rejection = response.body.data[0];

    // Fields from getRejectionHistory SELECT
    expect(rejection.audit_id).toBeDefined();
    expect(rejection.rejection_date).toBeDefined();
    expect(rejection.establishment_id).toBe(establishment.id);
    expect(rejection.name).toBeDefined();
    expect(rejection.city).toBeDefined();

    // After rejection, status is 'rejected' — enables moderation feedback loop
    expect(rejection.current_status).toBe('rejected');
  });

  test('should return multiple rejections sorted by newest first', async () => {
    const { establishment: est1 } = await createPartnerWithEstablishment('pending');
    const { establishment: est2 } = await createPartnerWithEstablishment('pending');

    await request(app)
      .post(`/api/v1/admin/establishments/${est1.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject' })
      .expect(200);

    await request(app)
      .post(`/api/v1/admin/establishments/${est2.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject' })
      .expect(200);

    const response = await request(app)
      .get('/api/v1/admin/establishments/rejected')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
  });

  test('should NOT show approved establishments in rejection history', async () => {
    const { establishment: approved } = await createPartnerWithEstablishment('pending');
    const { establishment: rejected } = await createPartnerWithEstablishment('pending');

    await request(app)
      .post(`/api/v1/admin/establishments/${approved.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(200);

    await request(app)
      .post(`/api/v1/admin/establishments/${rejected.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject' })
      .expect(200);

    const response = await request(app)
      .get('/api/v1/admin/establishments/rejected')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Only the rejected one should appear
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].establishment_id).toBe(rejected.id);
  });

  test('should support pagination', async () => {
    // Create 3 rejected establishments
    for (let i = 0; i < 3; i++) {
      const { establishment } = await createPartnerWithEstablishment('pending');
      await request(app)
        .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'reject' })
        .expect(200);
    }

    const response = await request(app)
      .get('/api/v1/admin/establishments/rejected?page=2&per_page=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.per_page).toBe(2);
    expect(response.body.data).toHaveLength(1); // 3 total, 2 on page 1, 1 on page 2
    expect(response.body.meta.total).toBe(3);
  });

  test('should require admin authentication', async () => {
    await request(app)
      .get('/api/v1/admin/establishments/rejected')
      .expect(401);
  });
});

// ============================================================================
// #5 — GET /api/v1/admin/establishments/search
// ============================================================================

describe('GET /api/v1/admin/establishments/search (#5)', () => {
  test('should return 400 SEARCH_REQUIRED when search param is missing', async () => {
    const response = await request(app)
      .get('/api/v1/admin/establishments/search')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('SEARCH_REQUIRED');
  });

  test('should return 400 SEARCH_REQUIRED when search param is empty string', async () => {
    const response = await request(app)
      .get('/api/v1/admin/establishments/search?search=')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('SEARCH_REQUIRED');
  });

  test('should find establishment by partial name match', async () => {
    // Insert with known name directly (createPartnerWithEstablishment uses 'Test Establishment')
    await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get('/api/v1/admin/establishments/search?search=Test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    expect(response.body.data[0].name).toContain('Test');
  });

  test('should search across all statuses (pending, active, draft, suspended)', async () => {
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('draft');
    await createPartnerWithEstablishment('suspended');

    const response = await request(app)
      .get('/api/v1/admin/establishments/search?search=Test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(4);
    expect(response.body.meta.total).toBe(4);

    // Verify status field is present in search results (searchAllEstablishments SELECT includes it)
    response.body.data.forEach(est => {
      expect(est.status).toBeDefined();
      expect(['pending', 'active', 'draft', 'suspended']).toContain(est.status);
    });
  });

  test('should return empty array when no establishments match search', async () => {
    await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get('/api/v1/admin/establishments/search?search=ZZZNoMatch999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  test('should handle special characters without crash (SQL injection guard)', async () => {
    const specialQueries = [
      "'; DROP TABLE establishments; --",
      '%_special%',
      "test' OR '1'='1",
    ];

    for (const searchQuery of specialQueries) {
      const response = await request(app)
        .get(`/api/v1/admin/establishments/search?search=${encodeURIComponent(searchQuery)}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Should not crash (5xx) — any 2xx or 4xx is acceptable
      expect(response.status).toBeLessThan(500);
      expect(response.body.success !== undefined).toBe(true);
    }
  });

  test('should include expected fields in search results', async () => {
    await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get('/api/v1/admin/establishments/search?search=Test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const est = response.body.data[0];
    // Fields confirmed in searchAllEstablishments SELECT
    expect(est.id).toBeDefined();
    expect(est.name).toBeDefined();
    expect(est.city).toBeDefined();
    expect(est.status).toBeDefined(); // search includes status unlike active/pending lists
    expect(est.categories).toBeDefined();
    expect(est.cuisines).toBeDefined();
  });

  test('should support pagination in search results', async () => {
    // createPartnerWithEstablishment always creates name = 'Test Establishment'
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('draft');

    const response = await request(app)
      .get('/api/v1/admin/establishments/search?search=Test&page=2&per_page=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.per_page).toBe(2);
    expect(response.body.data).toHaveLength(1); // 3 total, 2 on page 1, 1 on page 2
    expect(response.body.meta.total).toBe(3);
  });

  test('should filter by status when status param provided', async () => {
    await createPartnerWithEstablishment('active');
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('draft');

    const response = await request(app)
      .get('/api/v1/admin/establishments/search?search=Test&status=active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].status).toBe('active');
  });

  test('should require admin authentication', async () => {
    await request(app)
      .get('/api/v1/admin/establishments/search?search=test')
      .expect(401);
  });
});
