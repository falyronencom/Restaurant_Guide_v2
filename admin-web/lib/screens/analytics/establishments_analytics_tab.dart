import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/distribution_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/timeline_chart.dart';

// Status labels: English → Russian
const _statusToRussian = {
  'active': 'Активные',
  'draft': 'Черновик',
  'pending': 'На модерации',
  'suspended': 'Приостановлен',
  'archived': 'Архив',
  'rejected': 'Отклонён',
};

// Category labels: English → Russian (matches mobile/establishment.dart)
const _categoryToRussian = {
  'restaurant': 'Ресторан',
  'cafe': 'Кофейня',
  'fast_food': 'Фаст-фуд',
  'pizzeria': 'Пиццерия',
  'bar': 'Бар',
  'pub': 'Паб',
  'bakery': 'Пекарня',
  'confectionery': 'Кондитерская',
  'karaoke': 'Караоке',
  'canteen': 'Столовая',
  'hookah_bar': 'Кальянная',
  'hookah_lounge': 'Кальянная',
  'bowling': 'Боулинг',
  'billiards': 'Бильярд',
  'nightclub': 'Клуб',
};

/// Translate label using a mapping, return as-is if no match
List<DistributionItem> _translateLabels(
  List<DistributionItem> data,
  Map<String, String> mapping,
) {
  return data
      .map((item) => DistributionItem(
            label: mapping[item.label.toLowerCase()] ?? item.label,
            count: item.count,
            percentage: item.percentage,
          ))
      .toList();
}

/// Analytics tab: Заведения
class EstablishmentsAnalyticsTab extends StatefulWidget {
  const EstablishmentsAnalyticsTab({super.key});

  @override
  State<EstablishmentsAnalyticsTab> createState() =>
      _EstablishmentsAnalyticsTabState();
}

class _EstablishmentsAnalyticsTabState
    extends State<EstablishmentsAnalyticsTab> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = context.read<EstablishmentsAnalyticsProvider>();
      if (provider.data == null) provider.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<EstablishmentsAnalyticsProvider>(
      builder: (context, provider, _) {
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Period selector + summary
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  PeriodSelector(
                    currentPeriod: provider.period,
                    onPeriodChanged: (s) => provider.load(
                      period: s.period,
                      from: s.from?.toIso8601String(),
                      to: s.to?.toIso8601String(),
                    ),
                  ),
                  if (provider.data != null)
                    _SummaryRow(
                      total: provider.data!.total,
                      active: provider.data!.active,
                      newInPeriod: provider.data!.newInPeriod,
                      changePercent: provider.data!.changePercent,
                    ),
                ],
              ),
              const SizedBox(height: 24),

              if (provider.isLoading && provider.data == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(48),
                    child:
                        CircularProgressIndicator(color: Color(0xFFF06B32)),
                  ),
                )
              else if (provider.error != null && provider.data == null)
                _ErrorState(
                  message: provider.error!,
                  onRetry: () => provider.load(),
                )
              else if (provider.data != null) ...[
                // Timeline
                const Text('Создание заведений',
                    style: TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                TimelineChart(
                  data: provider.data!.creationTimeline,
                  aggregation: provider.data!.aggregation,
                  primaryLabel: 'Новые заведения',
                  primaryColor: const Color(0xFFF06B32),
                ),
                const SizedBox(height: 24),

                // Distribution charts row
                LayoutBuilder(
                  builder: (context, constraints) {
                    final statusData = _translateLabels(
                      provider.data!.statusDistribution,
                      _statusToRussian,
                    );
                    final categoryData = _translateLabels(
                      provider.data!.categoryDistribution,
                      _categoryToRussian,
                    );

                    if (constraints.maxWidth > 900) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: DistributionChart(
                              title: 'По статусу',
                              data: statusData,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: DistributionChart(
                              title: 'По городу',
                              data: provider.data!.cityDistribution,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: _CategoryProgressList(
                              title: 'По категориям',
                              data: categoryData,
                            ),
                          ),
                        ],
                      );
                    }
                    return Column(
                      children: [
                        DistributionChart(
                          title: 'По статусу',
                          data: statusData,
                        ),
                        const SizedBox(height: 16),
                        DistributionChart(
                          title: 'По городу',
                          data: provider.data!.cityDistribution,
                        ),
                        const SizedBox(height: 16),
                        _CategoryProgressList(
                          title: 'По категориям',
                          data: categoryData,
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

class _SummaryRow extends StatelessWidget {
  final int total;
  final int active;
  final int newInPeriod;
  final double? changePercent;

  const _SummaryRow({
    required this.total,
    required this.active,
    required this.newInPeriod,
    this.changePercent,
  });

  @override
  Widget build(BuildContext context) {
    final changeText = changePercent != null
        ? '${changePercent! > 0 ? '+' : ''}${changePercent!.toStringAsFixed(1)}%'
        : 'N/A';
    final changeColor = changePercent == null
        ? Colors.grey[500]
        : changePercent! > 0
            ? const Color(0xFF3FD00D)
            : changePercent! < 0
                ? Colors.red[600]
                : Colors.grey[500];

    return Row(
      children: [
        _chip('Всего: $total'),
        const SizedBox(width: 8),
        _chip('Активных: $active'),
        const SizedBox(width: 8),
        _chip('+$newInPeriod за период'),
        const SizedBox(width: 8),
        Text(changeText,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: changeColor,
            )),
      ],
    );
  }

  Widget _chip(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.grey[100],
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(text,
          style: TextStyle(fontSize: 12, color: Colors.grey[700])),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(48),
        child: Column(
          children: [
            Icon(Icons.error_outline, size: 48, color: Colors.red[300]),
            const SizedBox(height: 12),
            Text(message, style: TextStyle(color: Colors.red[600])),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: onRetry,
              child: const Text('Повторить'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Clean progress-bar list for category distribution.
/// Each row: category name | progress bar | count.
/// Sorted by count descending (data comes pre-sorted from backend).
class _CategoryProgressList extends StatelessWidget {
  final String title;
  final List<DistributionItem> data;

  const _CategoryProgressList({
    required this.title,
    required this.data,
  });

  static const _barColor = Color(0xFFF06B32);

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty || data.every((d) => d.count == 0)) {
      return _buildEmptyState();
    }

    final maxCount = data.fold<int>(0, (m, d) => d.count > m ? d.count : m);

    return Container(
      padding: const EdgeInsets.all(16),
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
          Text(
            title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1A1A1A),
            ),
          ),
          const SizedBox(height: 16),
          ...data.map((item) => _buildRow(item, maxCount)),
        ],
      ),
    );
  }

  Widget _buildRow(DistributionItem item, int maxCount) {
    final fraction = maxCount > 0 ? item.count / maxCount : 0.0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          // Category name
          SizedBox(
            width: 110,
            child: Text(
              item.label,
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey[700],
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          // Progress bar
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                return Stack(
                  children: [
                    // Background track
                    Container(
                      height: 22,
                      decoration: BoxDecoration(
                        color: Colors.grey[100],
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    // Filled bar
                    Container(
                      height: 22,
                      width: constraints.maxWidth * fraction,
                      decoration: BoxDecoration(
                        color: _barColor.withValues(
                          alpha: 0.6 + 0.4 * fraction,
                        ),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(width: 8),
          // Count value
          SizedBox(
            width: 36,
            child: Text(
              '${item.count}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1A1A1A),
              ),
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      height: 180,
      padding: const EdgeInsets.all(16),
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
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bar_chart, size: 40, color: Colors.grey[300]),
            const SizedBox(height: 8),
            Text(title,
                style: TextStyle(fontSize: 14, color: Colors.grey[500])),
            const SizedBox(height: 4),
            Text('Нет данных',
                style: TextStyle(fontSize: 12, color: Colors.grey[400])),
          ],
        ),
      ),
    );
  }
}
