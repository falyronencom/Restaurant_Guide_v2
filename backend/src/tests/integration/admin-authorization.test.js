/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Authorization Security Tests
 *
 * Verifies that the authenticate → authorize(['admin']) middleware chain
 * is correctly applied across all admin route groups.
 *
 * For each of 4 representative endpoints (one per route group), tests:
 *   1. No token             → 401 MISSING_TOKEN
 *   2. Invalid token        → 401 MALFORMED_TOKEN
 *   3. Valid user token     → 403 FORBIDDEN
 *   4. Valid partner token  → 403 FORBIDDEN
 *   5. Valid admin token    → not 401/403 (auth passes)
 *
 * Route groups tested:
 *   - Moderation:   GET /api/v1/admin/establishments/pending
 *   - Analytics:    GET /api/v1/admin/analytics/overview
 *   - Reviews:      GET /api/v1/admin/reviews
 *   - Audit Log:    GET /api/v1/admin/audit-log
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';

let adminToken;
let userToken;
let partnerToken;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  const user = await createUserAndGetTokens(testUsers.regularUser);
  const partner = await createUserAndGetTokens(testUsers.partner);

  adminToken = admin.accessToken;
  userToken = user.accessToken;
  partnerToken = partner.accessToken;
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Helper: generate auth tests for one endpoint
// ============================================================================

/**
 * Creates a suite of authorization tests for a single admin endpoint.
 * Called inside a parent describe block.
 *
 * @param {'get'|'post'} method
 * @param {string} path
 */
function authSuiteFor(method, path) {
  const label = `${method.toUpperCase()} ${path}`;

  describe(label, () => {
    test('should return 401 MISSING_TOKEN when no token provided', async () => {
      const response = await request(app)[method](path).expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    test('should return 401 when token is malformed / invalid', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', 'Bearer this.is.not.a.real.jwt')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(['MALFORMED_TOKEN', 'INVALID_TOKEN']).toContain(
        response.body.error.code,
      );
    });

    test('should return 403 FORBIDDEN for regular user token', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    test('should return 403 FORBIDDEN for partner token', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    test('should pass auth (not 401/403) for valid admin token', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', `Bearer ${adminToken}`);

      // We only verify auth passes — endpoint may return any 2xx/5xx
      // depending on data state (empty DB, missing audit_log table, etc.)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });
}

// ============================================================================
// Apply auth suite to one endpoint per route group
// ============================================================================

describe('Admin Authorization — Moderation Group', () => {
  authSuiteFor('get', '/api/v1/admin/establishments/pending');
});

describe('Admin Authorization — Analytics Group', () => {
  authSuiteFor('get', '/api/v1/admin/analytics/overview');
});

describe('Admin Authorization — Reviews Group', () => {
  authSuiteFor('get', '/api/v1/admin/reviews');
});

describe('Admin Authorization — Audit Log Group', () => {
  authSuiteFor('get', '/api/v1/admin/audit-log');
});
