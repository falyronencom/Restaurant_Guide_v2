import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Service for review-related API operations
/// Handles fetching and managing reviews for establishments
class ReviewsService {
  final ApiClient _apiClient;

  // Singleton pattern
  static final ReviewsService _instance = ReviewsService._internal();
  factory ReviewsService() => _instance;

  ReviewsService._internal() : _apiClient = ApiClient();

  // ============================================================================
  // Review Operations
  // ============================================================================

  /// Get reviews for a specific establishment
  ///
  /// [establishmentId] - The establishment ID
  /// [page] - Page number (default: 1)
  /// [perPage] - Items per page (default: 10)
  ///
  /// Сбой (нет сети, отказ или сбой сервера, чужая форма ответа) летит
  /// наверх. До 17.10.2026 он превращался в пустую страницу, и карточка
  /// заведения писала «Пока нет отзывов. Станьте первым!», а до «Повторить»
  /// на экране всех отзывов было не добраться (проход тестировщика 17.10,
  /// Х5, Х23). Экран отличает «отзывов нет» от «не загрузилось» сам.
  Future<PaginatedReviews> getReviewsForEstablishment(
    String establishmentId, {
    int page = 1,
    int perPage = 10,
    String? sort,
    DateTime? dateFrom,
    DateTime? dateTo,
  }) async {
    final response = await _apiClient.get(
      '/api/v1/establishments/$establishmentId/reviews',
      queryParameters: {
        'page': page,
        // The server reads the page size as `limit` only (default 10):
        // under `per_page` the card's five-review preview got ten.
        'limit': perPage,
        if (sort != null) 'sort': sort,
        if (dateFrom != null) 'date_from': dateFrom.toIso8601String(),
        if (dateTo != null) 'date_to': dateTo.toIso8601String(),
      },
    );

    if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
      return PaginatedReviews.fromJson(response.data as Map<String, dynamic>);
    }
    throw Exception('Unexpected response format');
  }

  /// Get a single review by ID
  Future<Review?> getReviewById(String reviewId) async {  // UUID from backend
    try {
      final response = await _apiClient.get('/api/v1/reviews/$reviewId');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        // Backend returns: { success: true, data: { review: {...} } }
        final innerData = data['data'] as Map<String, dynamic>?;
        final reviewData = innerData?['review'] ?? innerData ?? data;
        return Review.fromJson(reviewData as Map<String, dynamic>);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /// Create a new review (requires authentication)
  Future<Review?> createReview({
    required String establishmentId,
    required int rating,
    String? text,
  }) async {
    try {
      // Backend expects POST /api/v1/reviews with establishmentId in body (camelCase)
      // and 'content' field instead of 'text'
      final response = await _apiClient.post(
        '/api/v1/reviews',
        data: {
          'establishmentId': establishmentId,
          'rating': rating,
          if (text != null && text.isNotEmpty) 'content': text,
        },
      );

      if (response.statusCode == 201 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        // Backend returns: { success: true, data: { review: {...} } }
        final innerData = data['data'] as Map<String, dynamic>?;
        final reviewData = innerData?['review'] ?? innerData ?? data;
        return Review.fromJson(reviewData as Map<String, dynamic>);
      }
      return null;
    } catch (e) {
      rethrow;
    }
  }

  /// Update an existing review (requires authentication)
  Future<Review?> updateReview({
    required String reviewId,  // UUID from backend
    int? rating,
    String? text,
  }) async {
    try {
      final response = await _apiClient.put(
        '/api/v1/reviews/$reviewId',
        data: {
          if (rating != null) 'rating': rating,
          if (text != null) 'content': text,  // Backend expects 'content'
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        // Backend returns: { success: true, data: { review: {...} } }
        final innerData = data['data'] as Map<String, dynamic>?;
        final reviewData = innerData?['review'] ?? innerData ?? data;
        return Review.fromJson(reviewData as Map<String, dynamic>);
      }
      return null;
    } catch (e) {
      rethrow;
    }
  }

  /// Delete a review (requires authentication)
  ///
  /// Отказ и сбой летят наверх `DioException`: человек должен прочесть, что
  /// ответил сервер, а не гадать, почему отзыв остался (проход тестировщика
  /// 17.10, Х26). `false` — только непонятный успешный ответ.
  Future<bool> deleteReview(String reviewId) async {  // UUID from backend
    final response = await _apiClient.delete('/api/v1/reviews/$reviewId');
    return response.statusCode == 200 || response.statusCode == 204;
  }

  // ============================================================================
  // Partner Response Operations
  // ============================================================================

  /// Add or update partner response to a review (requires partner authentication)
  ///
  /// [reviewId] - The review ID (UUID)
  /// [response] - Response text (10-1000 characters)
  Future<Review?> addPartnerResponse({
    required String reviewId,
    required String response,
  }) async {
    try {
      final apiResponse = await _apiClient.post(
        '/api/v1/reviews/$reviewId/response',
        data: {'response': response},
      );

      if (apiResponse.statusCode == 200 && apiResponse.data is Map<String, dynamic>) {
        final data = apiResponse.data as Map<String, dynamic>;
        // Backend returns: { success: true, data: { review: {...} } }
        final innerData = data['data'] as Map<String, dynamic>?;
        final reviewData = innerData?['review'] ?? innerData ?? data;
        return Review.fromJson(reviewData as Map<String, dynamic>);
      }
      return null;
    } catch (e) {
      rethrow;
    }
  }

  /// Delete partner response from a review (requires partner authentication)
  ///
  /// [reviewId] - The review ID (UUID)
  ///
  /// Отказ и сбой летят наверх — см. [deleteReview].
  Future<bool> deletePartnerResponse(String reviewId) async {
    final response =
        await _apiClient.delete('/api/v1/reviews/$reviewId/response');
    return response.statusCode == 200 || response.statusCode == 204;
  }

  // ============================================================================
  // User Review Operations
  // ============================================================================

  /// Get user's reviews by user ID
  ///
  /// [userId] - UUID of the user
  /// [page] - Page number (default: 1)
  /// [limit] - Items per page (default: 20)
  ///
  /// Сбой летит наверх — см. [getReviewsForEstablishment]: «Мои отзывы» не
  /// выдают его за «У вас пока нет отзывов».
  Future<UserReviewsResponse> getUserReviews({
    required String userId,
    int page = 1,
    int limit = 20,
  }) async {
    final response = await _apiClient.get(
      '/api/v1/users/$userId/reviews',
      queryParameters: {
        'page': page,
        'limit': limit,
      },
    );

    if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
      return UserReviewsResponse.fromJson(response.data as Map<String, dynamic>);
    }
    throw Exception('Unexpected response format');
  }
}
