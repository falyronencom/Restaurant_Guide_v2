/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Reviews System Integration Tests
 *
 * Tests comprehensive review functionality:
 * - Create review (authenticated, rating 1-5)
 * - Read reviews (public, pagination, sorting)
 * - Update review (author only)
 * - Delete review (soft deletion)
 * - One review per user per establishment (UNIQUE constraint)
 * - Daily quota enforcement (10 reviews/day via Redis)
 * - Establishment metrics update (average_rating, review_count)
 * - Partner responses
 * - Review ownership verification
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query, countRecords } from '../utils/database.js';
import { createUserAndGetTokens, createTestEstablishment, createPartnerAndGetToken } from '../utils/auth.js';
import redisClient, { connectRedis, deleteKey } from '../../config/redis.js';
import { testUsers } from '../fixtures/users.js';

let userToken;
let user2Token;
let partnerToken;
let userId;
let user2Id;
let partnerId;
let establishmentId;
let redisReady = false;

const rateLimitKeyFor = (user) => `reviews:ratelimit:${user}`;

// Default working hours for test establishments
const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' }
});

const longContent = 'Достаточно длинный и содержательный отзыв длиной более двадцати символов.';

beforeAll(async () => {
  // Create test users
  const user = await createUserAndGetTokens(testUsers.regularUser);
  const user2 = await createUserAndGetTokens(testUsers.regularUser2);
  const partner = await createUserAndGetTokens(testUsers.partner);

  userToken = user.accessToken;
  user2Token = user2.accessToken;
  partnerToken = partner.accessToken;
  userId = user.user.id;
  user2Id = user2.user.id;
  partnerId = partner.user.id;
});

beforeEach(async () => {
  // Clear reviews and establishments
  await query('TRUNCATE TABLE reviews CASCADE');
  await query('TRUNCATE TABLE establishments CASCADE');

  // Create test establishment
  const defaultWorkingHours = JSON.stringify({
    monday: { open: '10:00', close: '22:00' },
    tuesday: { open: '10:00', close: '22:00' },
    wednesday: { open: '10:00', close: '22:00' },
    thursday: { open: '10:00', close: '22:00' },
    friday: { open: '10:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '22:00' }
  });

  const result = await query(`
    INSERT INTO establishments (
      id, partner_id, name, description, city, address,
      latitude, longitude, categories, cuisines, status,
      average_rating, review_count, working_hours, price_range, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), $1, 'Test Restaurant', 'Great food',
      'Минск', 'Test Address', 53.9, 27.5,
      ARRAY['Ресторан'], ARRAY['Европейская'], 'active',
      NULL, 0, $2::jsonb, '$$', NOW(), NOW()
    )
    RETURNING id
  `, [partnerId, defaultWorkingHours]);

  establishmentId = result.rows[0].id;
});

afterAll(async () => {
  await clearAllData();
});

describe('Reviews System - Create Review', () => {
  test('should create review with valid data', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: longContent
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.review).toBeDefined();

    const review = response.body.data.review;
    expect(review.rating).toBe(5);
    expect(review.content).toBe(longContent);
    expect(review.user_id).toBe(userId);
    expect(review.establishment_id).toBe(establishmentId);
    expect(review.id).toBeDefined();
  });

  test('should accept ratings 1-5', async () => {
    for (let rating = 1; rating <= 5; rating++) {
      // Clear previous review
      await query('TRUNCATE TABLE reviews CASCADE');

      const response = await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          establishmentId,
          rating,
          content: `${longContent} rating-${rating}`
        })
        .expect(201);

      expect(response.body.data.review.rating).toBe(rating);
    }
  });

  test('should reject rating 0', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 0,
        content: 'Invalid rating'
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject rating 6', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 6,
        content: 'Invalid rating'
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject non-integer rating', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 3.5,
        content: 'Invalid rating'
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject missing content', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject empty content', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: ''
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject review without authentication', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .send({
        establishmentId,
        rating: 5,
        content: longContent
      })
      .expect(401);

    expect(response.body.error.code).toBe('MISSING_TOKEN');
  });

  test('should reject review for non-existent establishment', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId: '00000000-0000-0000-0000-000000000000',
        rating: 5,
        content: longContent
      })
      .expect(404);

    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should handle Russian/Belarusian text in content', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: longContent // Contains Cyrillic equivalent length
      })
      .expect(201);

    expect(response.body.data.review.content).toBe(longContent);
  });
});

describe('Reviews System - One Review Per User Per Establishment', () => {
  test('should allow first review for establishment', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: `${longContent} first`
      })
      .expect(201);

    expect(response.body.data.review).toBeDefined();
  });

  test('should reject second review from same user for same establishment', async () => {
    // Create first review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: `${longContent} first`
      })
      .expect(201);

    // Try to create second review
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 4,
        content: `${longContent} second-fail`
      })
      .expect(409);

    expect(response.body.error.code).toBe('DUPLICATE_REVIEW');
  });

  test('should allow different users to review same establishment', async () => {
    // User 1 creates review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: `${longContent} user1`
      })
      .expect(201);

    // User 2 creates review (should succeed)
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        establishmentId,
        rating: 3,
        content: `${longContent} user2`
      })
      .expect(201);

    expect(response.body.data.review.user_id).toBe(user2Id);
  });

  test('should allow same user to review different establishments', async () => {
    // Create second establishment
    const result = await query(`
      INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, average_rating, review_count, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Second Restaurant', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NULL, 0, NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours]);
    const establishment2Id = result.rows[0].id;

    // Review first establishment
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: `${longContent} establishment1`
      })
      .expect(201);

    // Review second establishment (should succeed)
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId: establishment2Id,
        rating: 4,
        content: `${longContent} establishment2`
      })
      .expect(201);

    expect(response.body.data.review).toBeDefined();
  });
});

describe('Reviews System - Establishment Metrics Update', () => {
  test('should initialize metrics on first review', async () => {
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: `${longContent} metrics1`
      })
      .expect(201);

    // Check establishment metrics
    const result = await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(parseFloat(result.rows[0].average_rating)).toBeCloseTo(5.0);
    expect(result.rows[0].review_count).toBe(1);
  });

  test('should update average rating correctly (2 reviews)', async () => {
    // User 1: 5 stars
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: `${longContent} great` })
      .expect(201);

    // User 2: 3 stars
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 3, content: `${longContent} ok` })
      .expect(201);

    // Check metrics: (5+3)/2 = 4.0
    const result = await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(parseFloat(result.rows[0].average_rating)).toBeCloseTo(4.0);
    expect(result.rows[0].review_count).toBe(2);
  });

  test('should increment review count correctly', async () => {
    // Create 3 reviews from different users
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: `${longContent} r1` })
      .expect(201);

    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 4, content: `${longContent} r2` })
      .expect(201);

    // Create third user for third review
    const user3 = await createUserAndGetTokens({
      ...testUsers.regularUser,
      email: 'user3@test.com',
      phone: '+375295555555'
    });

    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user3.accessToken}`)
      .send({ establishmentId, rating: 3, content: `${longContent} r3` })
      .expect(201);

    // Check count
    const result = await query(
      'SELECT review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(result.rows[0].review_count).toBe(3);
  });
});

describe('Reviews System - Read Reviews', () => {
  beforeEach(async () => {
    // Create test reviews directly to avoid rate limits/validation drift
    await query(
      `INSERT INTO reviews (id, user_id, establishment_id, rating, content, text, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 5, $3, $3, NOW(), NOW())`,
      [userId, establishmentId, `${longContent} excellent`]
    );

    await query(
      `INSERT INTO reviews (id, user_id, establishment_id, rating, content, text, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 3, $3, $3, NOW(), NOW())`,
      [user2Id, establishmentId, `${longContent} ok`]
    );
  });

  test('should get review by ID (public)', async () => {
    const reviews = await query('SELECT id FROM reviews LIMIT 1');
    const reviewId = reviews.rows[0].id;

    const response = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .expect(200);

    expect(response.body.data.review).toBeDefined();
    expect(response.body.data.review.id).toBe(reviewId);
  });

  test('should list reviews for establishment', async () => {
    const response = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.reviews.length).toBeGreaterThanOrEqual(2);
  });

  test('should paginate reviews', async () => {
    // Create more reviews
    for (let i = 0; i < 15; i++) {
      const user = await createUserAndGetTokens({
        ...testUsers.regularUser,
        email: `user${i}-${Date.now()}@test.com`,
        phone: `+37529${String(i + 1000000).padStart(7, '0')}`
      });

      await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ establishmentId, rating: 4, content: `Review ${i} content goes here and is long enough.` })
        .expect(201);
    }

    // Get page 1
    const page1 = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?page=1&limit=10`)
      .expect(200);

    expect(page1.body.data.pagination.page).toBe(1);
    expect(page1.body.data.reviews.length).toBe(10);

    // Get page 2
    const page2 = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?page=2&limit=10`)
      .expect(200);

    expect(page2.body.data.pagination.page).toBe(2);
    expect(page2.body.data.reviews.length).toBeGreaterThan(0);
  });

  test('should sort reviews by newest', async () => {
    const response = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?sort=newest`)
      .expect(200);

    const { reviews } = response.body.data;
    const timestamps = reviews.map(r => new Date(r.created_at).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });

  test('should sort reviews by highest rating', async () => {
    const response = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?sort=highest`)
      .expect(200);

    const ratings = response.body.data.reviews.map(r => r.rating);
    const sorted = [...ratings].sort((a, b) => b - a);
    expect(ratings).toEqual(sorted);
  });
});

describe('Reviews System - Update Review', () => {
  let reviewId;

  beforeEach(async () => {
    const inserted = await query(
      `INSERT INTO reviews (id, user_id, establishment_id, rating, content, text, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 5, $3, $3, NOW(), NOW())
       RETURNING id`,
      [userId, establishmentId, `${longContent} original`]
    );

    reviewId = inserted.rows[0].id;
  });

  test('should update own review', async () => {
    const response = await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        rating: 4,
        content: `${longContent} updated`
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.review.rating).toBe(4);
    expect(response.body.data.review.content).toContain('updated');
    expect(response.body.data.review.is_edited).toBe(true);
  });

  test('should reject updating other user review', async () => {
    const response = await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        rating: 1,
        content: `${longContent} other`
      })
      .expect(403);

    expect(response.body.error.code).toBe('UNAUTHORIZED_REVIEW_MODIFICATION');
  });

  test('should recalculate metrics after update', async () => {
    // Create second review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 3, content: 'Second review content goes here' })
      .expect(201);

    // Current avg: (5+3)/2 = 4.0

    // Update first review to 1
    await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rating: 1, content: `${longContent} changed` })
      .expect(200);

    const metrics = await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(parseFloat(metrics.rows[0].average_rating)).toBeCloseTo(2.0);
    expect(metrics.rows[0].review_count).toBe(2);
  });
});

describe('Reviews System - Delete Review', () => {
  let reviewId;

  beforeEach(async () => {
    const inserted = await query(
      `INSERT INTO reviews (id, user_id, establishment_id, rating, content, text, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 5, $3, $3, NOW(), NOW())
       RETURNING id`,
      [userId, establishmentId, `${longContent} to delete`]
    );

    reviewId = inserted.rows[0].id;
  });

  test('should soft delete own review', async () => {
    const response = await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toMatch(/deleted successfully/i);
  });

  test('should not show deleted review in list', async () => {
    await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const listResponse = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    const ids = listResponse.body.data.reviews.map(r => r.id);
    expect(ids).not.toContain(reviewId);
  });

  test('should reject deleting other user review', async () => {
    const response = await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);

    expect(response.body.error.code).toBe('UNAUTHORIZED_REVIEW_DELETION');
  });

  test('should update metrics after deletion', async () => {
    // Create second review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 3, content: 'Second review for metrics' })
      .expect(201);

    // Current: avg=4.0, count=2

    // Delete first review
    await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const metrics = await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(parseFloat(metrics.rows[0].average_rating)).toBeCloseTo(3.0);
    expect(metrics.rows[0].review_count).toBe(1);
  });
});

describe('Reviews System - Daily Quota', () => {
  const createUniqueEstablishment = async () => {
    const establishment = await createTestEstablishment(partnerId);
    return establishment.id;
  };

  const submitReview = (token, estId, suffix) => {
    return request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        establishmentId: estId,
        rating: 5,
        content: `${longContent} ${suffix}`
      });
  };

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      redisReady = await connectRedis();
    } else {
      redisReady = true;
    }

    if (!redisReady) {
      throw new Error('Redis connection is required for quota enforcement tests');
    }
  });

  beforeEach(async () => {
    if (!redisReady) return;

    await Promise.all([
      deleteKey(rateLimitKeyFor(userId)),
      deleteKey(rateLimitKeyFor(user2Id))
    ]);
  });

  afterAll(async () => {
    if (!redisReady) return;

    await Promise.all([
      deleteKey(rateLimitKeyFor(userId)),
      deleteKey(rateLimitKeyFor(user2Id))
    ]);
  });

  test('should allow 10 reviews in one day', async () => {
    for (let i = 0; i < 10; i++) {
      const estId = await createUniqueEstablishment();
      const response = await submitReview(userToken, estId, `within-quota-${i}`).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.review.user_id).toBe(userId);
    }

    const reviewCount = await countRecords('reviews', 'WHERE user_id = $1', [userId]);
    expect(reviewCount).toBe(10);
  });

  test('should reject 11th review (quota exceeded)', async () => {
    for (let i = 0; i < 10; i++) {
      const estId = await createUniqueEstablishment();
      await submitReview(userToken, estId, `quota-fill-${i}`).expect(201);
    }

    const overflowEstablishmentId = await createUniqueEstablishment();
    const response = await submitReview(userToken, overflowEstablishmentId, 'over-quota').expect(429);

    expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    const message = response.body.message || response.body.error?.message || '';
    expect(message.toLowerCase()).toContain('limit');
  });

  test('should reset quota at midnight', async () => {
    for (let i = 0; i < 10; i++) {
      const estId = await createUniqueEstablishment();
      await submitReview(userToken, estId, `pre-reset-${i}`).expect(201);
    }

    // Move existing reviews to "yesterday" to simulate prior-day activity
    await query('UPDATE reviews SET created_at = NOW() - INTERVAL \'1 day\', updated_at = created_at');

    // Simulate rate limit window expiration (midnight reset) by clearing the Redis counter
    await deleteKey(rateLimitKeyFor(userId));

    const newDayEstablishmentId = await createUniqueEstablishment();
    const response = await submitReview(userToken, newDayEstablishmentId, 'post-reset').expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.review.user_id).toBe(userId);

    const totalReviews = await countRecords('reviews', 'WHERE user_id = $1', [userId]);
    expect(totalReviews).toBe(11);
  });

  test('should track quota per user independently', async () => {
    for (let i = 0; i < 10; i++) {
      const estId = await createUniqueEstablishment();
      await submitReview(userToken, estId, `user1-${i}`).expect(201);
    }

    const userBEstablishmentId = await createUniqueEstablishment();
    const userBResponse = await submitReview(user2Token, userBEstablishmentId, 'user2-first').expect(201);

    expect(userBResponse.body.success).toBe(true);
    expect(userBResponse.body.data.review.user_id).toBe(user2Id);

    const blockedResponse = await submitReview(userToken, await createUniqueEstablishment(), 'user1-blocked').expect(429);
    expect(blockedResponse.body.error.code).toBe('RATE_LIMIT_EXCEEDED');

    const user1Reviews = await countRecords('reviews', 'WHERE user_id = $1', [userId]);
    const user2Reviews = await countRecords('reviews', 'WHERE user_id = $1', [user2Id]);
    expect(user1Reviews).toBe(10);
    expect(user2Reviews).toBe(1);
  });
});

describe('Reviews System - Partner Responses', () => {
  const responseText = 'Спасибо за ваш отзыв! Мы ценим обратную связь.';

  const createReview = async (token = userToken, contentSuffix = 'base') => {
    const reviewResponse = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        establishmentId,
        rating: 5,
        content: `${longContent} ${contentSuffix}`,
      })
      .expect(201);

    return reviewResponse.body.data.review.id;
  };

  test('should allow partner to respond to review on their establishment', async () => {
    const reviewId = await createReview(userToken, 'partner-responds');

    const response = await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ response: responseText })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.review.partner_response).toBe(responseText);
    expect(response.body.data.review.partner_responder_id).toBe(partnerId);

    const detail = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .expect(200);

    expect(detail.body.data.review.partner_response).toBe(responseText);
    expect(detail.body.data.review.partner_responder_id).toBe(partnerId);
  });

  test('should reject partner responding to review on other establishment', async () => {
    const otherPartner = await createPartnerAndGetToken();
    const reviewId = await createReview(userToken, 'other-partner');

    const response = await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${otherPartner.token}`)
      .send({ response: responseText })
      .expect(403);

    expect(response.body.error.code).toBe('UNAUTHORIZED_PARTNER_RESPONSE');

    const detail = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .expect(200);

    expect(detail.body.data.review.partner_response).toBeNull();
  });

  test('should reject regular user adding partner response', async () => {
    const reviewId = await createReview(userToken, 'regular-user-response');

    const response = await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ response: responseText })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');

    const detail = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .expect(200);

    expect(detail.body.data.review.partner_response).toBeNull();
  });

  test('should update existing response when partner responds again', async () => {
    const reviewId = await createReview(userToken, 'update-response');

    await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ response: responseText })
      .expect(200);

    const updatedText = 'Обновлённый ответ партнёра на отзыв.';

    const response = await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ response: updatedText })
      .expect(200);

    expect(response.body.data.review.partner_response).toBe(updatedText);
    expect(response.body.data.review.partner_responder_id).toBe(partnerId);
  });

  test('should delete partner response', async () => {
    const reviewId = await createReview(userToken, 'delete-response');

    await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ response: responseText })
      .expect(200);

    const deleteResponse = await request(app)
      .delete(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    expect(deleteResponse.body.data.review.partner_response).toBeNull();

    const detail = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .expect(200);

    expect(detail.body.data.review.partner_response).toBeNull();
  });

  test('should include partner_response in review details', async () => {
    const reviewId = await createReview(userToken, 'detail-response');

    await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ response: responseText })
      .expect(200);

    const detail = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .expect(200);

    expect(detail.body.data.review.partner_response).toBe(responseText);
    expect(detail.body.data.review.partner_responder_id).toBe(partnerId);
    expect(detail.body.data.review.partner_response_at).toBeTruthy();
  });
});
