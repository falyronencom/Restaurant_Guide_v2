import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

/// State management for the Dashboard screen
class DashboardProvider with ChangeNotifier {
  final AnalyticsService _service;

  OverviewData? _overview;
  List<TimelinePoint> _registrationTimeline = [];
  String _aggregation = 'day';
  bool _isLoading = false;
  String? _error;

  /// Период целиком, а не код отдельно от границ.
  ///
  /// Прежде границы жили своими полями и затирались только непустым значением,
  /// а сервис предпочитает `from`/`to` коду периода: выбрать «Период», затем
  /// «7 дней» — и подсвечено «7 дней», а данные остались за произвольный
  /// диапазон. `PeriodSelection` такое состояние не выражает вовсе.
  PeriodSelection _selection = const PeriodSelection(period: '30d');

  /// Период, за который посчитаны лежащие числа, — тот же приём, что у
  /// вкладок аналитики. Смена периода, которая не удалась, оставляла под
  /// новой подсветкой числа прежнего и молчала (пункт A3-02).
  PeriodSelection? _loadedSelection;

  /// Счётчик поколений — как у вкладок аналитики: без него быстрая смена
  /// периода отдаёт победу ответившему последним, а не запрошенному последним.
  int _generation = 0;

  DashboardProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService() {
    AccountScope.register(resetAccountScope);
  }

  /// Сброс при смене аккаунта: сводка, таймлайн и период принадлежат
  /// вошедшему. Поколение сдвигается, чтобы летящий ответ был выброшен.
  void resetAccountScope() {
    _generation++;
    _overview = null;
    _registrationTimeline = [];
    _aggregation = 'day';
    _isLoading = false;
    _error = null;
    _selection = const PeriodSelection(period: '30d');
    _loadedSelection = null;
    notifyListeners();
  }

  // Getters
  OverviewData? get overview => _overview;
  List<TimelinePoint> get registrationTimeline => _registrationTimeline;
  String get aggregation => _aggregation;
  bool get isLoading => _isLoading;
  String? get error => _error;
  String get period => _selection.period;
  PeriodSelection get selection => _selection;

  /// Период лежащих чисел; `null` — чисел ещё нет.
  PeriodSelection? get loadedSelection => _loadedSelection;

  /// Числа на экране — за другой период, чем выбран: обновление не удалось.
  bool get isStale =>
      _overview != null && _loadedSelection?.key != _selection.key;

  /// Load dashboard data for the given period
  Future<void> loadDashboard([PeriodSelection? selection]) async {
    if (selection != null) _selection = selection;
    final requested = _selection;
    final generation = ++_generation;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final results = await Future.wait([
        _service.getOverview(
          period: requested.period,
          from: requested.fromParam,
          to: requested.toParam,
        ),
        _service.getUsersAnalytics(
          period: requested.period,
          from: requested.fromParam,
          to: requested.toParam,
        ),
      ]);

      if (generation != _generation) return;
      _overview = results[0] as OverviewData;
      final usersData = results[1] as UsersAnalyticsData;
      _registrationTimeline = usersData.registrationTimeline;
      _aggregation = usersData.aggregation;
      _loadedSelection = requested;
    } catch (e) {
      if (generation != _generation) return;
      _error = _extractMessage(e);
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  /// Текст отказа для модератора — общий разбор панели ([describeError]).
  String _extractMessage(Object error) =>
      describeError(error);
}
