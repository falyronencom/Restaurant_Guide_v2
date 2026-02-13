import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/bar_chart_widget.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/distribution_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/timeline_chart.dart';

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
                    if (constraints.maxWidth > 900) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: DistributionChart(
                              title: 'По статусу',
                              data: provider.data!.statusDistribution,
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
                            child: HorizontalBarChartWidget(
                              title: 'По категориям',
                              data: provider.data!.categoryDistribution,
                            ),
                          ),
                        ],
                      );
                    }
                    return Column(
                      children: [
                        DistributionChart(
                          title: 'По статусу',
                          data: provider.data!.statusDistribution,
                        ),
                        const SizedBox(height: 16),
                        DistributionChart(
                          title: 'По городу',
                          data: provider.data!.cityDistribution,
                        ),
                        const SizedBox(height: 16),
                        HorizontalBarChartWidget(
                          title: 'По категориям',
                          data: provider.data!.categoryDistribution,
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
