import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for audit log viewer endpoint
class AuditLogService {
  final ApiClient _apiClient;

  static final AuditLogService _instance =
      AuditLogService.withClient(ApiClient());
  factory AuditLogService() => _instance;

  /// Собирает сервис поверх переданного клиента.
  ///
  /// Прод не меняется: фабрика по-прежнему отдаёт синглтон. Доступный
  /// генеративный конструктор нужен затем, что класс с одним лишь приватным
  /// конструктором нечем подменить в тесте — ни поверх, ни наследованием.
  AuditLogService.withClient(this._apiClient);

  /// GET /api/v1/admin/audit-log
  Future<AuditLogListResponse> getAuditLog({
    int page = 1,
    int perPage = 20,
    String? action,
    String? entityType,
    DateTime? from,
    DateTime? to,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'per_page': perPage,
    };
    if (action != null && action.isNotEmpty) queryParams['action'] = action;
    // Фильтр по типу объекта эндпоинт принимал с самого начала — на клиенте
    // его просто не было, как не было и имени заведения в колонке «Объект».
    if (entityType != null && entityType.isNotEmpty) {
      queryParams['entity_type'] = entityType;
    }
    // Границы уходят в UTC, а не в местном времени.
    //
    // `created_at` в `audit_log` — `timestamp without time zone`, и хранится
    // там стенное время UTC (сервер БД живёт в `Etc/UTC`). Местный
    // `toIso8601String()` даёт строку БЕЗ `Z`, Postgres берёт её как есть, и
    // минское стенное время сравнивается с UTC-стенным — окно съезжает на три
    // часа. С суффиксом `Z` Postgres при касте в `timestamp` отбрасывает зону
    // и берёт ровно UTC-поля, что хранению и соответствует.
    if (from != null) queryParams['from'] = from.toUtc().toIso8601String();
    if (to != null) queryParams['to'] = to.toUtc().toIso8601String();

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
