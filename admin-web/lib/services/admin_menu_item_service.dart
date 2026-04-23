import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for admin moderation of parsed menu items (Segment C).
///
///   GET  /api/v1/admin/menu-items/flagged
///   POST /api/v1/admin/menu-items/:id/hide
///   POST /api/v1/admin/menu-items/:id/unhide
///   POST /api/v1/admin/menu-items/:id/dismiss-flag
class AdminMenuItemService {
  final ApiClient _apiClient;

  static final AdminMenuItemService _instance =
      AdminMenuItemService._internal();
  factory AdminMenuItemService() => _instance;

  AdminMenuItemService._internal() : _apiClient = ApiClient();

  /// Fetch a page of flagged menu items. Backend supports `reason` filter;
  /// city + status filters are applied client-side by the provider.
  Future<FlaggedMenuItemsResponse> getFlaggedItems({
    int page = 1,
    int perPage = 50,
    String? reason,
  }) async {
    final query = <String, dynamic>{
      'page': page,
      'per_page': perPage,
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    };

    final response = await _apiClient.get(
      '/api/v1/admin/menu-items/flagged',
      queryParameters: query,
    );

    final data = response.data as Map<String, dynamic>;
    final list = (data['data'] as List<dynamic>? ?? [])
        .map((e) => FlaggedMenuItem.fromJson(e as Map<String, dynamic>))
        .toList();
    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return FlaggedMenuItemsResponse(
      items: list,
      total: meta['total'] as int? ?? list.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }

  /// POST /hide — reason required.
  Future<Map<String, dynamic>> hideItem({
    required String menuItemId,
    required String reason,
  }) async {
    final response = await _apiClient.post(
      '/api/v1/admin/menu-items/$menuItemId/hide',
      data: {'reason': reason},
    );
    final data = response.data as Map<String, dynamic>;
    return data['data'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> unhideItem(String menuItemId) async {
    final response = await _apiClient.post(
      '/api/v1/admin/menu-items/$menuItemId/unhide',
    );
    final data = response.data as Map<String, dynamic>;
    return data['data'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> dismissFlag(String menuItemId) async {
    final response = await _apiClient.post(
      '/api/v1/admin/menu-items/$menuItemId/dismiss-flag',
    );
    final data = response.data as Map<String, dynamic>;
    return data['data'] as Map<String, dynamic>;
  }
}
