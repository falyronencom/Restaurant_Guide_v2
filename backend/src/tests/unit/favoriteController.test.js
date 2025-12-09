/**
 * Unit Tests: favoriteController.js
 *
 * Ensures controller-layer orchestration and validation for favorites API.
 */

import { jest } from '@jest/globals';
import {
  createMockRequest,
  createMockResponse,
} from '../mocks/helpers.js';

jest.unstable_mockModule('../../services/favoriteService.js', () => ({
  addToFavorites: jest.fn(),
  removeFromFavorites: jest.fn(),
  getUserFavorites: jest.fn(),
  checkFavoriteStatus: jest.fn(),
  checkMultipleFavoriteStatus: jest.fn(),
  getUserFavoritesStats: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const FavoriteService = await import('../../services/favoriteService.js');
const FavoriteController = await import('../../controllers/favoriteController.js');

describe('favoriteController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('addFavorite uses authenticated user and returns 201', async () => {
    const req = createMockRequest({
      body: { establishmentId: 'est-1' },
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    FavoriteService.addToFavorites.mockResolvedValue({ favorite: { id: 'fav-1' } });

    await FavoriteController.addFavorite(req, res, next);

    expect(FavoriteService.addToFavorites).toHaveBeenCalledWith('user-1', 'est-1');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { favorite: { id: 'fav-1' } },
    });
  });

  test('removeFavorite delegates to service', async () => {
    const req = createMockRequest({
      params: { establishmentId: 'est-1' },
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    FavoriteService.removeFromFavorites.mockResolvedValue({ message: 'ok' });

    await FavoriteController.removeFavorite(req, res, next);

    expect(FavoriteService.removeFromFavorites).toHaveBeenCalledWith('user-1', 'est-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { message: 'ok' },
    });
  });

  test('getUserFavorites validates pagination inputs', async () => {
    const req = createMockRequest({
      query: { page: '-1', limit: '-5' },
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();

    await FavoriteController.getUserFavorites(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(FavoriteService.getUserFavorites).not.toHaveBeenCalled();
  });

  test('getUserFavorites forwards pagination params', async () => {
    const req = createMockRequest({
      query: { page: '2', limit: '5' },
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    FavoriteService.getUserFavorites.mockResolvedValue({ favorites: [], pagination: { page: 2, limit: 5 } });

    await FavoriteController.getUserFavorites(req, res, next);

    expect(FavoriteService.getUserFavorites).toHaveBeenCalledWith('user-1', { page: 2, limit: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { favorites: [], pagination: { page: 2, limit: 5 } },
    });
  });

  test('checkFavoriteStatus returns data', async () => {
    const req = createMockRequest({
      params: { establishmentId: 'est-1' },
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    FavoriteService.checkFavoriteStatus.mockResolvedValue({ establishment_id: 'est-1', is_favorite: true });

    await FavoriteController.checkFavoriteStatus(req, res, next);

    expect(FavoriteService.checkFavoriteStatus).toHaveBeenCalledWith('user-1', 'est-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { establishment_id: 'est-1', is_favorite: true },
    });
  });

  test('checkBatchFavoriteStatus validates request body', async () => {
    const req = createMockRequest({
      body: { establishment_ids: 'not-array' },
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();

    await FavoriteController.checkBatchFavoriteStatus(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(FavoriteService.checkMultipleFavoriteStatus).not.toHaveBeenCalled();
  });

  test('checkBatchFavoriteStatus returns mapping', async () => {
    const req = createMockRequest({
      body: { establishment_ids: ['est-1', 'est-2'] },
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    FavoriteService.checkMultipleFavoriteStatus.mockResolvedValue({
      favorites: { 'est-1': true, 'est-2': false },
    });

    await FavoriteController.checkBatchFavoriteStatus(req, res, next);

    expect(FavoriteService.checkMultipleFavoriteStatus).toHaveBeenCalledWith('user-1', ['est-1', 'est-2']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { favorites: { 'est-1': true, 'est-2': false } },
    });
  });

  test('getFavoritesStats returns statistics', async () => {
    const req = createMockRequest({
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    FavoriteService.getUserFavoritesStats.mockResolvedValue({ total_favorites: 2 });

    await FavoriteController.getFavoritesStats(req, res, next);

    expect(FavoriteService.getUserFavoritesStats).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { total_favorites: 2 },
    });
  });
});

