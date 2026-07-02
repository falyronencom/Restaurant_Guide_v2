import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for the admin quality-health endpoint (AI-ops Brick-1).
class QualityHealthService {
  final ApiClient _apiClient;

  static final QualityHealthService _instance =
      QualityHealthService._internal();
  factory QualityHealthService() => _instance;

  QualityHealthService._internal() : _apiClient = ApiClient();

  /// GET /api/v1/admin/quality/health
  Future<QualityHealthData> getHealth() async {
    final response = await _apiClient.get('/api/v1/admin/quality/health');
    final data = response.data as Map<String, dynamic>;
    return QualityHealthData.fromJson(data['data'] as Map<String, dynamic>);
  }
}
