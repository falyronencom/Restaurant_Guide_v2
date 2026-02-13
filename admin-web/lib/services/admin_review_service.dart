import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for admin review management endpoints
class AdminReviewService {
  final ApiClient _apiClient;

  static final AdminReviewService _instance = AdminReviewService._internal();
  factory AdminReviewService() => _instance;

  AdminReviewService._internal() : _apiClient = ApiClient();

  /// GET /api/v1/admin/reviews
  Future<AdminReviewListResponse> getReviews({
    int page = 1,
    int perPage = 20,
    String? status,
    int? rating,
    String? search,
    String? sort,
    DateTime? from,
    DateTime? to,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'per_page': perPage,
    };
    if (status != null && status.isNotEmpty) queryParams['status'] = status;
    if (rating != null) queryParams['rating'] = rating;
    if (search != null && search.isNotEmpty) queryParams['search'] = search;
    if (sort != null && sort.isNotEmpty) queryParams['sort'] = sort;
    if (from != null) queryParams['from'] = from.toIso8601String();
    if (to != null) queryParams['to'] = to.toIso8601String();

    final response = await _apiClient.get(
      '/api/v1/admin/reviews',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>? ?? [])
        .map((e) => AdminReviewItem.fromJson(e as Map<String, dynamic>))
        .toList();

    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return AdminReviewListResponse(
      reviews: items,
      total: meta['total'] as int? ?? items.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }

  /// POST /api/v1/admin/reviews/:id/toggle-visibility
  Future<void> toggleVisibility(String id) async {
    await _apiClient.post('/api/v1/admin/reviews/$id/toggle-visibility');
  }

  /// POST /api/v1/admin/reviews/:id/delete
  Future<void> deleteReview(String id, {String? reason}) async {
    final data = <String, dynamic>{};
    if (reason != null && reason.isNotEmpty) data['reason'] = reason;

    await _apiClient.post(
      '/api/v1/admin/reviews/$id/delete',
      data: data.isNotEmpty ? data : null,
    );
  }
}
