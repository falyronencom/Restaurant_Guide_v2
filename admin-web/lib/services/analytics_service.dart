import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for admin analytics endpoints (Segment D)
class AnalyticsService {
  final ApiClient _apiClient;

  static final AnalyticsService _instance = AnalyticsService._internal();
  factory AnalyticsService() => _instance;

  AnalyticsService._internal() : _apiClient = ApiClient();

  /// GET /api/v1/admin/analytics/overview
  Future<OverviewData> getOverview({
    String period = '30d',
    String? from,
    String? to,
  }) async {
    final queryParams = <String, dynamic>{};
    if (from != null && to != null) {
      queryParams['from'] = from;
      queryParams['to'] = to;
    } else {
      queryParams['period'] = period;
    }

    final response = await _apiClient.get(
      '/api/v1/admin/analytics/overview',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    return OverviewData.fromJson(data['data'] as Map<String, dynamic>);
  }

  /// GET /api/v1/admin/analytics/users
  Future<UsersAnalyticsData> getUsersAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) async {
    final queryParams = <String, dynamic>{};
    if (from != null && to != null) {
      queryParams['from'] = from;
      queryParams['to'] = to;
    } else {
      queryParams['period'] = period;
    }

    final response = await _apiClient.get(
      '/api/v1/admin/analytics/users',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    return UsersAnalyticsData.fromJson(data['data'] as Map<String, dynamic>);
  }

  /// GET /api/v1/admin/analytics/establishments
  Future<EstablishmentsAnalyticsData> getEstablishmentsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) async {
    final queryParams = <String, dynamic>{};
    if (from != null && to != null) {
      queryParams['from'] = from;
      queryParams['to'] = to;
    } else {
      queryParams['period'] = period;
    }

    final response = await _apiClient.get(
      '/api/v1/admin/analytics/establishments',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    return EstablishmentsAnalyticsData.fromJson(
        data['data'] as Map<String, dynamic>);
  }

  /// GET /api/v1/admin/analytics/reviews
  Future<ReviewsAnalyticsData> getReviewsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) async {
    final queryParams = <String, dynamic>{};
    if (from != null && to != null) {
      queryParams['from'] = from;
      queryParams['to'] = to;
    } else {
      queryParams['period'] = period;
    }

    final response = await _apiClient.get(
      '/api/v1/admin/analytics/reviews',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    return ReviewsAnalyticsData.fromJson(
        data['data'] as Map<String, dynamic>);
  }
}
