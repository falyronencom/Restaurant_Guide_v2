import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';

/// Service for establishment-related API operations
/// Handles search, retrieval, and filtering of restaurants/cafes
class EstablishmentsService {
  final ApiClient _apiClient;

  /// Use mock data instead of real API (for testing without backend)
  static bool useMockData = false;

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
  /// [categories] - Filter by categories (multiple allowed)
  /// [cuisines] - Filter by cuisine types (multiple allowed)
  /// [priceRanges] - Filter by price ranges (multiple allowed)
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
    List<String>? categories,
    List<String>? cuisines,
    List<String>? priceRanges,
    double? minRating,
    double? latitude,
    double? longitude,
    double? maxDistance,
    String? search,
    String? sortBy,
  }) async {
    // Return mock data if enabled
    if (useMockData) {
      await Future.delayed(const Duration(milliseconds: 500)); // Simulate network
      return _getMockEstablishments(page: page, perPage: perPage, search: search);
    }

    final queryParams = <String, dynamic>{
      'page': page,
      'limit': perPage,
    };

    // Add optional filters
    if (city != null) queryParams['city'] = city;
    // Try without [] notation - backend may use different query parser
    if (categories != null && categories.isNotEmpty) {
      queryParams['categories'] = categories;
    }
    if (cuisines != null && cuisines.isNotEmpty) {
      queryParams['cuisines'] = cuisines;
    }
    if (priceRanges != null && priceRanges.isNotEmpty) {
      queryParams['priceRange'] = priceRanges;
    }
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
        final responseData = response.data as Map<String, dynamic>;

        // Backend returns: { success: true, data: { establishments: [...], pagination: {...} } }
        // Transform to format expected by PaginatedEstablishments.fromJson
        final innerData = responseData['data'] as Map<String, dynamic>?;
        if (innerData != null) {
          final pagination = innerData['pagination'] as Map<String, dynamic>? ?? {};
          final transformed = {
            'data': innerData['establishments'] ?? [],
            'meta': {
              'total': pagination['total'] ?? 0,
              'page': pagination['page'] ?? 1,
              'per_page': pagination['limit'] ?? 20, // backend uses 'limit'
              'total_pages': pagination['totalPages'] ?? 1, // backend uses camelCase
            },
          };
          return PaginatedEstablishments.fromJson(transformed);
        }

        // Fallback: try direct parsing (old format)
        return PaginatedEstablishments.fromJson(responseData);
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
          'neLat': north,  // Northeast latitude (max)
          'swLat': south,  // Southwest latitude (min)
          'neLon': east,   // Northeast longitude (max)
          'swLon': west,   // Southwest longitude (min)
          'limit': limit,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final establishments = data['data']?['establishments'] as List? ?? [];

        final result = <Establishment>[];
        for (var i = 0; i < establishments.length; i++) {
          try {
            final e = establishments[i] as Map<String, dynamic>;
            result.add(Establishment.fromJson(e));
          } catch (parseError) {
            // Skip invalid establishments
            continue;
          }
        }
        return result;
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
  Future<Establishment> getEstablishmentById(String id) async {
    // Return mock data if enabled
    if (useMockData) {
      await Future.delayed(const Duration(milliseconds: 300)); // Simulate network
      final establishment = _mockEstablishments.where((e) => e.id == id).firstOrNull;
      if (establishment != null) {
        return establishment;
      }
      throw Exception('Establishment not found');
    }

    try {
      final response = await _apiClient.get('/api/v1/search/establishments/$id');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;

        // Backend wraps in 'data' key
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
  // Partner Registration Operations (requires authentication)
  // ============================================================================

  /// Create a new establishment from partner registration data
  ///
  /// [data] - PartnerRegistration model with all establishment data
  /// Returns the created Establishment on success
  Future<Establishment> createEstablishment(PartnerRegistration data) async {
    // Return mock response if enabled
    if (useMockData) {
      await Future.delayed(const Duration(seconds: 2)); // Simulate network

      // Create a mock establishment from registration data
      return Establishment(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        name: data.name ?? 'Новое заведение',
        description: data.description,
        address: '${data.street ?? ''}, ${data.building ?? ''}',
        city: data.city ?? 'Минск',
        category: data.categories.isNotEmpty ? data.categories.first : 'Ресторан',
        cuisine: data.cuisineTypes.isNotEmpty ? data.cuisineTypes.first : null,
        priceRange: data.priceRange,
        rating: null,
        latitude: data.latitude,
        longitude: data.longitude,
        thumbnailUrl: data.primaryPhotoUrl,
        status: 'pending', // New establishments are pending moderation
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
      );
    }

    try {
      final response = await _apiClient.post(
        '/api/v1/partner/establishments',
        data: data.toJson(),
      );

      if (response.statusCode == 201 && response.data is Map<String, dynamic>) {
        final responseData = response.data as Map<String, dynamic>;

        // Check if backend returned new tokens (user was upgraded to partner)
        final tokens = responseData['data']?['tokens'];
        if (tokens != null && tokens['accessToken'] != null) {
          // Save new tokens with partner role
          await AuthService().updateTokens(
            accessToken: tokens['accessToken'],
            refreshToken: tokens['refreshToken'],
          );
        }

        // Backend wraps in 'data' -> 'establishment'
        try {
          final establishmentData = responseData.containsKey('data')
              ? responseData['data']['establishment']
              : responseData;

          return Establishment.fromJson(establishmentData as Map<String, dynamic>);
        } catch (parseError) {
          // Parsing failed but establishment was created (201)
          // Return a minimal placeholder - the important thing is success
          return Establishment(
            id: responseData['data']?['establishment']?['id']?.toString() ?? 'new',
            name: data.name ?? 'New Establishment',
            category: data.categories.isNotEmpty ? data.categories.first : 'restaurant',
            categories: data.categories,
            address: '${data.street ?? ''}, ${data.building ?? ''}',
            city: data.city ?? 'Минск',
            status: 'draft',
            createdAt: DateTime.now(),
            updatedAt: DateTime.now(),
          );
        }
      } else {
        throw Exception('Failed to create establishment: Unexpected response');
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
  Future<void> addToFavorites(String establishmentId) async {
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
  Future<void> removeFromFavorites(String establishmentId) async {
    try {
      await _apiClient.delete('/api/v1/favorites/$establishmentId');
    } catch (e) {
      rethrow;
    }
  }

  /// Check if establishment is in favorites
  Future<bool> isFavorite(String establishmentId) async {
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

  // ============================================================================
  // Mock Data (for testing without backend)
  // ============================================================================

  /// Get mock establishments for testing
  PaginatedEstablishments _getMockEstablishments({
    int page = 1,
    int perPage = 20,
    String? search,
  }) {
    final allEstablishments = _mockEstablishments;

    // Filter by search if provided
    var filtered = allEstablishments;
    if (search != null && search.isNotEmpty) {
      final query = search.toLowerCase();
      filtered = allEstablishments.where((e) =>
        e.name.toLowerCase().contains(query) ||
        e.description?.toLowerCase().contains(query) == true
      ).toList();
    }

    // Paginate
    final startIndex = (page - 1) * perPage;
    final endIndex = startIndex + perPage;
    final pageData = filtered.length > startIndex
      ? filtered.sublist(startIndex, endIndex.clamp(0, filtered.length))
      : <Establishment>[];

    return PaginatedEstablishments(
      data: pageData,
      meta: PaginationMeta(
        page: page,
        perPage: perPage,
        total: filtered.length,
        totalPages: (filtered.length / perPage).ceil(),
      ),
    );
  }

  /// Mock establishments data
  static final List<Establishment> _mockEstablishments = [
    Establishment(
      id: '1',
      name: 'Васильки',
      description: 'Сеть ресторанов белорусской кухни с уютной атмосферой и традиционными блюдами.',
      address: 'пр-т Независимости, 16',
      city: 'Минск',
      category: 'Ресторан',
      cuisine: 'Белорусская',
      priceRange: '\$\$',
      rating: 4.5,
      latitude: 53.9022,
      longitude: 27.5619,
      thumbnailUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
      status: 'active',
      workingHours: {
        'monday': {'open': '10:00', 'close': '23:00'},
        'tuesday': {'open': '10:00', 'close': '23:00'},
        'wednesday': {'open': '10:00', 'close': '23:00'},
        'thursday': {'open': '10:00', 'close': '23:00'},
        'friday': {'open': '10:00', 'close': '00:00'},
        'saturday': {'open': '11:00', 'close': '00:00'},
        'sunday': {'open': '11:00', 'close': '22:00'},
      },
      attributes: {
        'wifi': true,
        'parking': true,
        'terrace': true,
        'delivery': false,
        'live_music': true,
        'kids_zone': true,
      },
      media: [
        EstablishmentMedia(id: '1', establishmentId: '1', type: 'photo', url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '2', establishmentId: '1', type: 'photo', url: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800', position: 1, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '3', establishmentId: '1', type: 'photo', url: 'https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=800', position: 2, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '4', establishmentId: '1', type: 'menu', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '5', establishmentId: '1', type: 'menu', url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800', position: 1, createdAt: DateTime(2024, 1, 1)),
      ],
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
    Establishment(
      id: '2',
      name: 'Grand Café',
      description: 'Элегантное кафе в центре города с европейской кухней и изысканными десертами.',
      address: 'ул. Карла Маркса, 21',
      city: 'Минск',
      category: 'Кафе',
      cuisine: 'Европейская',
      priceRange: '\$\$\$',
      rating: 4.7,
      latitude: 53.8986,
      longitude: 27.5547,
      thumbnailUrl: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=400',
      status: 'active',
      workingHours: {
        'monday': {'open': '08:00', 'close': '22:00'},
        'tuesday': {'open': '08:00', 'close': '22:00'},
        'wednesday': {'open': '08:00', 'close': '22:00'},
        'thursday': {'open': '08:00', 'close': '22:00'},
        'friday': {'open': '08:00', 'close': '23:00'},
        'saturday': {'open': '09:00', 'close': '23:00'},
        'sunday': {'open': '09:00', 'close': '21:00'},
      },
      attributes: {
        'wifi': true,
        'parking': false,
        'terrace': true,
        'delivery': true,
        'live_music': false,
        'kids_zone': false,
      },
      media: [
        EstablishmentMedia(id: '10', establishmentId: '2', type: 'photo', url: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '11', establishmentId: '2', type: 'photo', url: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800', position: 1, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '12', establishmentId: '2', type: 'menu', url: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
      ],
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
    Establishment(
      id: '3',
      name: 'Pizzeria Bella',
      description: 'Аутентичная итальянская пиццерия с дровяной печью и свежими ингредиентами.',
      address: 'ул. Немига, 5',
      city: 'Минск',
      category: 'Пиццерия',
      cuisine: 'Итальянская',
      priceRange: '\$\$',
      rating: 4.3,
      latitude: 53.9045,
      longitude: 27.5510,
      thumbnailUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400',
      status: 'active',
      workingHours: {
        'monday': {'open': '11:00', 'close': '23:00'},
        'tuesday': {'open': '11:00', 'close': '23:00'},
        'wednesday': {'open': '11:00', 'close': '23:00'},
        'thursday': {'open': '11:00', 'close': '23:00'},
        'friday': {'open': '11:00', 'close': '00:00'},
        'saturday': {'open': '12:00', 'close': '00:00'},
        'sunday': {'open': '12:00', 'close': '22:00'},
      },
      attributes: {
        'wifi': true,
        'parking': true,
        'terrace': false,
        'delivery': true,
        'live_music': false,
        'kids_zone': true,
      },
      media: [
        EstablishmentMedia(id: '20', establishmentId: '3', type: 'photo', url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '21', establishmentId: '3', type: 'photo', url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800', position: 1, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '22', establishmentId: '3', type: 'menu', url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
      ],
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
    Establishment(
      id: '4',
      name: 'Sushi Master',
      description: 'Японский ресторан с широким выбором суши, роллов и традиционных блюд.',
      address: 'пр-т Победителей, 84',
      city: 'Минск',
      category: 'Ресторан',
      cuisine: 'Японская',
      priceRange: '\$\$\$',
      rating: 4.6,
      latitude: 53.9156,
      longitude: 27.5482,
      thumbnailUrl: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400',
      status: 'active',
      workingHours: {
        'monday': {'open': '12:00', 'close': '23:00'},
        'tuesday': {'open': '12:00', 'close': '23:00'},
        'wednesday': {'open': '12:00', 'close': '23:00'},
        'thursday': {'open': '12:00', 'close': '23:00'},
        'friday': {'open': '12:00', 'close': '00:00'},
        'saturday': {'open': '12:00', 'close': '00:00'},
        'sunday': {'open': '12:00', 'close': '22:00'},
      },
      attributes: {
        'wifi': true,
        'parking': true,
        'terrace': false,
        'delivery': true,
        'live_music': false,
        'kids_zone': false,
      },
      media: [
        EstablishmentMedia(id: '30', establishmentId: '4', type: 'photo', url: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '31', establishmentId: '4', type: 'photo', url: 'https://images.unsplash.com/photo-1553621042-f6e147245754?w=800', position: 1, createdAt: DateTime(2024, 1, 1)),
        EstablishmentMedia(id: '32', establishmentId: '4', type: 'menu', url: 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=800', position: 0, createdAt: DateTime(2024, 1, 1)),
      ],
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
    Establishment(
      id: '5',
      name: 'Хинкальная №1',
      description: 'Грузинский ресторан с настоящими хинкали, хачапури и домашним вином.',
      address: 'ул. Интернациональная, 25',
      city: 'Минск',
      category: 'Ресторан',
      cuisine: 'Грузинская',
      priceRange: '\$\$',
      rating: 4.8,
      latitude: 53.8998,
      longitude: 27.5601,
      thumbnailUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400',
      status: 'active',
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
    Establishment(
      id: '6',
      name: 'Burger King',
      description: 'Популярная сеть быстрого питания с фирменными бургерами и картофелем фри.',
      address: 'ТЦ Галилео, пр-т Независимости, 40',
      city: 'Минск',
      category: 'Фастфуд',
      cuisine: 'Американская',
      priceRange: '\$',
      rating: 4.0,
      latitude: 53.9089,
      longitude: 27.5734,
      thumbnailUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
      status: 'active',
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
    Establishment(
      id: '7',
      name: 'Sweet Dreams',
      description: 'Уютная кондитерская с авторскими тортами, пирожными и ароматным кофе.',
      address: 'ул. Ленина, 8',
      city: 'Минск',
      category: 'Кондитерская',
      cuisine: 'Европейская',
      priceRange: '\$\$',
      rating: 4.9,
      latitude: 53.8967,
      longitude: 27.5512,
      thumbnailUrl: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400',
      status: 'active',
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
    Establishment(
      id: '8',
      name: 'The Irish Pub',
      description: 'Аутентичный ирландский паб с живой музыкой, крафтовым пивом и закусками.',
      address: 'ул. Зыбицкая, 6',
      city: 'Минск',
      category: 'Бар',
      cuisine: 'Европейская',
      priceRange: '\$\$',
      rating: 4.4,
      latitude: 53.9012,
      longitude: 27.5578,
      thumbnailUrl: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=400',
      status: 'active',
      createdAt: DateTime(2024, 1, 1),
      updatedAt: DateTime(2024, 1, 1),
    ),
  ];
}
