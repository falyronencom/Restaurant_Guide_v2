import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_tab_provider.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';

/// Вкладка «Отзывы и оценки».
class ReviewsAnalyticsProvider
    extends AnalyticsTabProvider<ReviewsAnalyticsData> {
  final AnalyticsService _service;

  ReviewsAnalyticsProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService();

  @override
  Future<ReviewsAnalyticsData> fetch(PeriodSelection selection) =>
      _service.getReviewsAnalytics(
        period: selection.period,
        from: selection.fromParam,
        to: selection.toParam,
      );
}
