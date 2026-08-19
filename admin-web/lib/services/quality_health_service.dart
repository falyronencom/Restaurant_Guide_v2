import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for the admin quality-health endpoint (AI-ops Brick-1).
class QualityHealthService {
  final ApiClient _apiClient;

  static final QualityHealthService _instance =
      QualityHealthService.withClient(ApiClient());
  factory QualityHealthService() => _instance;

  /// Собирает сервис поверх переданного клиента.
  ///
  /// Прод не меняется: фабрика по-прежнему отдаёт синглтон. Доступный
  /// генеративный конструктор нужен затем, что класс с одним лишь приватным
  /// конструктором нечем подменить в тесте — ни поверх, ни наследованием.
  QualityHealthService.withClient(this._apiClient);

  /// GET /api/v1/admin/quality/health
  Future<QualityHealthData> getHealth() async {
    final response = await _apiClient.get('/api/v1/admin/quality/health');
    final data = response.data as Map<String, dynamic>;
    return QualityHealthData.fromJson(data['data'] as Map<String, dynamic>);
  }
}
