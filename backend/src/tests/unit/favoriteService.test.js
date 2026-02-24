/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: favoriteService.js
 *
 * Validates favorites business logic with mocked data layer.
 */

import { jest } from '@jest/globals';
import { AppError } from '../../middleware/errorHandler.js';

jest.unstable_mockModule('../../models/favoriteModel.js', () => ({
  establishmentExists: jest.fn(),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
  getUserFavorites: jest.fn(),
  countUserFavorites: jest.fn(),
  isFavorite: jest.fn(),
  updateEstablishmentFavoriteCount: jest.fn().mockResolvedValue(undefined),
  getEstablishmentFavoriteCount: jest.fn().mockResolvedValue(0),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const FavoriteModel = await import('../../models/favoriteModel.js');
const logger = (await import('../../utils/logger.js')).default;

const {
  addToFavorites,
  removeFromFavorites,
  getUserFavorites,
  checkFavoriteStatus,
  checkMultipleFavoriteStatus,
  getUserFavoritesStats,
} = await import('../../services/favoriteService.js');

describe('favoriteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addToFavorites', () => {
    const userId = 'user-1';
    const establishmentId = 'est-1';
    const favoriteRecord = {
      id: 'fav-1',
      establishment_id: establishmentId,
      created_at: new Date(),
    };

    test('should add favorite when establishment exists', async () => {
      FavoriteModel.establishmentExists.mockResolvedValue(true);
      FavoriteModel.addFavorite.mockResolvedValue(favoriteRecord);

      const result = await addToFavorites(userId, establishmentId);

      expect(FavoriteModel.addFavorite).toHaveBeenCalledWith(userId, establishmentId);
      expect(result.favorite).toMatchObject({
        id: 'fav-1',
        user_id: userId,
        establishment_id: establishmentId,
      });
      expect(logger.info).toHaveBeenCalled();
    });

    test('should throw when establishment missing', async () => {
      FavoriteModel.establishmentExists.mockResolvedValue(false);

      await expect(addToFavorites(userId, establishmentId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });
    });
  });

  describe('removeFromFavorites', () => {
    const userId = 'user-1';
    const establishmentId = 'est-1';

    test('should log removal when favorite existed', async () => {
      FavoriteModel.removeFavorite.mockResolvedValue(true);

      const result = await removeFromFavorites(userId, establishmentId);

      expect(FavoriteModel.removeFavorite).toHaveBeenCalledWith(userId, establishmentId);
      expect(result.message).toBe('Establishment removed from favorites');
      expect(logger.info).toHaveBeenCalled();
    });

    test('should succeed idempotently when favorite missing', async () => {
      FavoriteModel.removeFavorite.mockResolvedValue(false);

      const result = await removeFromFavorites(userId, establishmentId);

      expect(result.message).toBe('Establishment removed from favorites');
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('getUserFavorites', () => {
    const userId = 'user-1';

    test('should validate page and limit', async () => {
      await expect(getUserFavorites(userId, { page: 0 })).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PAGE',
      });

      await expect(getUserFavorites(userId, { page: 1, limit: 0 })).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_LIMIT',
      });
    });

    test('should return formatted favorites with pagination', async () => {
      const favorites = [
        {
          id: 'fav-1',
          user_id: userId,
          establishment_id: 'est-1',
          created_at: new Date(),
          establishment_name: 'Cafe',
          establishment_description: 'Desc',
          establishment_city: 'Минск',
          establishment_address: 'Address',
          establishment_latitude: '53.9',
          establishment_longitude: '27.5',
          establishment_categories: ['Кофейня'],
          establishment_cuisines: ['Европейская'],
          establishment_price_range: '$$',
          establishment_average_rating: '4.5',
          establishment_review_count: 5,
          establishment_status: 'active',
          establishment_primary_image: 'http://image',
        },
      ];

      FavoriteModel.getUserFavorites.mockResolvedValue(favorites);
      FavoriteModel.countUserFavorites.mockResolvedValue(1);

      const result = await getUserFavorites(userId, { page: 1, limit: 10 });

      expect(FavoriteModel.getUserFavorites).toHaveBeenCalledWith(userId, { limit: 10, offset: 0 });
      expect(result.favorites[0]).toMatchObject({
        establishment_latitude: 53.9,
        establishment_longitude: 27.5,
        establishment_average_rating: 4.5,
        establishment_review_count: 5,
      });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        pages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });
  });

  describe('checkFavoriteStatus', () => {
    test('should return favorite flag', async () => {
      FavoriteModel.isFavorite.mockResolvedValue(true);

      const result = await checkFavoriteStatus('user-1', 'est-1');

      expect(result).toEqual({ establishment_id: 'est-1', is_favorite: true });
      expect(FavoriteModel.isFavorite).toHaveBeenCalledWith('user-1', 'est-1');
    });
  });

  describe('checkMultipleFavoriteStatus', () => {
    const userId = 'user-1';
    const ids = ['est-1', 'est-2'];

    test('should validate input array', async () => {
      await expect(checkMultipleFavoriteStatus(userId, null)).rejects.toBeInstanceOf(AppError);
      await expect(checkMultipleFavoriteStatus(userId, [])).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
      const bigArray = Array.from({ length: 51 }, (_, i) => `id-${i}`);
      await expect(checkMultipleFavoriteStatus(userId, bigArray)).rejects.toMatchObject({
        code: 'BATCH_TOO_LARGE',
      });
    });

    test('should return status map for provided ids', async () => {
      FavoriteModel.isFavorite
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const result = await checkMultipleFavoriteStatus(userId, ids);

      expect(FavoriteModel.isFavorite).toHaveBeenCalledTimes(2);
      expect(result.favorites).toEqual({
        'est-1': true,
        'est-2': false,
      });
    });
  });

  describe('getUserFavoritesStats', () => {
    test('should return total favorites', async () => {
      FavoriteModel.countUserFavorites.mockResolvedValue(3);

      const result = await getUserFavoritesStats('user-1');

      expect(result).toEqual({ total_favorites: 3 });
    });
  });
});

