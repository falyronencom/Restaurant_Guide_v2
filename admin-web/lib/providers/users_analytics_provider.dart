import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_tab_provider.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';

/// Вкладка «Пользователи».
class UsersAnalyticsProvider extends AnalyticsTabProvider<UsersAnalyticsData> {
  final AnalyticsService _service;

  UsersAnalyticsProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService();

  @override
  Future<UsersAnalyticsData> fetch(PeriodSelection selection) =>
      _service.getUsersAnalytics(
        period: selection.period,
        from: selection.fromParam,
        to: selection.toParam,
      );
}
