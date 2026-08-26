import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_tab_provider.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';

/// Вкладка «Заведения».
class EstablishmentsAnalyticsProvider
    extends AnalyticsTabProvider<EstablishmentsAnalyticsData> {
  final AnalyticsService _service;

  EstablishmentsAnalyticsProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService();

  @override
  Future<EstablishmentsAnalyticsData> fetch(PeriodSelection selection) =>
      _service.getEstablishmentsAnalytics(
        period: selection.period,
        from: selection.fromParam,
        to: selection.toParam,
      );
}
