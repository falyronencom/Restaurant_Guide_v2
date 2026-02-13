import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';

/// State management for the Users analytics tab
class UsersAnalyticsProvider with ChangeNotifier {
  final AnalyticsService _service;

  UsersAnalyticsData? _data;
  bool _isLoading = false;
  String? _error;
  String _period = '30d';
  String? _customFrom;
  String? _customTo;

  UsersAnalyticsProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService();

  UsersAnalyticsData? get data => _data;
  bool get isLoading => _isLoading;
  String? get error => _error;
  String get period => _period;

  Future<void> load({String? period, String? from, String? to}) async {
    if (period != null) _period = period;
    if (from != null) _customFrom = from;
    if (to != null) _customTo = to;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _data = await _service.getUsersAnalytics(
        period: _period,
        from: _customFrom,
        to: _customTo,
      );
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
