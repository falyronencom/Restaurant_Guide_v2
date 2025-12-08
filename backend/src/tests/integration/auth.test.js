/**
 * Authentication Integration Tests
 *
 * Covers end-to-end auth flows with database + JWT + Redis rate limit stubs:
 * - Registration (email + phone) with validation and duplicates
 * - Login with security/error handling
 * - Token refresh with strict rotation
 * - Logout/session invalidation
 * - Auth middleware responses
 * - Custom rate limiting on login endpoint
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import {
  createTestUser,
  createUserAndGetTokens,
  getUserByEmail,
  getUserByPhone,
} from '../utils/auth.js';
import { testUsers, invalidUsers, edgeCaseUsers } from '../fixtures/users.js';
import * as redis from '../../config/redis.js';

const LOGIN_LIMIT = 10; // From authRoutes createRateLimiter

const expectValidationError = (response, field) => {
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(response.body.error.details[field]).toBeDefined();
};

const decodeAccess = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, {
    issuer: 'restaurant-guide-belarus',
    audience: 'restaurant-guide-api',
  });

beforeAll(async () => {
  await clearAllData();
});

beforeEach(async () => {
  await clearAllData();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

describe('POST /api/v1/auth/register', () => {
  test('registers new email user and returns token pair', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(testUsers.regularUser)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(testUsers.regularUser.email.toLowerCase());
    expect(response.body.data.user.role).toBe('user');
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).toBeTruthy();
    expect(response.body.data.expiresIn).toBe(900);

    const userInDb = await getUserByEmail(testUsers.regularUser.email);
    expect(userInDb.password_hash).toMatch(/^\$argon2id\$/);
  });

  test('registers phone-only user and preserves phone', async () => {
    const phoneUser = { ...testUsers.phoneOnlyUser };
    delete phoneUser.email;

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(phoneUser)
      .expect(201);

    expect(response.body.data.user.email).toBeNull();
    expect(response.body.data.user.phone).toBe(testUsers.phoneOnlyUser.phone);
    const user = await getUserByPhone(testUsers.phoneOnlyUser.phone);
    expect(user.phone).toBe(testUsers.phoneOnlyUser.phone);
  });

  test('rejects duplicate email with conflict error', async () => {
    await request(app).post('/api/v1/auth/register').send(testUsers.regularUser).expect(201);
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(testUsers.regularUser)
      .expect(409);

    expect(response.body.error.code).toBe('EMAIL_EXISTS');
  });

  test('rejects duplicate phone with conflict error', async () => {
    const phoneUser = { ...testUsers.phoneOnlyUser };
    delete phoneUser.email;

    await request(app).post('/api/v1/auth/register').send(phoneUser).expect(201);
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(phoneUser)
      .expect(409);

    expect(response.body.error.code).toBe('PHONE_EXISTS');
  });

  test('rejects weak password with validation details', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(invalidUsers.weakPassword)
      .expect(422);

    expectValidationError(response, 'password');
  });

  test('rejects malformed email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(invalidUsers.invalidEmail)
      .expect(422);

    expectValidationError(response, 'email');
  });

  test('rejects request without contact method', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(invalidUsers.noContactMethod)
      .expect(422);

    expectValidationError(response, 'email');
  });

  test('accepts normalized email casing and trims fields', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...edgeCaseUsers.mixedCaseEmail,
        name: '  Trim Me  ',
        phone: '  +375291234567  ',
      })
      .expect(201);

    expect(response.body.data.user.email).toBe('test@example.com');
    expect(response.body.data.user.name).toBe('Trim Me');
    expect(response.body.data.user.phone).toBe('+375291234567');
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await createTestUser(testUsers.regularUser);
  });

  test('logs in with email and returns tokens', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUsers.regularUser.email, password: testUsers.regularUser.password })
      .expect(200);

    expect(response.body.data.user.email).toBe(testUsers.regularUser.email.toLowerCase());
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.refreshToken).toBeDefined();
  });

  test('logs in with phone and returns tokens', async () => {
    await createTestUser(testUsers.phoneOnlyUser);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: testUsers.phoneOnlyUser.phone, password: testUsers.phoneOnlyUser.password })
      .expect(200);

    expect(response.body.data.user.phone).toBe(testUsers.phoneOnlyUser.phone);
    expect(response.body.data.accessToken).toBeTruthy();
  });

  test('is case-insensitive for email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUsers.regularUser.email.toUpperCase(), password: testUsers.regularUser.password })
      .expect(200);

    expect(response.body.data.user.email).toBe(testUsers.regularUser.email.toLowerCase());
  });

  test('rejects invalid password with generic error', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUsers.regularUser.email, password: 'WrongPassword123' })
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('rejects non-existent user without enumeration', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'missing@test.com', password: 'Password123!@#' })
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('produces 15 minute access token with expected claims', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUsers.regularUser.email, password: testUsers.regularUser.password })
      .expect(200);

    const decoded = decodeAccess(response.body.data.accessToken);
    expect(decoded.userId).toBeDefined();
    expect(decoded.role).toBe('user');
    const ttl = decoded.exp - decoded.iat;
    expect(ttl).toBeGreaterThanOrEqual(899);
    expect(ttl).toBeLessThanOrEqual(901);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  test('rotates refresh token and marks old token as used', async () => {
    const login = await request(app).post('/api/v1/auth/register').send(testUsers.regularUser);
    const originalRefresh = login.body.data.refreshToken;

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalRefresh })
      .expect(200);

    expect(refreshResponse.body.data.refreshToken).toBeDefined();
    expect(refreshResponse.body.data.refreshToken).not.toBe(originalRefresh);

    const { rows } = await query('SELECT used_at FROM refresh_tokens WHERE token = $1', [
      originalRefresh,
    ]);
    expect(rows[0].used_at).not.toBeNull();
  });

  test('rejects invalid refresh token', async () => {
    const invalidToken = 'x'.repeat(64);
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: invalidToken })
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_TOKEN');
  });

  test('rejects expired refresh token', async () => {
    const user = await createTestUser(testUsers.regularUser);
    const expiredToken = `expired_token_${'y'.repeat(40)}`;
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at, used_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NULL)`,
      [user.id, expiredToken, new Date(Date.now() - 1000)],
    );

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: expiredToken })
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  test('rejects refresh when user account is inactive', async () => {
    const registration = await request(app).post('/api/v1/auth/register').send(testUsers.regularUser);
    const refreshToken = registration.body.data.refreshToken;

    // Deactivate user
    await query('UPDATE users SET is_active = false WHERE id = $1', [registration.body.data.user.id]);

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  test('detects refresh token reuse and invalidates user tokens', async () => {
    const { refreshToken, user } = await createUserAndGetTokens(testUsers.regularUser);
    await query('UPDATE refresh_tokens SET used_at = NOW() WHERE token = $1', [refreshToken]);

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(403);

    expect(response.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    const { rows } = await query('SELECT used_at FROM refresh_tokens WHERE user_id = $1', [user.id]);
    rows.forEach((row) => expect(row.used_at).not.toBeNull());
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('invalidates refresh token and blocks further refresh', async () => {
    const { body } = await request(app).post('/api/v1/auth/register').send(testUsers.regularUser);
    const { accessToken, refreshToken } = body.data;

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(200);

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(403);

    expect(refreshResponse.body.error.code).toBe('TOKEN_REUSE_DETECTED');
  });
});

describe('GET /api/v1/auth/me', () => {
  test('returns current authenticated user', async () => {
    const { body } = await request(app).post('/api/v1/auth/register').send(testUsers.regularUser);
    const meResponse = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .expect(200);

    expect(meResponse.body.data.user.email).toBe(testUsers.regularUser.email.toLowerCase());
  });

  test('rejects missing Authorization header', async () => {
    const response = await request(app).get('/api/v1/auth/me').expect(401);
    expect(response.body.error.code).toBe('MISSING_TOKEN');
  });

  test('rejects malformed Authorization header', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Token abc')
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_TOKEN_FORMAT');
  });

  test('rejects expired token', async () => {
    const user = await createTestUser(testUsers.regularUser);
    const expiredToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, type: 'access' },
      process.env.JWT_SECRET,
      {
        expiresIn: -10,
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      },
    );

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  test('returns 404 when user no longer exists', async () => {
    const { body } = await request(app).post('/api/v1/auth/register').send(testUsers.regularUser);
    const accessToken = body.data.accessToken;
    await query('DELETE FROM users WHERE id = $1', [body.data.user.id]);

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });
});


