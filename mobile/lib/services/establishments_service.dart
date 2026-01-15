import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Service for establishment-related API operations
/// Handles search, retrieval, and filtering of restaurants/cafes
class EstablishmentsService {
  final ApiClient _apiClient;

  // Singleton pattern
  static final EstablishmentsService _instance = EstablishmentsService._internal();
  factory EstablishmentsService() => _instance;

  EstablishmentsService._internal() : _apiClient = ApiClient();

  // ============================================================================
  // Search and List Operations
  // ============================================================================

  /// Search establishments with optional filters
  ///
  /// [page] - Page number (default: 1)
  /// [perPage] - Items per page (default: 20)
  /// [city] - Filter by city
  /// [category] - Filter by category
  /// [cuisine] - Filter by cuisine type
  /// [priceRange] - Filter by price range
  /// [minRating] - Minimum rating filter
  /// [latitude] - User latitude for distance calculation
  /// [longitude] - User longitude for distance calculation
  /// [maxDistance] - Maximum distance in kilometers
  /// [search] - Search query for name/description
  /// [sortBy] - Sort order (distance, rating, price_asc, price_desc)
  Future<PaginatedEstablishments> searchEstablishments({
    int page = 1,
    int perPage = 20,
    String? city,
    String? category,
    String? cuisine,
    String? priceRange,
    double? minRating,
    double? latitude,
    double? longitude,
    double? maxDistance,
    String? search,
    String? sortBy,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'per_page': perPage,
    };

    // Add optional filters
    if (city != null) queryParams['city'] = city;
    if (category != null) queryParams['category'] = category;
    if (cuisine != null) queryParams['cuisine'] = cuisine;
    if (priceRange != null) queryParams['price_range'] = priceRange;
    if (minRating != null) queryParams['min_rating'] = minRating;
    if (latitude != null) queryParams['latitude'] = latitude;
    if (longitude != null) queryParams['longitude'] = longitude;
    if (maxDistance != null) queryParams['max_distance'] = maxDistance;
    if (search != null && search.isNotEmpty) queryParams['search'] = search;
    if (sortBy != null) queryParams['sort_by'] = sortBy;

    try {
      final response = await _apiClient.get(
        '/api/v1/search/establishments',
        queryParameters: queryParams,
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        return PaginatedEstablishments.fromJson(
          response.data as Map<String, dynamic>,
        );
      } else {
        throw Exception('Unexpected response format');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Get list of establishments for a specific city
  /// Convenience method for common use case
  Future<PaginatedEstablishments> getEstablishmentsByCity(
    String city, {
    int page = 1,
    int perPage = 20,
  }) async {
    return searchEstablishments(
      city: city,
      page: page,
      perPage: perPage,
    );
  }

  // ============================================================================
  // Map Operations
  // ============================================================================

  /// Search establishments within map bounds
  ///
  /// [north] - Northern latitude bound
  /// [south] - Southern latitude bound
  /// [east] - Eastern longitude bound
  /// [west] - Western longitude bound
  /// [limit] - Maximum number of results (default: 100)
  Future<List<Establishment>> searchByMapBounds({
    required double north,
    required double south,
    required double east,
    required double west,
    int limit = 100,
  }) async {
    try {
      final response = await _apiClient.get(
        '/api/v1/search/map',
        queryParameters: {
          'north': north,
          'south': south,
          'east': east,
          'west': west,
          'limit': limit,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final establishments = data['data']?['establishments'] as List? ?? [];

        return establishments
            .map((e) => Establishment.fromJson(e as Map<String, dynamic>))
            .toList();
      } else {
        throw Exception('Unexpected response format');
      }
    } catch (e) {
      rethrow;
    }
  }

  // ============================================================================
  // Detail Operations
  // ============================================================================

  /// Get detailed information about a specific establishment
  ///
  /// [id] - Establishment ID
  Future<Establishment> getEstablishmentById(int id) async {
    try {
      final response = await _apiClient.get('/api/v1/establishments/$id');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;

        // Backend may wrap in 'data' key or return directly
        final establishmentData = data.containsKey('data') ? data['data'] : data;

        return Establishment.fromJson(establishmentData as Map<String, dynamic>);
      } else {
        throw Exception('Unexpected response format');
      }
    } catch (e) {
      rethrow;
    }
  }

  // ============================================================================
  // Favorites Operations (requires authentication)
  // ============================================================================

  /// Get user's favorite establishments
  Future<List<Establishment>> getFavorites() async {
    try {
      final response = await _apiClient.get('/api/v1/favorites');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final favorites = data['data'] as List;

        return favorites
            .map((e) => Establishment.fromJson(e as Map<String, dynamic>))
            .toList();
      } else {
        throw Exception('Unexpected response format');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Add establishment to favorites
  Future<void> addToFavorites(int establishmentId) async {
    try {
      await _apiClient.post(
        '/api/v1/favorites',
        data: {'establishment_id': establishmentId},
      );
    } catch (e) {
      rethrow;
    }
  }

  /// Remove establishment from favorites
  Future<void> removeFromFavorites(int establishmentId) async {
    try {
      await _apiClient.delete('/api/v1/favorites/$establishmentId');
    } catch (e) {
      rethrow;
    }
  }

  /// Check if establishment is in favorites
  Future<bool> isFavorite(int establishmentId) async {
    try {
      final response = await _apiClient.get(
        '/api/v1/favorites/check/$establishmentId',
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        return data['is_favorite'] as bool? ?? false;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /// Get available cities
  Future<List<String>> getAvailableCities() async {
    try {
      final response = await _apiClient.get('/api/v1/cities');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final cities = data['data'] as List;
        return cities.map((c) => c.toString()).toList();
      }

      // Fallback to known cities
      return [
        'Минск',
        'Гомель',
        'Могилёв',
        'Витебск',
        'Гродно',
        'Брест',
        'Бобруйск',
      ];
    } catch (e) {
      // Return default cities if API fails
      return [
        'Минск',
        'Гомель',
        'Могилёв',
        'Витебск',
        'Гродно',
        'Брест',
        'Бобруйск',
      ];
    }
  }

  /// Get available categories
  Future<List<String>> getAvailableCategories() async {
    // For now, return static list
    // Can be enhanced to fetch from API in future
    return [
      'Ресторан',
      'Кафе',
      'Бар',
      'Пиццерия',
      'Фастфуд',
      'Кондитерская',
    ];
  }

  /// Get available cuisines
  Future<List<String>> getAvailableCuisines() async {
    // For now, return static list
    // Can be enhanced to fetch from API in future
    return [
      'Белорусская',
      'Европейская',
      'Итальянская',
      'Японская',
      'Грузинская',
      'Американская',
      'Китайская',
      'Восточная',
    ];
  }
}
