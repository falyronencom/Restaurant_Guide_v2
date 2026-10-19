import 'package:restaurant_guide_mobile/models/public_menu_item.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Распознанное меню заведения для гостя — тот же публичный адрес, что у
/// сайта: `GET /api/v1/public/establishments/by-slug/:slug/menu-items`.
/// Отдельный ленивый запрос, не в ответе карточки (SDL CAT-D-1.6).
class PublicMenuService {
  final ApiClient _apiClient;

  static final PublicMenuService _instance = PublicMenuService._internal();
  factory PublicMenuService() => _instance;

  PublicMenuService._internal() : _apiClient = ApiClient();

  /// Позиции меню в порядке сервера. Сбой (нет сети, отказ сервера, чужая
  /// форма ответа) летит наверх: «меню нет» и «не загрузилось» экран
  /// различает сам, как в отзывах.
  Future<List<PublicMenuItem>> getMenuItems(String slug) async {
    final response = await _apiClient.get(
      '/api/v1/public/establishments/by-slug/${Uri.encodeComponent(slug)}/menu-items',
    );

    final body = response.data;
    if (response.statusCode == 200 && body is Map<String, dynamic>) {
      final data = body['data'];
      final items = data is Map<String, dynamic> ? data['menu_items'] : null;
      if (items is List) {
        return [
          for (final row in items)
            PublicMenuItem.fromJson(row as Map<String, dynamic>),
        ];
      }
    }
    throw Exception('Unexpected response format');
  }
}
