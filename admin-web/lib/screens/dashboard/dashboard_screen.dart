import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/timeline_chart.dart';

/// Main Dashboard screen — admin's at-a-glance platform overview.
/// Shows metric cards (users, establishments, reviews, moderation)
/// and a registration timeline chart.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().loadDashboard();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<DashboardProvider>(
      builder: (context, provider, _) {
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Панель управления',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF1A1A1A),
                    ),
                  ),
                  PeriodSelector(
                    currentPeriod: provider.period,
                    onPeriodChanged: (selection) {
                      provider.loadDashboard(
                        period: selection.period,
                        from: selection.from?.toIso8601String(),
                        to: selection.to?.toIso8601String(),
                      );
                    },
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Loading / Error state
              if (provider.isLoading && provider.overview == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(48),
                    child: CircularProgressIndicator(
                      color: Color(0xFFF06B32),
                    ),
                  ),
                )
              else if (provider.error != null && provider.overview == null)
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
                          onPressed: () => provider.loadDashboard(),
                          child: const Text('Повторить'),
                        ),
                      ],
                    ),
                  ),
                )
              else if (provider.overview != null) ...[
                // Metric cards grid (2x2)
                _buildMetricCards(provider),
                const SizedBox(height: 24),

                // Registration timeline chart
                const Text(
                  'Регистрации пользователей',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF1A1A1A),
                  ),
                ),
                const SizedBox(height: 12),
                TimelineChart(
                  data: provider.registrationTimeline,
                  aggregation: provider.aggregation,
                  primaryLabel: 'Новые пользователи',
                ),

                // Loading overlay for period changes
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

  Widget _buildMetricCards(DashboardProvider provider) {
    final ov = provider.overview!;

    return LayoutBuilder(
      builder: (context, constraints) {
        final crossAxisCount = constraints.maxWidth > 800 ? 4 : 2;
        return GridView.count(
          crossAxisCount: crossAxisCount,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 16,
          crossAxisSpacing: 16,
          childAspectRatio: 1.6,
          children: [
            MetricCard(
              title: 'Пользователи',
              value: '${ov.users.total}',
              changePercent: ov.users.changePercent,
              subtitle: '+${ov.users.newInPeriod} за период',
              icon: Icons.people_outline,
              iconColor: const Color(0xFF4A90D9),
            ),
            MetricCard(
              title: 'Заведения',
              value: '${ov.establishments.active}',
              changePercent: ov.establishments.changePercent,
              subtitle: '${ov.establishments.pending} на модерации',
              icon: Icons.restaurant_outlined,
              iconColor: const Color(0xFFF06B32),
            ),
            MetricCard(
              title: 'Отзывы',
              value: '${ov.reviews.total}',
              changePercent: ov.reviews.changePercent,
              subtitle: 'Средняя: ${ov.reviews.averageRating.toStringAsFixed(1)}',
              icon: Icons.star_outline,
              iconColor: const Color(0xFFF39C12),
            ),
            MetricCard(
              title: 'Модерация',
              value: '${ov.moderation.pendingCount}',
              changePercent: null,
              subtitle: '${ov.moderation.actionsInPeriod} действий за период',
              icon: Icons.shield_outlined,
              iconColor: ov.moderation.pendingCount > 0
                  ? const Color(0xFFE74C3C)
                  : const Color(0xFF3FD00D),
            ),
          ],
        );
      },
    );
  }
}
