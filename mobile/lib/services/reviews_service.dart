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
  Future<PaginatedReviews> getReviewsForEstablishment(
    String establishmentId, {
    int page = 1,
    int perPage = 10,
    String? sort,
  }) async {
    try {
      final response = await _apiClient.get(
        '/api/v1/establishments/$establishmentId/reviews',
        queryParameters: {
          'page': page,
          'per_page': perPage,
          if (sort != null) 'sort': sort,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        return PaginatedReviews.fromJson(response.data as Map<String, dynamic>);
      } else {
        throw Exception('Unexpected response format');
      }
    } catch (e) {
      // Return empty reviews on error
      return PaginatedReviews(
        data: [],
        meta: ReviewsPaginationMeta(
          total: 0,
          page: 1,
          perPage: perPage,
          totalPages: 0,
        ),
      );
    }
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
  Future<bool> deleteReview(String reviewId) async {  // UUID from backend
    try {
      final response = await _apiClient.delete('/api/v1/reviews/$reviewId');
      return response.statusCode == 200 || response.statusCode == 204;
    } catch (e) {
      return false;
    }
  }

  /// Get current user's reviews (requires authentication)
  ///
  /// [page] - Page number (default: 1)
  /// [perPage] - Items per page (default: 20)
  Future<UserReviewsResponse> getUserReviews({
    int page = 1,
    int perPage = 20,
  }) async {
    try {
      final response = await _apiClient.get(
        '/api/v1/users/me/reviews',
        queryParameters: {
          'page': page,
          'per_page': perPage,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        return UserReviewsResponse.fromJson(response.data as Map<String, dynamic>);
      } else {
        throw Exception('Unexpected response format');
      }
    } catch (e) {
      // Return empty reviews on error
      return UserReviewsResponse(
        reviews: [],
        total: 0,
        page: 1,
        totalPages: 0,
      );
    }
  }
}
