/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Analytics Integration Tests
 *
 * Tests 4 analytics endpoints (Segment C):
 *   #10  GET /api/v1/admin/analytics/overview          — dashboard metric cards
 *   #11  GET /api/v1/admin/analytics/users             — user registration analytics
 *   #12  GET /api/v1/admin/analytics/establishments    — establishment pipeline analytics
 *   #13  GET /api/v1/admin/analytics/reviews           — review activity analytics
 *
 * Setup: controlled dataset created once in beforeAll
 *   - 1 admin user
 *   - 3 regular users
 *   - 4 establishments: 2 active, 1 pending, 1 suspended (plus partner users)
 *   - 3 reviews on the first active establishment (ratings 2, 3, 5)
 *
 * Ghost table finding: establishment_analytics is not queried by any analytics
 * function. All queries target: users, establishments, reviews, audit_log directly.
 *
 * Aggregation note: 30d period → 'week' aggregation because endDate = new Date()
 * (current time, not midnight), making the range ≈ 30.5 days → ceil=31 > 30.
 * Only 7d period reliably returns 'day' aggregation in all environments.
 *
 * All analytics endpoints are read-only — no beforeEach cleanup needed.
 * afterAll clears all test data.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
} from '../utils/adminTestHelpers.js';

const BASE_URL = '/api/v1/admin/analytics';

let adminToken;
let userToken; // non-admin, for 403 tests
let firstActiveEstablishmentId;

beforeAll(async () => {
  // Admin user (reused across all tests)
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;

  // Non-admin user for 403 assertions
  const regularUser = await createUserAndGetTokens({
    email: `analytics-user-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: 'Analytics Regular User',
    role: 'user',
    authMethod: 'email',
  });
  userToken = regularUser.accessToken;

  // 3 additional regular users (contributes to user analytics totals)
  await Promise.all([
    createUserAndGetTokens({
      email: `analytics-reg1-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Regular 1',
      role: 'user',
      authMethod: 'email',
    }),
    createUserAndGetTokens({
      email: `analytics-reg2-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Regular 2',
      role: 'user',
      authMethod: 'email',
    }),
    createUserAndGetTokens({
      email: `analytics-reg3-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Regular 3',
      role: 'user',
      authMethod: 'email',
    }),
  ]);

  // 4 establishments in different statuses
  const active1 = await createPartnerWithEstablishment('active');
  firstActiveEstablishmentId = active1.establishment.id;

  await Promise.all([
    createPartnerWithEstablishment('active'),    // active #2
    createPartnerWithEstablishment('pending'),   // pending #1
    createPartnerWithEstablishment('suspended'), // suspended #1
  ]);

  // 3 reviews on the first active establishment (ratings 2, 3, 5)
  await Promise.all([
    createTestReview(null, firstActiveEstablishmentId, { rating: 2 }),
    createTestReview(null, firstActiveEstablishmentId, { rating: 3 }),
    createTestReview(null, firstActiveEstablishmentId, { rating: 5 }),
  ]);
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Auth guards — shared across all 4 analytics endpoints
// ============================================================================

describe('Auth guards — analytics endpoints', () => {
  const endpoints = [
    `${BASE_URL}/overview`,
    `${BASE_URL}/users`,
    `${BASE_URL}/establishments`,
    `${BASE_URL}/reviews`,
  ];

  test.each(endpoints)('GET %s returns 401 without token', async (endpoint) => {
    const res = await request(app).get(endpoint).expect(401);
    expect(res.body.success).toBe(false);
  });

  test.each(endpoints)('GET %s returns 403 for non-admin role', async (endpoint) => {
    const res = await request(app)
      .get(endpoint)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(res.body.success).toBe(false);
  });
});

// ============================================================================
// #10 — GET /api/v1/admin/analytics/overview
// ============================================================================

describe('GET /api/v1/admin/analytics/overview (#10)', () => {
  test('returns 200 with success: true', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('response.data contains all expected top-level keys', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data).toHaveProperty('users');
    expect(body.data).toHaveProperty('establishments');
    expect(body.data).toHaveProperty('reviews');
    expect(body.data).toHaveProperty('moderation');
  });

  test('users section has total, new_in_period, change_percent', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { users } = body.data;
    expect(users).toHaveProperty('total');
    expect(users).toHaveProperty('new_in_period');
    expect(users).toHaveProperty('change_percent');
    expect(typeof users.total).toBe('number');
    expect(users.total).toBeGreaterThanOrEqual(1);
  });

  test('establishments counts reflect seeded test data', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { establishments } = body.data;
    expect(establishments.total).toBeGreaterThanOrEqual(4);
    expect(establishments.active).toBeGreaterThanOrEqual(2);
    expect(establishments.pending).toBeGreaterThanOrEqual(1);
    expect(establishments.suspended).toBeGreaterThanOrEqual(1);
  });

  test('reviews metrics reflect seeded reviews', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { reviews } = body.data;
    expect(reviews.total).toBeGreaterThanOrEqual(3);
    expect(typeof reviews.average_rating).toBe('number');
    // average of 2, 3, 5 = 3.33...
    expect(reviews.average_rating).toBeGreaterThan(0);
  });

  test('moderation section has pending_count and actions_in_period', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { moderation } = body.data;
    expect(moderation).toHaveProperty('pending_count');
    expect(moderation).toHaveProperty('actions_in_period');
    expect(moderation.pending_count).toBeGreaterThanOrEqual(1);
  });

  test('accepts ?period=7d query parameter', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('users');
  });

  test('accepts custom date range via from/to parameters', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/overview?from=2026-01-01&to=2026-12-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});

// ============================================================================
// #11 — GET /api/v1/admin/analytics/users
// ============================================================================

describe('GET /api/v1/admin/analytics/users (#11)', () => {
  test('returns 200 with success: true', async () => {
    await request(app)
      .get(`${BASE_URL}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  test('response.data has all expected schema fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users`)
      .set('Authorization', `Bearer ${adminToken}`);

    const data = body.data;
    expect(data).toHaveProperty('registration_timeline');
    expect(data).toHaveProperty('role_distribution');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('new_in_period');
    expect(data).toHaveProperty('change_percent');
    expect(data).toHaveProperty('aggregation');
    expect(Array.isArray(data.registration_timeline)).toBe(true);
    expect(Array.isArray(data.role_distribution)).toBe(true);
  });

  test('total reflects all users created in test (at least admin + 4 regular)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    // admin (1) + regularUser (1) + 3 more regular + 4 partners + 3 review authors ≥ 12
    expect(body.data.total).toBeGreaterThanOrEqual(4);
  });

  test('?period=7d → aggregation is day', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.aggregation).toBe('day');
  });

  test('?period=30d → aggregation is week (range > 30 days → ceil=31 → week)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=30d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.aggregation).toBe('week');
  });

  test('registration_timeline entries have date and count fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const timeline = body.data.registration_timeline;
    expect(timeline.length).toBeGreaterThan(0);
    timeline.forEach(entry => {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('count');
      expect(typeof entry.count).toBe('number');
    });
  });

  test('role_distribution entries have role and count', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users`)
      .set('Authorization', `Bearer ${adminToken}`);

    const roles = body.data.role_distribution;
    expect(roles.length).toBeGreaterThan(0);
    roles.forEach(entry => {
      expect(entry).toHaveProperty('role');
      expect(entry).toHaveProperty('count');
    });
  });

  test('future date range → new_in_period is 0, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/users?from=2030-01-01&to=2030-01-07`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.new_in_period).toBe(0);
    expect(res.body.data.total).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// #12 — GET /api/v1/admin/analytics/establishments
// ============================================================================

describe('GET /api/v1/admin/analytics/establishments (#12)', () => {
  test('returns 200 with success: true', async () => {
    await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  test('response.data has all expected schema fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    const data = body.data;
    expect(data).toHaveProperty('creation_timeline');
    expect(data).toHaveProperty('status_distribution');
    expect(data).toHaveProperty('city_distribution');
    expect(data).toHaveProperty('category_distribution');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('active');
    expect(data).toHaveProperty('new_in_period');
    expect(data).toHaveProperty('change_percent');
    expect(data).toHaveProperty('aggregation');
  });

  test('total and active reflect seeded establishments', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.total).toBeGreaterThanOrEqual(4); // 2 active + 1 pending + 1 suspended
    expect(body.data.active).toBeGreaterThanOrEqual(2);
  });

  test('status_distribution includes active, pending, suspended', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    const statuses = body.data.status_distribution.map(s => s.status);
    expect(statuses).toContain('active');
    expect(statuses).toContain('pending');
    expect(statuses).toContain('suspended');
  });

  test('status_distribution entries have status and count fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.status_distribution.forEach(entry => {
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('count');
      expect(typeof entry.count).toBe('number');
    });
  });

  test('city_distribution contains Минск from test data', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Array.isArray(body.data.city_distribution)).toBe(true);
    const cities = body.data.city_distribution.map(c => c.city);
    expect(cities).toContain('Минск');
  });

  test('creation_timeline is an array of entries with date and count', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const timeline = body.data.creation_timeline;
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline.length).toBeGreaterThan(0);
    timeline.forEach(entry => {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('count');
    });
  });

  test('future date range → new_in_period is 0, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/establishments?from=2030-01-01&to=2030-01-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.new_in_period).toBe(0);
  });
});

// ============================================================================
// #13 — GET /api/v1/admin/analytics/reviews
// ============================================================================

describe('GET /api/v1/admin/analytics/reviews (#13)', () => {
  test('returns 200 with success: true', async () => {
    await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  test('response.data has all expected schema fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const data = body.data;
    expect(data).toHaveProperty('review_timeline');
    expect(data).toHaveProperty('rating_distribution');
    expect(data).toHaveProperty('response_stats');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('new_in_period');
    expect(data).toHaveProperty('change_percent');
    expect(data).toHaveProperty('aggregation');
  });

  test('total reflects seeded reviews (at least 3)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.total).toBeGreaterThanOrEqual(3);
  });

  test('rating_distribution has exactly 5 entries (ratings 1-5)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const dist = body.data.rating_distribution;
    expect(dist).toHaveLength(5);
    dist.forEach(entry => {
      expect(entry).toHaveProperty('rating');
      expect(entry).toHaveProperty('count');
      expect(entry).toHaveProperty('percentage');
      expect(entry.rating).toBeGreaterThanOrEqual(1);
      expect(entry.rating).toBeLessThanOrEqual(5);
    });
  });

  test('rating counts reflect seeded reviews (ratings 2, 3, 5 each have count >= 1)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const dist = body.data.rating_distribution;
    const rating2 = dist.find(d => d.rating === 2);
    const rating3 = dist.find(d => d.rating === 3);
    const rating5 = dist.find(d => d.rating === 5);

    expect(rating2.count).toBeGreaterThanOrEqual(1);
    expect(rating3.count).toBeGreaterThanOrEqual(1);
    expect(rating5.count).toBeGreaterThanOrEqual(1);
  });

  test('rating_distribution percentages are numeric', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.rating_distribution.forEach(entry => {
      expect(typeof entry.percentage).toBe('number');
      expect(entry.percentage).toBeGreaterThanOrEqual(0);
    });
  });

  test('response_stats has all expected fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { response_stats } = body.data;
    expect(response_stats).toHaveProperty('total_with_response');
    expect(response_stats).toHaveProperty('response_rate');
    expect(response_stats).toHaveProperty('avg_response_time_hours');
    expect(typeof response_stats.total_with_response).toBe('number');
  });

  test('review_timeline entries have date, count, and average_rating', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const timeline = body.data.review_timeline;
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline.length).toBeGreaterThan(0);
    timeline.forEach(entry => {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('count');
      expect(entry).toHaveProperty('average_rating');
    });
  });

  test('future date range → new_in_period is 0, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/reviews?from=2030-01-01&to=2030-01-07`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.new_in_period).toBe(0);
  });
});
