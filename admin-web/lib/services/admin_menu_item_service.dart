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
      AdminMenuItemService.withClient(ApiClient());
  factory AdminMenuItemService() => _instance;

  /// Собирает сервис поверх переданного клиента.
  ///
  /// Прод не меняется: фабрика по-прежнему отдаёт синглтон. Доступный
  /// генеративный конструктор нужен затем, что класс с одним лишь приватным
  /// конструктором нечем подменить в тесте — ни поверх, ни наследованием.
  AdminMenuItemService.withClient(this._apiClient);

  /// Страница очереди. ВСЕ фильтры серверные — клиентских здесь больше нет:
  /// очередь листается, и отбор поверх одной страницы отвечал бы не на тот
  /// вопрос, который показывает.
  ///
  /// Пустые строки не отправляются: сервер отвергает повторённый параметр и
  /// не сужает выборку по пробелам, но и грузить провод пустотой незачем.
  Future<FlaggedMenuItemsResponse> getFlaggedItems({
    int page = 1,
    int perPage = 20,
    String? reason,
    String? visibility,
    String? city,
    String? search,
  }) async {
    final query = <String, dynamic>{
      'page': page,
      'per_page': perPage,
      if (reason != null && reason.isNotEmpty) 'reason': reason,
      if (visibility != null && visibility.isNotEmpty) 'visibility': visibility,
      if (city != null && city.isNotEmpty) 'city': city,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
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
    final counts = meta['counts'] as Map<String, dynamic>? ?? const {};

    return FlaggedMenuItemsResponse(
      items: list,
      total: meta['total'] as int? ?? list.length,
      page: meta['page'] as int? ?? page,
      // Ноль страниц — не «страниц нет», а отсутствие поля: пустая выборка
      // приезжает единицей. Фолбэк на 1 нужен на случай старого ответа.
      pages: meta['pages'] as int? ?? 1,
      perPage: meta['per_page'] as int? ?? perPage,
      // Оставлены пустыми, если сервер их не прислал: вывести вторую половину
      // из total нельзя — на отборе «Скрытые» total и есть число скрытых.
      // Подпись экрана в таком случае просто промолчит про неё.
      visibleCount: counts['visible'] as int?,
      hiddenCount: counts['hidden'] as int?,
      cities: _stringList(meta['cities']),
      reasons: _stringList(meta['reasons']),
    );
  }

  static List<String> _stringList(dynamic value) {
    if (value is! List) return const <String>[];
    return value.map((e) => e.toString()).toList();
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
