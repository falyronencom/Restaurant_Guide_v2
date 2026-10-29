import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';
import 'package:restaurant_guide_admin_web/utils/id_format.dart';

/// API экрана «Пользователи»: найти человека, заблокировать, разблокировать,
/// сбросить имя (проход тестировщика 17.10, п. 8).
///
/// Действия задают состояние явно, а не переключают: клиент повторяет запрос
/// при 5xx (api_client.dart), и повтор «заблокировать» обязан снова означать
/// «заблокировать». Сервер на повтор ничего не пишет второй раз и отвечает
/// `changed: false` — его действия возвращают этот флаг.
class AdminUserService {
  final ApiClient _apiClient;

  static final AdminUserService _instance =
      AdminUserService.withClient(ApiClient());
  factory AdminUserService() => _instance;

  /// Сервис поверх переданного клиента — для тестов (стенд admin-web).
  AdminUserService.withClient(this._apiClient);

  /// GET /api/v1/admin/users
  Future<AdminUserListResponse> getUsers({
    int page = 1,
    int perPage = 20,
    String? search,
    String? status,
    String? role,
  }) async {
    final queryParams = <String, dynamic>{'page': page, 'per_page': perPage};
    if (search != null && search.isNotEmpty) queryParams['search'] = search;
    if (status != null && status.isNotEmpty) queryParams['status'] = status;
    if (role != null && role.isNotEmpty) queryParams['role'] = role;

    final response = await _apiClient.get(
      '/api/v1/admin/users',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    final users = (data['data'] as List<dynamic>? ?? const <dynamic>[])
        .map((e) => AdminUser.fromJson(e as Map<String, dynamic>))
        .toList();
    final meta = data['meta'] as Map<String, dynamic>? ?? const {};

    return AdminUserListResponse(
      users: users,
      total: meta['total'] as int? ?? users.length,
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }

  /// GET /api/v1/admin/users/:id
  Future<AdminUser> getUser(String id) async {
    final response = await _apiClient.get('/api/v1/admin/users/${idPathSegment(id)}');
    final data = response.data as Map<String, dynamic>;
    return AdminUser.fromJson(data['data'] as Map<String, dynamic>);
  }

  /// POST /api/v1/admin/users/:id/block — `{ reason }`. `changed: false` —
  /// уже был заблокирован; `hiddenReviews` — сколько видимых отзывов скрыто.
  Future<AdminUserBlockResult> block(String id, {required String reason}) async {
    final data = await _act(id, 'block', reason);
    return AdminUserBlockResult(
      changed: _changed(data),
      hiddenReviews: data?['hidden_reviews'] as int?,
    );
  }

  /// POST /api/v1/admin/users/:id/unblock — `{ reason, restore_reviews }`.
  ///
  /// [restoreReviews] `false` — отзывы, скрытые блокировкой, остаются
  /// скрытыми: блокируют часто за сами отзывы.
  Future<AdminUserUnblockResult> unblock(
    String id, {
    required String reason,
    bool restoreReviews = true,
  }) async {
    final data = await _act(id, 'unblock', reason,
        extra: <String, dynamic>{'restore_reviews': restoreReviews});
    return data == null
        ? const AdminUserUnblockResult(changed: true)
        : AdminUserUnblockResult.fromJson(data);
  }

  /// POST /api/v1/admin/users/:id/reset-name — `{ reason }`
  Future<bool> resetName(String id, {required String reason}) async =>
      _changed(await _act(id, 'reset-name', reason));

  // Флаг потерян — считаем, что изменилось: так говорит и сам ответ 200.
  static bool _changed(Map<String, dynamic>? data) =>
      data == null || data['changed'] != false;

  Future<Map<String, dynamic>?> _act(
    String id,
    String action,
    String reason, {
    Map<String, dynamic> extra = const <String, dynamic>{},
  }) async {
    final response = await _apiClient.post(
      '/api/v1/admin/users/${idPathSegment(id)}/$action',
      data: <String, dynamic>{'reason': reason, ...extra},
    );
    final body = response.data;
    final data = body is Map<String, dynamic> ? body['data'] : null;
    return data is Map<String, dynamic> ? data : null;
  }
}
