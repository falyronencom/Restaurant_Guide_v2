import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for admin moderation endpoints
class ModerationService {
  final ApiClient _apiClient;

  static final ModerationService _instance = ModerationService._internal();
  factory ModerationService() => _instance;

  ModerationService._internal() : _apiClient = ApiClient();

  /// GET /api/v1/admin/establishments/pending
  Future<PendingListResponse> getPendingEstablishments({
    int page = 1,
    int perPage = 20,
  }) async {
    final response = await _apiClient.get(
      '/api/v1/admin/establishments/pending',
      queryParameters: {'page': page, 'per_page': perPage},
    );

    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>? ?? [])
        .map((e) =>
            EstablishmentListItem.fromJson(e as Map<String, dynamic>))
        .toList();

    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return PendingListResponse(
      establishments: items,
      total: meta['total'] as int? ?? items.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }

  /// GET /api/v1/admin/establishments/:id
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async {
    final response = await _apiClient.get(
      '/api/v1/admin/establishments/$id',
    );

    final data = response.data as Map<String, dynamic>;
    final establishment = data['data'] as Map<String, dynamic>? ?? data;

    return EstablishmentDetail.fromJson(establishment);
  }

  /// POST /api/v1/admin/establishments/:id/moderate
  Future<void> moderateEstablishment({
    required String id,
    required String action,
    Map<String, String> moderationNotes = const {},
  }) async {
    await _apiClient.post(
      '/api/v1/admin/establishments/$id/moderate',
      data: {
        'action': action,
        'moderation_notes': moderationNotes,
      },
    );
  }

  // ==========================================================================
  // Segment C: Active, Rejected, Suspend, Unsuspend, Search
  // ==========================================================================

  /// GET /api/v1/admin/establishments/active
  Future<ActiveListResponse> getActiveEstablishments({
    int page = 1,
    int perPage = 20,
    String? sort,
    String? city,
    String? search,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'per_page': perPage,
    };
    if (sort != null) queryParams['sort'] = sort;
    if (city != null) queryParams['city'] = city;
    if (search != null && search.isNotEmpty) queryParams['search'] = search;

    final response = await _apiClient.get(
      '/api/v1/admin/establishments/active',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>? ?? [])
        .map((e) =>
            ActiveEstablishmentItem.fromJson(e as Map<String, dynamic>))
        .toList();

    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return ActiveListResponse(
      establishments: items,
      total: meta['total'] as int? ?? items.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }

  /// GET /api/v1/admin/establishments/rejected
  Future<RejectedListResponse> getRejectedEstablishments({
    int page = 1,
    int perPage = 20,
  }) async {
    final response = await _apiClient.get(
      '/api/v1/admin/establishments/rejected',
      queryParameters: {'page': page, 'per_page': perPage},
    );

    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>? ?? [])
        .map((e) =>
            RejectedEstablishmentItem.fromJson(e as Map<String, dynamic>))
        .toList();

    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return RejectedListResponse(
      rejections: items,
      total: meta['total'] as int? ?? items.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }

  /// POST /api/v1/admin/establishments/:id/suspend
  Future<void> suspendEstablishment({
    required String id,
    required String reason,
  }) async {
    await _apiClient.post(
      '/api/v1/admin/establishments/$id/suspend',
      data: {'reason': reason},
    );
  }

  /// POST /api/v1/admin/establishments/:id/unsuspend
  Future<void> unsuspendEstablishment({required String id}) async {
    await _apiClient.post(
      '/api/v1/admin/establishments/$id/unsuspend',
    );
  }

  /// PATCH /api/v1/admin/establishments/:id/coordinates
  Future<void> updateCoordinates({
    required String id,
    required double latitude,
    required double longitude,
  }) async {
    await _apiClient.patch(
      '/api/v1/admin/establishments/$id/coordinates',
      data: {
        'latitude': latitude,
        'longitude': longitude,
      },
    );
  }

  /// GET /api/v1/admin/establishments/search
  Future<SearchListResponse> searchEstablishments({
    required String search,
    String? status,
    String? city,
    int page = 1,
    int perPage = 20,
  }) async {
    final queryParams = <String, dynamic>{
      'search': search,
      'page': page,
      'per_page': perPage,
    };
    if (status != null) queryParams['status'] = status;
    if (city != null) queryParams['city'] = city;

    final response = await _apiClient.get(
      '/api/v1/admin/establishments/search',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>? ?? [])
        .map((e) =>
            SearchResultItem.fromJson(e as Map<String, dynamic>))
        .toList();

    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return SearchListResponse(
      establishments: items,
      total: meta['total'] as int? ?? items.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }
}

/// Response wrapper for the pending list endpoint
class PendingListResponse {
  final List<EstablishmentListItem> establishments;
  final int total;
  final int page;
  final int pages;

  const PendingListResponse({
    required this.establishments,
    required this.total,
    required this.page,
    required this.pages,
  });
}

/// Response wrapper for the active list endpoint
class ActiveListResponse {
  final List<ActiveEstablishmentItem> establishments;
  final int total;
  final int page;
  final int pages;

  const ActiveListResponse({
    required this.establishments,
    required this.total,
    required this.page,
    required this.pages,
  });
}

/// Response wrapper for the rejected list endpoint
class RejectedListResponse {
  final List<RejectedEstablishmentItem> rejections;
  final int total;
  final int page;
  final int pages;

  const RejectedListResponse({
    required this.rejections,
    required this.total,
    required this.page,
    required this.pages,
  });
}

/// Response wrapper for the search endpoint
class SearchListResponse {
  final List<SearchResultItem> establishments;
  final int total;
  final int page;
  final int pages;

  const SearchListResponse({
    required this.establishments,
    required this.total,
    required this.page,
    required this.pages,
  });
}
