import { jest } from '@jest/globals';
import { AppError } from '../../middleware/errorHandler.js';

// Mock search service before importing controller
jest.unstable_mockModule('../../services/searchService.js', () => ({
  searchByRadius: jest.fn(),
  searchByBounds: jest.fn(),
  checkSearchHealth: jest.fn()
}));

const searchService = await import('../../services/searchService.js');
const {
  searchEstablishments,
  searchMap,
  searchHealth
} = await import('../../controllers/searchController.js');

const createRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('searchController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchEstablishments', () => {
    test('should reject invalid latitude/longitude', async () => {
      const req = { query: { latitude: 'not-a-number', longitude: '27.5' } };
      const res = createRes();
      const next = jest.fn();

      await searchEstablishments(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const err = next.mock.calls[0][0];
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    test('should reject invalid page number', async () => {
      const req = {
        query: {
          latitude: '53.9',
          longitude: '27.5',
          page: '-1'
        }
      };
      const res = createRes();
      const next = jest.fn();

      await searchEstablishments(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next.mock.calls[0][0].message).toContain('Page must be a positive integer');
    });

    test('should pass parsed params to service and compute offset from page', async () => {
      const req = {
        query: {
          latitude: '53.9',
          longitude: '27.5',
          radius: '5',
          categories: 'Кофейня,Ресторан',
          cuisines: 'Европейская',
          minRating: '4.5',
          priceRange: '$$',
          limit: '10',
          page: '2'
        }
      };
      const res = createRes();
      const next = jest.fn();
      const mockResult = { establishments: [], pagination: {} };
      searchService.searchByRadius.mockResolvedValue(mockResult);

      await searchEstablishments(req, res, next);

      expect(searchService.searchByRadius).toHaveBeenCalledWith(
        expect.objectContaining({
          latitude: 53.9,
          longitude: 27.5,
          radius: 5,
          categories: ['Кофейня', 'Ресторан'],
          cuisines: ['Европейская'],
          minRating: 4.5,
          priceRange: '$$',
          limit: 10,
          offset: 10, // page 2 -> offset 10
          page: 2
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('searchMap', () => {
    test('should reject invalid bounds', async () => {
      const req = { query: { minLat: 'a', maxLat: 'b', minLon: 'c', maxLon: 'd' } };
      const res = createRes();
      const next = jest.fn();

      await searchMap(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next.mock.calls[0][0].code).toBe('VALIDATION_ERROR');
    });

    test('should parse bounds aliases and call service', async () => {
      const req = {
        query: {
          swLat: '53.8',
          swLon: '27.4',
          neLat: '53.95',
          neLon: '27.55',
          categories: 'Кофейня',
          cuisines: 'Европейская',
          priceRange: '$',
          minRating: '4.0',
          limit: '50'
        }
      };
      const res = createRes();
      const next = jest.fn();
      const mockResult = { establishments: [], total: 0 };
      searchService.searchByBounds.mockResolvedValue(mockResult);

      await searchMap(req, res, next);

      expect(searchService.searchByBounds).toHaveBeenCalledWith(
        expect.objectContaining({
          minLat: 53.8,
          maxLat: 53.95,
          minLon: 27.4,
          maxLon: 27.55,
          categories: ['Кофейня'],
          cuisines: ['Европейская'],
          priceRange: '$',
          minRating: 4.0,
          limit: 50
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('searchHealth', () => {
    test('should return 503 when unhealthy', async () => {
      const req = {};
      const res = createRes();
      const next = jest.fn();
      searchService.checkSearchHealth.mockResolvedValue({
        healthy: false,
        error: 'PostGIS not available'
      });

      await searchHealth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        data: {
          healthy: false,
          error: 'PostGIS not available'
        }
      });
    });
  });
});

