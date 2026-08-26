import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/providers/reviews_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/distribution_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/timeline_chart.dart';

/// Analytics tab: Отзывы и оценки
///
/// ВРЕМЕННОЕ СОСТОЯНИЕ — проход A этапа 6 привёл к кадрам вкладки «Заведения»
/// и «Пользователи»; эта ждёт кадра 09 в проходе B. Здесь снят только
/// собственный сегмент-контрол периода — он переехал в шапку раздела и стоял
/// бы вторым. Остальное, включая `TimelineChart` с наложением оценки на шкалу
/// количества, живёт до прохода B.
class ReviewsAnalyticsTab extends StatelessWidget {
  const ReviewsAnalyticsTab({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<ReviewsAnalyticsProvider>(
      builder: (context, provider, _) {
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (provider.isLoading && provider.data == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(48),
                    child:
                        CircularProgressIndicator(color: Color(0xFFF06B32)),
                  ),
                )
              else if (provider.error != null && provider.data == null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.all(48),
                    child: Column(
                      children: [
                        Icon(Icons.error_outline,
                            size: 48, color: Colors.red[300]),
                        const SizedBox(height: 12),
                        Text(provider.error!,
                            style: TextStyle(color: Colors.red[600])),
                        const SizedBox(height: 12),
                        ElevatedButton(
                          onPressed: () => provider.load(),
                          child: const Text('Повторить'),
                        ),
                      ],
                    ),
                  ),
                )
              else if (provider.data != null) ...[
                // Timeline with dual series (count + avg rating)
                const Text('Активность отзывов',
                    style: TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                TimelineChart(
                  data: provider.data!.reviewTimeline,
                  aggregation: provider.data!.aggregation,
                  showSecondaryAxis: true,
                  primaryLabel: 'Количество отзывов',
                  secondaryLabel: 'Средняя оценка',
                  primaryColor: const Color(0xFFF39C12),
                  secondaryColor: const Color(0xFF3FD00D),
                ),
                const SizedBox(height: 24),

                // Rating distribution + response stats
                LayoutBuilder(
                  builder: (context, constraints) {
                    if (constraints.maxWidth > 700) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: RatingDistributionChart(
                              title: 'Распределение оценок',
                              data: provider.data!.ratingDistribution,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: _ResponseStatsCard(
                              stats: provider.data!.responseStats,
                            ),
                          ),
                        ],
                      );
                    }
                    return Column(
                      children: [
                        RatingDistributionChart(
                          title: 'Распределение оценок',
                          data: provider.data!.ratingDistribution,
                        ),
                        const SizedBox(height: 16),
                        _ResponseStatsCard(
                          stats: provider.data!.responseStats,
                        ),
                      ],
                    );
                  },
                ),

                if (provider.isLoading)
                  const Padding(
                    padding: EdgeInsets.only(top: 16),
                    child: Center(
                      child: SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Color(0xFFF06B32),
                        ),
                      ),
                    ),
                  ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _ResponseStatsCard extends StatelessWidget {
  final dynamic stats;

  const _ResponseStatsCard({required this.stats});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Ответы партнёров',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1A1A1A),
            ),
          ),
          const SizedBox(height: 20),
          _statRow(
            'Отзывов с ответом',
            '${stats.totalWithResponse}',
            Icons.reply,
          ),
          const SizedBox(height: 12),
          _statRow(
            'Процент ответов',
            // Через общий форматтер: `toStringAsFixed` ставит латинскую точку,
            // и «23.1%» стояло в русском интерфейсе рядом с «88,6%».
            '${formatDecimal(stats.responseRate * 100)}%',
            Icons.percent,
          ),
          const SizedBox(height: 12),
          _statRow(
            'Среднее время ответа',
            _formatHours(stats.avgResponseTimeHours),
            Icons.schedule,
          ),
        ],
      ),
    );
  }

  Widget _statRow(String label, String value, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 18, color: Colors.grey[400]),
        const SizedBox(width: 10),
        Expanded(
          child: Text(label,
              style: TextStyle(fontSize: 13, color: Colors.grey[600])),
        ),
        Text(
          value,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: Color(0xFF1A1A1A),
          ),
        ),
      ],
    );
  }

  String _formatHours(double hours) {
    if (hours < 1) return '${(hours * 60).toStringAsFixed(0)} мин';
    if (hours < 24) return '${hours.toStringAsFixed(1)} ч';
    final days = (hours / 24).toStringAsFixed(1);
    return '$days д';
  }
}
