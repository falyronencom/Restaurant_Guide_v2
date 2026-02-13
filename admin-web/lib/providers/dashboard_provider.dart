import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';

/// State management for the Dashboard screen
class DashboardProvider with ChangeNotifier {
  final AnalyticsService _service;

  OverviewData? _overview;
  List<TimelinePoint> _registrationTimeline = [];
  String _aggregation = 'day';
  bool _isLoading = false;
  String? _error;
  String _period = '30d';
  String? _customFrom;
  String? _customTo;

  DashboardProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService();

  // Getters
  OverviewData? get overview => _overview;
  List<TimelinePoint> get registrationTimeline => _registrationTimeline;
  String get aggregation => _aggregation;
  bool get isLoading => _isLoading;
  String? get error => _error;
  String get period => _period;

  /// Load dashboard data for the given period
  Future<void> loadDashboard({
    String? period,
    String? from,
    String? to,
  }) async {
    if (period != null) _period = period;
    if (from != null) _customFrom = from;
    if (to != null) _customTo = to;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final results = await Future.wait([
        _service.getOverview(
          period: _period,
          from: _customFrom,
          to: _customTo,
        ),
        _service.getUsersAnalytics(
          period: _period,
          from: _customFrom,
          to: _customTo,
        ),
      ]);

      _overview = results[0] as OverviewData;
      final usersData = results[1] as UsersAnalyticsData;
      _registrationTimeline = usersData.registrationTimeline;
      _aggregation = usersData.aggregation;
    } catch (e) {
      _error = _extractMessage(e);
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('Connection timeout')) return 'Превышено время ожидания';
    if (msg.contains('No internet')) return 'Нет подключения к серверу';
    if (msg.contains('403')) return 'Доступ запрещён';
    return 'Произошла ошибка. Попробуйте снова.';
  }
}
