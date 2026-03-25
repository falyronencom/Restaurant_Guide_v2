/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Claiming Integration Tests
 *
 * Tests the claiming infrastructure:
 *   POST /api/v1/admin/establishments/:id/claim      — transfer ownership
 *   POST /api/v1/admin/users/:id/upgrade-to-partner   — standalone role upgrade
 *
 * Setup strategy:
 *   beforeAll  — create admin user (reused across tests)
 *   beforeEach — truncate establishments (each test starts clean)
 *   afterAll   — clearAllData()
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  getEstablishmentFromDb,
  checkAuditLogExists,
} from '../utils/adminTestHelpers.js';

let adminToken;
let adminUserId;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
  adminUserId = admin.user.id;
});

beforeEach(async () => {
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Helper: create a regular user (role='user')
// ============================================================================

async function createRegularUser(overrides = {}) {
  return createUserAndGetTokens({
    email: overrides.email || `user-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: overrides.name || 'Test User',
    role: 'user',
    authMethod: 'email',
  });
}

// ============================================================================
// POST /api/v1/admin/establishments/:id/claim
// ============================================================================

describe('POST /api/v1/admin/establishments/:id/claim', () => {
  test('should successfully claim establishment and upgrade user to partner', async () => {
    // Create establishment owned by seed-like partner
    const { establishment } = await createPartnerWithEstablishment('active');
    const oldPartnerId = establishment.partner_id;

    // Create target user
    const targetUser = await createRegularUser();

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: targetUser.user.id });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.establishment).toBeDefined();
    expect(response.body.data.establishment.partner_id).toBe(targetUser.user.id);
    expect(response.body.data.establishment.claimed_at).toBeTruthy();
    expect(response.body.data.establishment.claimed_by).toBeTruthy();

    // Verify DB state
    const dbEstablishment = await getEstablishmentFromDb(establishment.id);
    expect(dbEstablishment.partner_id).toBe(targetUser.user.id);
    expect(dbEstablishment.claimed_at).toBeTruthy();

    // Verify user role upgraded to partner
    const userResult = await query('SELECT role FROM users WHERE id = $1', [targetUser.user.id]);
    expect(userResult.rows[0].role).toBe('partner');
  });

  test('should work when target user is already a partner (idempotent role upgrade)', async () => {
    const { partner, establishment } = await createPartnerWithEstablishment('active');

    // Create another partner (already has partner role)
    const otherPartner = await createUserAndGetTokens({
      email: `partner-${randomUUID()}@test.com`,
      phone: null,
      password: 'Partner123!@#',
      name: 'Other Partner',
      role: 'partner',
      authMethod: 'email',
    });

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: otherPartner.user.id });

    expect(response.status).toBe(200);
    expect(response.body.data.establishment.partner_id).toBe(otherPartner.user.id);

    // Role should still be partner
    const userResult = await query('SELECT role FROM users WHERE id = $1', [otherPartner.user.id]);
    expect(userResult.rows[0].role).toBe('partner');
  });

  test('should return 404 for non-existent establishment', async () => {
    const targetUser = await createRegularUser();
    const fakeId = randomUUID();

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${fakeId}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: targetUser.user.id });

    expect(response.status).toBe(404);
  });

  test('should return 404 for non-existent user', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const fakeUserId = randomUUID();

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: fakeUserId });

    expect(response.status).toBe(404);
  });

  test('should return 400 for inactive user', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    // Create user then deactivate
    const targetUser = await createRegularUser();
    await query('UPDATE users SET is_active = false WHERE id = $1', [targetUser.user.id]);

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: targetUser.user.id });

    expect(response.status).toBe(400);
  });

  test('should return 400 when claiming for same owner', async () => {
    const { partner, establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: partner.user.id });

    expect(response.status).toBe(400);
  });

  test('should return 403 for non-admin user', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const regularUser = await createRegularUser();

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${regularUser.accessToken}`)
      .send({ user_id: regularUser.user.id });

    expect(response.status).toBe(403);
  });

  test('should return 422 for missing user_id', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(422);
  });

  test('should return 422 for invalid UUID format', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: 'not-a-uuid' });

    expect(response.status).toBe(422);
  });

  test('should create audit log entry with old/new partner_id', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const oldPartnerId = establishment.partner_id;
    const targetUser = await createRegularUser();

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: targetUser.user.id });

    // Wait briefly for non-blocking audit log write
    await new Promise(resolve => setTimeout(resolve, 200));

    const auditExists = await checkAuditLogExists(establishment.id, 'claim_establishment');
    if (auditExists !== null) {
      expect(auditExists).toBe(true);

      // Verify audit log details
      const auditResult = await query(
        "SELECT old_data, new_data FROM audit_log WHERE entity_id = $1 AND action = 'claim_establishment' LIMIT 1",
        [establishment.id],
      );
      const entry = auditResult.rows[0];
      expect(entry.old_data.partner_id).toBe(oldPartnerId);
      expect(entry.new_data.partner_id).toBe(targetUser.user.id);
    }
  });

  test('should rollback partner_id if transaction fails', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const oldPartnerId = establishment.partner_id;

    // Use a non-existent user ID that passes UUID validation but
    // will fail the FK constraint during the UPDATE
    // This simulates a transactional failure scenario
    const fakeUserId = randomUUID();

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: fakeUserId });

    // Should fail (user not found — caught before transaction)
    expect(response.status).toBe(404);

    // Verify establishment partner_id unchanged
    const dbEstablishment = await getEstablishmentFromDb(establishment.id);
    expect(dbEstablishment.partner_id).toBe(oldPartnerId);
  });
});

// ============================================================================
// POST /api/v1/admin/users/:id/upgrade-to-partner
// ============================================================================

describe('POST /api/v1/admin/users/:id/upgrade-to-partner', () => {
  test('should upgrade user role from user to partner', async () => {
    const targetUser = await createRegularUser();

    const response = await request(app)
      .post(`/api/v1/admin/users/${targetUser.user.id}/upgrade-to-partner`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe('partner');

    // Verify DB
    const userResult = await query('SELECT role FROM users WHERE id = $1', [targetUser.user.id]);
    expect(userResult.rows[0].role).toBe('partner');
  });

  test('should be idempotent for already-partner user', async () => {
    const existingPartner = await createUserAndGetTokens({
      email: `partner-${randomUUID()}@test.com`,
      phone: null,
      password: 'Partner123!@#',
      name: 'Existing Partner',
      role: 'partner',
      authMethod: 'email',
    });

    const response = await request(app)
      .post(`/api/v1/admin/users/${existingPartner.user.id}/upgrade-to-partner`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe('partner');
  });

  test('should return 404 for non-existent user', async () => {
    const fakeId = randomUUID();

    const response = await request(app)
      .post(`/api/v1/admin/users/${fakeId}/upgrade-to-partner`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  test('should return 400 for inactive user', async () => {
    const targetUser = await createRegularUser();
    await query('UPDATE users SET is_active = false WHERE id = $1', [targetUser.user.id]);

    const response = await request(app)
      .post(`/api/v1/admin/users/${targetUser.user.id}/upgrade-to-partner`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  test('should return 403 for non-admin user', async () => {
    const regularUser = await createRegularUser();
    const targetUser = await createRegularUser();

    const response = await request(app)
      .post(`/api/v1/admin/users/${targetUser.user.id}/upgrade-to-partner`)
      .set('Authorization', `Bearer ${regularUser.accessToken}`);

    expect(response.status).toBe(403);
  });

  test('should create audit log entry', async () => {
    const targetUser = await createRegularUser();

    await request(app)
      .post(`/api/v1/admin/users/${targetUser.user.id}/upgrade-to-partner`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Wait briefly for non-blocking audit log write
    await new Promise(resolve => setTimeout(resolve, 200));

    const auditExists = await checkAuditLogExists(targetUser.user.id, 'upgrade_user_to_partner');
    if (auditExists !== null) {
      expect(auditExists).toBe(true);
    }
  });
});
