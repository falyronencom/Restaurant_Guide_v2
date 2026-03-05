/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Media Management System Integration Tests
 *
 * Tests all media management endpoints and business logic:
 * - Upload media with Cloudinary integration (mocked)
 * - Tier-based upload limits (free, basic, standard, premium)
 * - Media listing and filtering
 * - Primary photo management
 * - Media update and deletion
 * - Ownership verification
 * - File validation
 */

import fs from 'fs';
import request from 'supertest';
import { jest } from '@jest/globals';
import { clearAllData } from '../utils/database.js';
import { createPartnerAndGetToken, createTestEstablishment } from '../utils/auth.js';

// Mock Cloudinary for ES modules — all 7 exports + default
let app;
let pool;
let cloudinary;

jest.unstable_mockModule('../../config/cloudinary.js', () => ({
  uploadImage: jest.fn(async () => ({
    public_id: 'test-public-id',
    secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
    width: 800,
    height: 600,
    format: 'jpg',
  })),
  generateAllResolutions: jest.fn(() => ({
    url: 'https://res.cloudinary.com/test/image/upload/w_1920,h_1080,c_limit/test-public-id.jpg',
    thumbnail_url: 'https://res.cloudinary.com/test/image/upload/w_200,h_150,c_fill/test-public-id.jpg',
    preview_url: 'https://res.cloudinary.com/test/image/upload/w_800,h_600,c_fit/test-public-id.jpg',
  })),
  generateImageUrl: jest.fn(() => 'https://res.cloudinary.com/test/image/upload/test-public-id.jpg'),
  deleteImage: jest.fn(async () => ({ result: 'ok' })),
  extractPublicIdFromUrl: jest.fn(() => 'test-public-id'),
  isValidImageType: jest.fn(() => true),
  isValidImageSize: jest.fn(() => true),
  default: {},
}));

// Setup and teardown
beforeAll(async () => {
  // Ensure multer upload directory exists
  fs.mkdirSync('backend/tmp/uploads', { recursive: true });

  const appModule = await import('../../server.js');
  app = appModule.default || appModule.app;
  const poolModule = await import('../../config/database.js');
  pool = poolModule.default;
  cloudinary = await import('../../config/cloudinary.js');
});

beforeEach(async () => {
  await clearAllData();

  if (cloudinary) {
    cloudinary.uploadImage.mockResolvedValue({
      public_id: 'test-public-id',
      secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
      width: 800,
      height: 600,
      format: 'jpg',
    });
    cloudinary.generateAllResolutions.mockReturnValue({
      url: 'https://res.cloudinary.com/test/image/upload/w_1920,h_1080,c_limit/test-public-id.jpg',
      thumbnail_url: 'https://res.cloudinary.com/test/image/upload/w_200,h_150,c_fill/test-public-id.jpg',
      preview_url: 'https://res.cloudinary.com/test/image/upload/w_800,h_600,c_fit/test-public-id.jpg',
    });
    cloudinary.generateImageUrl.mockReturnValue('https://res.cloudinary.com/test/image/upload/test-public-id.jpg');
    cloudinary.deleteImage.mockResolvedValue({ result: 'ok' });
    cloudinary.extractPublicIdFromUrl.mockReturnValue('test-public-id');
    cloudinary.isValidImageType.mockReturnValue(true);
    cloudinary.isValidImageSize.mockReturnValue(true);
  }
});

afterAll(async () => {
  await clearAllData();
  if (pool) {
    await pool.end();
  }
});

describe('Media System - Upload Operations', () => {
  let partner;
  let partnerToken;
  let establishment;

  beforeEach(async () => {
    const partnerData = await createPartnerAndGetToken();
    partner = partnerData.partner;
    partnerToken = partnerData.token;

    establishment = await createTestEstablishment(partner.id);
  });

  describe('POST /api/v1/partner/establishments/:id/media - Upload Media', () => {
    test('should upload interior photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('caption', 'Main dining area')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.type).toBe('interior');
      expect(response.body.data.caption).toBe('Main dining area');
      expect(response.body.data.url).toContain('cloudinary.com');
      expect(response.body.data.thumbnail_url).toBeDefined();
      expect(response.body.data.preview_url).toBeDefined();
    });

    test('should upload menu photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .field('caption', 'Main menu page 1')
        .attach('file', Buffer.from('fake image'), 'menu.jpg')
        .expect(201);

      expect(response.body.data.type).toBe('menu');
    });

    test('should upload exterior photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'exterior')
        .attach('file', Buffer.from('fake image'), 'exterior.jpg')
        .expect(201);

      expect(response.body.data.type).toBe('exterior');
    });

    test('should upload dishes photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'dishes')
        .attach('file', Buffer.from('fake image'), 'dish.jpg')
        .expect(201);

      expect(response.body.data.type).toBe('dishes');
    });

    test('should reject invalid media type', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'invalid-type')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(422);

      // Caught by express-validator before reaching service
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject upload without authentication', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(401);
    });

    test('should reject upload to other partner\'s establishment', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(404);
    });

    test('should reject invalid file type', async () => {
      // Multer fileFilter rejects non-image MIME types (detected from extension)
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake pdf'), 'document.pdf')
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('should reject file exceeding size limit', async () => {
      // Mock service-level size check to reject (use small buffer to avoid multer limit)
      cloudinary.isValidImageSize.mockReturnValueOnce(false);

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'huge.jpg')
        .expect(422);

      expect(response.body.error.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('Tier-Based Upload Limits', () => {
    test('FREE tier: should allow 10 interior photos', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      const mediaList = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(mediaList.body.data).toHaveLength(10);
    });

    test('FREE tier: should reject 11th interior photo', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image 11'), 'test-11.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');
    });

    test('FREE tier: should allow 10 menu photos separately from interior', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`interior ${i}`), `interior-${i}.jpg`)
          .expect(201);
      }

      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'menu')
          .attach('file', Buffer.from(`menu ${i}`), `menu-${i}.jpg`)
          .expect(201);
      }

      const mediaList = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(mediaList.body.data).toHaveLength(20);
    });

    test('PREMIUM tier: should allow 30 interior photos', async () => {
      await pool.query(
        'UPDATE establishments SET subscription_tier = $1 WHERE id = $2',
        ['premium', establishment.id]
      );

      for (let i = 0; i < 30; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      const mediaList = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(mediaList.body.data).toHaveLength(30);
    });

    test('PREMIUM tier: should reject 31st interior photo', async () => {
      await pool.query(
        'UPDATE establishments SET subscription_tier = $1 WHERE id = $2',
        ['premium', establishment.id]
      );

      for (let i = 0; i < 30; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image 31'), 'test-31.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');
    });

    test('exterior and dishes types use interior limit independently', async () => {
      // Per-type counting: each type gets its own count against the interior limit (10).
      // Upload 10 exterior (at limit)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'exterior')
          .attach('file', Buffer.from(`exterior ${i}`), `exterior-${i}.jpg`)
          .expect(201);
      }

      // 11th exterior should fail
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'exterior')
        .attach('file', Buffer.from('exterior extra'), 'exterior-extra.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      // But dishes should still be allowed (separate count)
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'dishes')
        .attach('file', Buffer.from('dishes 1'), 'dishes-1.jpg')
        .expect(201);
    });
  });

  describe('GET /api/v1/partner/establishments/:id/media - List Media', () => {
    test('should list all media for establishment', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 1'), 'photo1.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 2'), 'photo2.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('menu 1'), 'menu1.jpg')
        .expect(201);

      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(3);
    });

    test('should filter media by type', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('interior'), 'interior.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('menu'), 'menu.jpg')
        .expect(201);

      const interiorResponse = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media?type=interior`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(interiorResponse.body.data).toHaveLength(1);
      expect(interiorResponse.body.data[0].type).toBe('interior');

      const menuResponse = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media?type=menu`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(menuResponse.body.data).toHaveLength(1);
      expect(menuResponse.body.data[0].type).toBe('menu');
    });

    test('should return empty array for establishment with no media', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
    });

    test('should reject access to other partner\'s media', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .expect(404);
    });
  });

  describe('Primary Photo Management', () => {
    test('should set photo as primary on upload', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('primary photo'), 'primary.jpg')
        .expect(201);

      expect(response.body.data.is_primary).toBe(true);
    });

    test('should have only one primary photo', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first primary'), 'first.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('second primary'), 'second.jpg')
        .expect(201);

      const result = await pool.query(
        'SELECT COUNT(*) as count FROM establishment_media WHERE establishment_id = $1 AND is_primary = true',
        [establishment.id]
      );

      expect(parseInt(result.rows[0].count)).toBe(1);
    });

    test('should update primary photo when existing primary is deleted', async () => {
      const first = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first'), 'first.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('second'), 'second.jpg')
        .expect(201);

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${first.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      const result = await pool.query(
        'SELECT COUNT(*) as count FROM establishment_media WHERE establishment_id = $1 AND is_primary = true',
        [establishment.id]
      );

      expect(parseInt(result.rows[0].count)).toBe(1);
    });

    test('should sync primary_image_url on upload with is_primary=true', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('primary photo'), 'primary.jpg')
        .expect(201);

      const estResult = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      expect(estResult.rows[0].primary_image_url).toBeTruthy();
      expect(estResult.rows[0].primary_image_url).toContain('cloudinary.com');
    });

    test('should update primary_image_url when primary changes via update', async () => {
      // Upload first as primary
      const first = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first'), 'first.jpg')
        .expect(201);

      // Upload second (not primary)
      const second = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('second'), 'second.jpg')
        .expect(201);

      // Capture URL after first primary
      const estBefore = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );
      const urlBefore = estBefore.rows[0].primary_image_url;

      // Set second as primary via update
      await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${second.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ is_primary: true })
        .expect(200);

      const estAfter = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      // primary_image_url should still be set (synced to new primary)
      expect(estAfter.rows[0].primary_image_url).toBeTruthy();
      expect(estAfter.rows[0].primary_image_url).toContain('cloudinary.com');
    });

    test('should update primary_image_url when primary is deleted and auto-promoted', async () => {
      // Upload first as primary, second as non-primary
      const first = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first'), 'first.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('second'), 'second.jpg')
        .expect(201);

      // Delete primary
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${first.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // primary_image_url should be synced to the auto-promoted photo
      const estResult = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      expect(estResult.rows[0].primary_image_url).toBeTruthy();
      expect(estResult.rows[0].primary_image_url).toContain('cloudinary.com');
    });

    test('should clear primary_image_url when last photo is deleted', async () => {
      // Upload single primary photo
      const photo = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('only photo'), 'only.jpg')
        .expect(201);

      // Delete it
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${photo.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // primary_image_url should be null
      const estResult = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      expect(estResult.rows[0].primary_image_url).toBeNull();
    });
  });

  describe('PUT /api/v1/partner/establishments/:id/media/:mediaId - Update Media', () => {
    let media;

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('caption', 'Original caption')
        .attach('file', Buffer.from('test'), 'test.jpg')
        .expect(201);

      media = response.body.data;
    });

    test('should update caption', async () => {
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ caption: 'Updated caption' })
        .expect(200);

      expect(response.body.data.caption).toBe('Updated caption');
    });

    test('should update position for reordering', async () => {
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ position: 5 })
        .expect(200);

      expect(response.body.data.position).toBe(5);
    });

    test('should update is_primary flag', async () => {
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ is_primary: true })
        .expect(200);

      expect(response.body.data.is_primary).toBe(true);
    });

    test('should reject update to other partner\'s media', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .send({ caption: 'Hacked' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/partner/establishments/:id/media/:mediaId - Delete Media', () => {
    let media;

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('test'), 'test.jpg')
        .expect(201);

      media = response.body.data;
    });

    test('should delete media successfully', async () => {
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      const result = await pool.query(
        'SELECT * FROM establishment_media WHERE id = $1',
        [media.id]
      );
      expect(result.rows).toHaveLength(0);

      expect(cloudinary.deleteImage).toHaveBeenCalled();
    });

    test('should delete from database even if Cloudinary fails', async () => {
      cloudinary.deleteImage.mockRejectedValueOnce(new Error('Cloudinary error'));

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      const result = await pool.query(
        'SELECT * FROM establishment_media WHERE id = $1',
        [media.id]
      );
      expect(result.rows).toHaveLength(0);
    });

    test('should reject deletion of other partner\'s media', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .expect(404);

      const result = await pool.query(
        'SELECT * FROM establishment_media WHERE id = $1',
        [media.id]
      );
      expect(result.rows).toHaveLength(1);
    });

    test('should return 404 for non-existent media', async () => {
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(404);
    });
  });
});

describe('Media System - Edge Cases', () => {
  let partner;
  let partnerToken;
  let establishment;

  beforeEach(async () => {
    const partnerData = await createPartnerAndGetToken();
    partner = partnerData.partner;
    partnerToken = partnerData.token;

    establishment = await createTestEstablishment(partner.id);
  });

  test('should handle concurrent uploads correctly', async () => {
    const uploads = [
      request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 1'), 'photo1.jpg'),

      request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 2'), 'photo2.jpg'),

      request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 3'), 'photo3.jpg'),
    ];

    const results = await Promise.all(uploads);

    results.forEach(response => {
      expect(response.status).toBe(201);
    });

    const mediaList = await request(app)
      .get(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    expect(mediaList.body.data).toHaveLength(3);
  });

  test('should handle rapid upload and delete', async () => {
    const upload = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    const mediaId = upload.body.data.id;

    await request(app)
      .delete(`/api/v1/partner/establishments/${establishment.id}/media/${mediaId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const result = await pool.query(
      'SELECT * FROM establishment_media WHERE id = $1',
      [mediaId]
    );
    expect(result.rows).toHaveLength(0);
  });

  test('should handle caption with special characters', async () => {
    const response = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .field('caption', 'Интерьер ресторана: главный зал! @#$%^&*()')
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    expect(response.body.data.caption).toBe('Интерьер ресторана: главный зал! @#$%^&*()');
  });

  test('should handle maximum length caption', async () => {
    const maxCaption = 'А'.repeat(255);

    const response = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .field('caption', maxCaption)
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    expect(response.body.data.caption).toBe(maxCaption);
  });
});
