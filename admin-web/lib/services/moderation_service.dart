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
