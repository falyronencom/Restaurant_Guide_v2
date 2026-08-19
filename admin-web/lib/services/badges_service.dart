import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API-сервис счётчиков очередей.
class BadgesService {
  final ApiClient _apiClient;

  static final BadgesService _instance = BadgesService.withClient(ApiClient());
  factory BadgesService() => _instance;

  /// Точка внедрения для тестов: настоящий сервис поверх подставного клиента.
  BadgesService.withClient(this._apiClient);

  /// GET /api/v1/admin/badges
  Future<AdminBadges> getBadges() async {
    final response = await _apiClient.get('/api/v1/admin/badges');
    final data = response.data as Map<String, dynamic>;
    return AdminBadges.fromJson(data['data'] as Map<String, dynamic>);
  }
}
