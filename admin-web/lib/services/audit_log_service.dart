import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for audit log viewer endpoint
class AuditLogService {
  final ApiClient _apiClient;

  static final AuditLogService _instance = AuditLogService._internal();
  factory AuditLogService() => _instance;

  AuditLogService._internal() : _apiClient = ApiClient();

  /// GET /api/v1/admin/audit-log
  Future<AuditLogListResponse> getAuditLog({
    int page = 1,
    int perPage = 20,
    String? action,
    DateTime? from,
    DateTime? to,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'per_page': perPage,
    };
    if (action != null && action.isNotEmpty) queryParams['action'] = action;
    if (from != null) queryParams['from'] = from.toIso8601String();
    if (to != null) queryParams['to'] = to.toIso8601String();

    final response = await _apiClient.get(
      '/api/v1/admin/audit-log',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>? ?? [])
        .map((e) => AuditLogEntry.fromJson(e as Map<String, dynamic>))
        .toList();

    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return AuditLogListResponse(
      entries: items,
      total: meta['total'] as int? ?? items.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }
}
