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
  ///
  /// [force] добавляет `?refresh=1` — обход снимка на сервере. Без него кнопка
  /// «Обновить» внутри времени жизни снимка вернула бы то же самое, и нажатие
  /// осталось бы без всякого следа на экране.
  Future<QualityHealthData> getHealth({bool force = false}) async {
    final response = await _apiClient.get(
      '/api/v1/admin/quality/health',
      queryParameters: force ? const {'refresh': '1'} : null,
    );
    final data = response.data as Map<String, dynamic>;
    return QualityHealthData.fromJson(data['data'] as Map<String, dynamic>);
  }
}
