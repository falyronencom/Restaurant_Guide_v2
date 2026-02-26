/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: establishmentService.js
 *
 * Tests establishment business logic in isolation using mocked model layer.
 * These tests verify:
 * - Establishment creation with validation
 * - Ownership verification
 * - Pagination and filtering
 * - Business rules enforcement
 * - Geographic bounds validation (Belarus-specific)
 */

import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  createEstablishment: jest.fn(),
  getEstablishmentsByPartner: jest.fn(),
  countPartnerEstablishments: jest.fn(),
  findEstablishmentById: jest.fn(),
  checkOwnership: jest.fn(),
  checkDuplicateName: jest.fn(),
  updateEstablishment: jest.fn(),
  deleteEstablishment: jest.fn(),
  submitForModeration: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.unstable_mockModule('../../models/mediaModel.js', () => ({
  getEstablishmentMedia: jest.fn(),
}));

jest.unstable_mockModule('../../models/partnerDocumentsModel.js', () => ({
  findByEstablishmentId: jest.fn(),
}));

jest.unstable_mockModule('../../models/reviewModel.js', () => ({
  getRatingDistribution: jest.fn(),
}));

// Import after mocking — import all mocked modules to get references
const EstablishmentModel = await import('../../models/establishmentModel.js');
const logger = (await import('../../utils/logger.js')).default;
const MediaModel = await import('../../models/mediaModel.js');
const PartnerDocumentsModel = await import('../../models/partnerDocumentsModel.js');
const ReviewModel = await import('../../models/reviewModel.js');

const {
  createEstablishment,
  getPartnerEstablishments,
  getEstablishmentById,
  updateEstablishment,
  submitEstablishmentForModeration,
} = await import('../../services/establishmentService.js');

import { createMockEstablishment } from '../mocks/helpers.js';
import { AppError } from '../../middleware/errorHandler.js';

describe('establishmentService', () => {
  let partnerId;
  let mockEstablishment;

  beforeEach(() => {
    jest.clearAllMocks();
    partnerId = 'partner-123';
    mockEstablishment = createMockEstablishment({ partner_id: partnerId });
  });

  describe('createEstablishment', () => {
    const validEstablishmentData = {
      name: 'Test Restaurant',
      description: 'A test restaurant',
      city: 'Минск',
      address: 'Test Street 1',
      latitude: 53.9,
      longitude: 27.5,
      phone: '+375171234567',
      email: 'test@restaurant.com',
      website: 'https://test.com',
      categories: ['Ресторан'],
      cuisines: ['Европейская'],
      price_range: '$$',
      working_hours: {
        monday: '09:00-22:00',
        tuesday: '09:00-22:00',
        wednesday: '09:00-22:00',
        thursday: '09:00-22:00',
        friday: '09:00-23:00',
        saturday: '10:00-23:00',
        sunday: '10:00-22:00',
      },
    };

    test('should create establishment with valid data', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      const result = await createEstablishment(partnerId, validEstablishmentData);

      expect(result).toEqual(mockEstablishment);
      expect(EstablishmentModel.checkDuplicateName).toHaveBeenCalledWith(
        partnerId,
        validEstablishmentData.name
      );
      expect(EstablishmentModel.createEstablishment).toHaveBeenCalledWith(
        expect.objectContaining({
          partner_id: partnerId,
          name: validEstablishmentData.name,
          city: validEstablishmentData.city,
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Establishment created successfully',
        expect.objectContaining({ partnerId })
      );
    });

    test('should throw error for invalid city', async () => {
      const invalidData = {
        ...validEstablishmentData,
        city: 'Москва', // Not in Belarus
      };

      await expect(createEstablishment(partnerId, invalidData)).rejects.toThrow(AppError);
      await expect(createEstablishment(partnerId, invalidData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CITY',
      });
    });

    test('should accept all valid Belarus cities', async () => {
      // Each city needs coordinates within its CITY_BOUNDS
      const citiesWithCoords = [
        { city: 'Минск', latitude: 53.9, longitude: 27.5 },
        { city: 'Гродно', latitude: 53.68, longitude: 23.83 },
        { city: 'Брест', latitude: 52.1, longitude: 23.7 },
        { city: 'Гомель', latitude: 52.42, longitude: 31.0 },
        { city: 'Витебск', latitude: 55.19, longitude: 30.2 },
        { city: 'Могилев', latitude: 53.91, longitude: 30.35 },
        { city: 'Бобруйск', latitude: 53.15, longitude: 29.25 },
      ];

      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      for (const { city, latitude, longitude } of citiesWithCoords) {
        await expect(
          createEstablishment(partnerId, { ...validEstablishmentData, city, latitude, longitude })
        ).resolves.toBeDefined();
      }
    });

    test('should throw error for invalid categories length', async () => {
      // Too few categories
      await expect(
        createEstablishment(partnerId, { ...validEstablishmentData, categories: [] })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CATEGORIES_LENGTH',
      });

      // Too many categories
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          categories: ['Ресторан', 'Кофейня', 'Бар'], // 3 items
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CATEGORIES_LENGTH',
      });
    });

    test('should throw error for invalid category values', async () => {
      const invalidData = {
        ...validEstablishmentData,
        categories: ['Invalid Category'],
      };

      await expect(createEstablishment(partnerId, invalidData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CATEGORY_VALUE',
      });
    });

    test('should accept 1-2 valid categories', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      // 1 category
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          categories: ['Ресторан'],
        })
      ).resolves.toBeDefined();

      // 2 categories
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          categories: ['Ресторан', 'Бар'],
        })
      ).resolves.toBeDefined();
    });

    test('should throw error for invalid cuisines length', async () => {
      // Too few
      await expect(
        createEstablishment(partnerId, { ...validEstablishmentData, cuisines: [] })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CUISINES_LENGTH',
      });

      // Too many
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          cuisines: ['Народная', 'Европейская', 'Азиатская', 'Итальянская'], // 4 items
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CUISINES_LENGTH',
      });
    });

    test('should throw error for invalid cuisine values', async () => {
      const invalidData = {
        ...validEstablishmentData,
        cuisines: ['Invalid Cuisine'],
      };

      await expect(createEstablishment(partnerId, invalidData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CUISINE_VALUE',
      });
    });

    test('should accept 1-3 valid cuisines', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      // 1 cuisine
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          cuisines: ['Народная'],
        })
      ).resolves.toBeDefined();

      // 3 cuisines
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          cuisines: ['Народная', 'Европейская', 'Азиатская'],
        })
      ).resolves.toBeDefined();
    });

    test('should validate latitude within Belarus bounds', async () => {
      // Too low (south of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          latitude: 50.0, // Below 51.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LATITUDE',
      });

      // Too high (north of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          latitude: 57.0, // Above 56.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LATITUDE',
      });
    });

    test('should validate longitude within Belarus bounds', async () => {
      // Too low (west of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          longitude: 22.0, // Below 23.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LONGITUDE',
      });

      // Too high (east of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          longitude: 34.0, // Above 33.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LONGITUDE',
      });
    });

    test('should accept valid Belarus coordinates', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      // Minsk coordinates
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          latitude: 53.9,
          longitude: 27.5,
        })
      ).resolves.toBeDefined();

      // Brest coordinates (with matching city)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          city: 'Брест',
          latitude: 52.1,
          longitude: 23.7,
        })
      ).resolves.toBeDefined();
    });

    test('should throw error for duplicate establishment name', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(true);

      await expect(createEstablishment(partnerId, validEstablishmentData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_ESTABLISHMENT',
      });

      expect(EstablishmentModel.createEstablishment).not.toHaveBeenCalled();
    });

    test('should handle database unique constraint violation', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);

      const dbError = new Error('Unique violation');
      dbError.code = '23505';
      EstablishmentModel.createEstablishment.mockRejectedValue(dbError);

      await expect(createEstablishment(partnerId, validEstablishmentData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_ESTABLISHMENT',
      });
    });

    test('should handle database check constraint violation', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);

      const dbError = new Error('Check constraint violation');
      dbError.code = '23514';
      EstablishmentModel.createEstablishment.mockRejectedValue(dbError);

      await expect(createEstablishment(partnerId, validEstablishmentData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'CONSTRAINT_VIOLATION',
      });
    });
  });

  describe('getPartnerEstablishments', () => {
    test('should fetch establishments with default pagination', async () => {
      const mockEstablishments = [
        createMockEstablishment(),
        createMockEstablishment(),
      ];

      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue(mockEstablishments);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(15);

      const result = await getPartnerEstablishments(partnerId);

      // Service normalizes moderation_notes (TEXT→object), so each item gets moderation_notes: null
      const expectedEstablishments = mockEstablishments.map(est => ({
        ...est,
        moderation_notes: est.moderation_notes || null,
      }));
      expect(result.establishments).toEqual(expectedEstablishments);
      expect(result.meta).toEqual({
        total: 15,
        page: 1,
        limit: 20,
        pages: 1,
      });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          limit: 20,
          offset: 0,
        })
      );
    });

    test('should handle custom pagination parameters', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue([]);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(100);

      const result = await getPartnerEstablishments(partnerId, { page: 3, limit: 10 });

      expect(result.meta).toEqual({
        total: 100,
        page: 3,
        limit: 10,
        pages: 10,
      });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          limit: 10,
          offset: 20, // (page 3 - 1) * 10
        })
      );
    });

    test('should enforce maximum limit of 50', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue([]);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(100);

      await getPartnerEstablishments(partnerId, { page: 1, limit: 100 });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          limit: 50, // Capped at 50
        })
      );
    });

    test('should filter by status when provided', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue([]);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(5);

      await getPartnerEstablishments(partnerId, { status: 'active' });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          status: 'active',
        })
      );

      expect(EstablishmentModel.countPartnerEstablishments).toHaveBeenCalledWith(
        partnerId,
        'active'
      );
    });

    test('should handle database errors gracefully', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockRejectedValue(
        new Error('Database error')
      );

      await expect(getPartnerEstablishments(partnerId)).rejects.toMatchObject({
        statusCode: 500,
        code: 'ESTABLISHMENTS_FETCH_FAILED',
      });

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getEstablishmentById', () => {
    const establishmentId = 'establishment-123';

    beforeEach(() => {
      // Set default return values for enrichment model mocks
      MediaModel.getEstablishmentMedia.mockResolvedValue([]);
      PartnerDocumentsModel.findByEstablishmentId.mockResolvedValue(null);
      ReviewModel.getRatingDistribution.mockResolvedValue([]);
    });

    test('should fetch establishment when partner owns it', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);

      const result = await getEstablishmentById(establishmentId, partnerId);

      // Result includes establishment fields plus media/legal enrichment
      expect(result).toMatchObject({
        id: mockEstablishment.id,
        name: mockEstablishment.name,
        partner_id: mockEstablishment.partner_id,
      });
      expect(result).toHaveProperty('primary_photo');
      expect(result).toHaveProperty('interior_photos');
      expect(result).toHaveProperty('menu_photos');
      expect(result).toHaveProperty('rating_distribution');
      expect(EstablishmentModel.checkOwnership).toHaveBeenCalledWith(
        establishmentId,
        partnerId
      );
      expect(EstablishmentModel.findEstablishmentById).toHaveBeenCalledWith(
        establishmentId,
        true
      );
    });

    test('should throw error when partner does not own establishment', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(false);

      await expect(getEstablishmentById(establishmentId, partnerId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });

      expect(EstablishmentModel.findEstablishmentById).not.toHaveBeenCalled();
    });

    test('should throw error when establishment not found', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await expect(getEstablishmentById(establishmentId, partnerId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });
    });

    test('should handle database errors', async () => {
      EstablishmentModel.checkOwnership.mockRejectedValue(new Error('Database error'));

      await expect(getEstablishmentById(establishmentId, partnerId)).rejects.toMatchObject({
        statusCode: 500,
        code: 'ESTABLISHMENT_FETCH_FAILED',
      });

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updateEstablishment', () => {
    const establishmentId = 'establishment-123';

    test('should update establishment when partner owns it', async () => {
      const updates = {
        description: 'Updated description',
        phone: '+375171234568',
      };

      const updatedEstablishment = {
        ...mockEstablishment,
        ...updates,
      };

      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      EstablishmentModel.updateEstablishment.mockResolvedValue(updatedEstablishment);

      const result = await updateEstablishment(establishmentId, partnerId, updates);

      expect(result).toEqual(updatedEstablishment);
      expect(EstablishmentModel.checkOwnership).toHaveBeenCalledWith(
        establishmentId,
        partnerId
      );
    });

    test('should throw error when partner does not own establishment', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(false);

      await expect(
        updateEstablishment(establishmentId, partnerId, { description: 'New' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });

      expect(EstablishmentModel.updateEstablishment).not.toHaveBeenCalled();
    });

    test('should throw when establishment is suspended', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        status: 'suspended',
      });

      await expect(
        updateEstablishment(establishmentId, partnerId, { description: 'New' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'ESTABLISHMENT_SUSPENDED',
      });
    });

    test('should validate categories and cuisines on update', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);

      await expect(
        updateEstablishment(establishmentId, partnerId, { categories: [] })
      ).rejects.toMatchObject({
        code: 'INVALID_CATEGORIES_LENGTH',
      });

      await expect(
        updateEstablishment(establishmentId, partnerId, { categories: ['Invalid'] })
      ).rejects.toMatchObject({
        code: 'INVALID_CATEGORY_VALUE',
      });

      await expect(
        updateEstablishment(establishmentId, partnerId, { cuisines: [] })
      ).rejects.toMatchObject({
        code: 'INVALID_CUISINES_LENGTH',
      });

      await expect(
        updateEstablishment(establishmentId, partnerId, { cuisines: ['Invalid'] })
      ).rejects.toMatchObject({
        code: 'INVALID_CUISINE_VALUE',
      });
    });

    test('should reset status to pending when major fields change on active establishment', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        status: 'active',
      });
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      const updated = { ...mockEstablishment, status: 'pending' };
      EstablishmentModel.updateEstablishment.mockResolvedValue(updated);

      const updates = { name: 'New Name', categories: ['Ресторан'], cuisines: ['Европейская'] };

      await updateEstablishment(establishmentId, partnerId, updates);

      expect(EstablishmentModel.updateEstablishment).toHaveBeenCalledWith(
        establishmentId,
        expect.objectContaining({ status: 'pending' })
      );
    });

    test('should remove direct status changes when no major fields changed', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      EstablishmentModel.updateEstablishment.mockResolvedValue(mockEstablishment);

      await updateEstablishment(establishmentId, partnerId, { status: 'active' });

      expect(EstablishmentModel.updateEstablishment).toHaveBeenCalledWith(
        establishmentId,
        expect.not.objectContaining({ status: 'active' })
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    test('should prevent duplicate names during update', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        name: 'Old Name',
      });
      EstablishmentModel.checkDuplicateName.mockResolvedValue(true);

      await expect(
        updateEstablishment(establishmentId, partnerId, { name: 'New Name' })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_ESTABLISHMENT',
      });
    });

    test('should map database constraint violation on update', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      const dbError = new Error('constraint');
      dbError.code = '23514';
      EstablishmentModel.updateEstablishment.mockRejectedValue(dbError);

      await expect(
        updateEstablishment(establishmentId, partnerId, { description: 'New' })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'CONSTRAINT_VIOLATION',
      });
    });
  });

  describe('getEstablishmentById formatting', () => {
    beforeEach(() => {
      MediaModel.getEstablishmentMedia.mockResolvedValue([]);
      PartnerDocumentsModel.findByEstablishmentId.mockResolvedValue(null);
      ReviewModel.getRatingDistribution.mockResolvedValue([]);
    });

    test('should parse numeric strings to numbers', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        latitude: '53.9',
        longitude: '27.5',
        average_rating: '4.5',
      });

      const result = await getEstablishmentById('est-1', partnerId);

      expect(result.latitude).toBeCloseTo(53.9);
      expect(result.longitude).toBeCloseTo(27.5);
      expect(result.average_rating).toBeCloseTo(4.5);
    });
  });

  describe('submitEstablishmentForModeration', () => {
    const establishmentId = 'establishment-999';

    test('should reject when user is not owner', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(false);

      await expect(
        submitEstablishmentForModeration(establishmentId, partnerId)
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });
    });

    test('should reject when establishment not found', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await expect(
        submitEstablishmentForModeration(establishmentId, partnerId)
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });
    });

    test('should reject submission when status not draft or rejected', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        status: 'pending',
      });

      await expect(
        submitEstablishmentForModeration(establishmentId, partnerId)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_STATUS_FOR_SUBMISSION',
      });
    });

    test('should reject when required fields missing', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        status: 'draft',
        name: null,
      });

      await expect(
        submitEstablishmentForModeration(establishmentId, partnerId)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INCOMPLETE_ESTABLISHMENT',
      });
    });

    test('should submit draft and return pending status', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        status: 'draft',
      });
      const submitted = { id: establishmentId, status: 'pending', updated_at: new Date() };
      EstablishmentModel.submitForModeration.mockResolvedValue(submitted);

      const result = await submitEstablishmentForModeration(establishmentId, partnerId);

      expect(EstablishmentModel.submitForModeration).toHaveBeenCalledWith(establishmentId);
      expect(result).toEqual(submitted);
    });
  });
});
