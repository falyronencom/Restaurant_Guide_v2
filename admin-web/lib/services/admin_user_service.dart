import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

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
  }) async {
    final queryParams = <String, dynamic>{'page': page, 'per_page': perPage};
    if (search != null && search.isNotEmpty) queryParams['search'] = search;
    if (status != null && status.isNotEmpty) queryParams['status'] = status;

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
    final response = await _apiClient.get('/api/v1/admin/users/$id');
    final data = response.data as Map<String, dynamic>;
    return AdminUser.fromJson(data['data'] as Map<String, dynamic>);
  }

  /// POST /api/v1/admin/users/:id/block — `{ reason }`. `true` — заблокирован
  /// этим запросом, `false` — уже был заблокирован.
  Future<bool> block(String id, {required String reason}) =>
      _act(id, 'block', reason);

  /// POST /api/v1/admin/users/:id/unblock — `{ reason, restore_reviews }`.
  ///
  /// [restoreReviews] `false` — отзывы, скрытые блокировкой, остаются
  /// скрытыми: блокируют часто за сами отзывы.
  Future<bool> unblock(
    String id, {
    required String reason,
    bool restoreReviews = true,
  }) =>
      _act(id, 'unblock', reason,
          extra: <String, dynamic>{'restore_reviews': restoreReviews});

  /// POST /api/v1/admin/users/:id/reset-name — `{ reason }`
  Future<bool> resetName(String id, {required String reason}) =>
      _act(id, 'reset-name', reason);

  Future<bool> _act(
    String id,
    String action,
    String reason, {
    Map<String, dynamic> extra = const <String, dynamic>{},
  }) async {
    final response = await _apiClient.post(
      '/api/v1/admin/users/$id/$action',
      data: <String, dynamic>{'reason': reason, ...extra},
    );
    final body = response.data;
    final data = body is Map<String, dynamic> ? body['data'] : null;
    // Флаг потерян — считаем, что изменилось: так говорит и сам ответ 200.
    return data is Map<String, dynamic> ? data['changed'] != false : true;
  }
}
