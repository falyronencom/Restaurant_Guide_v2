import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';

/// Donut-style pie chart for distribution data (roles, statuses, cities, ratings).
class DistributionChart extends StatelessWidget {
  final String title;
  final List<DistributionItem> data;
  final List<Color>? colors;

  static const _defaultColors = [
    Color(0xFFF06B32),
    Color(0xFF3FD00D),
    Color(0xFF4A90D9),
    Color(0xFFE74C3C),
    Color(0xFF9B59B6),
    Color(0xFFF39C12),
    Color(0xFF1ABC9C),
    Color(0xFF34495E),
  ];

  const DistributionChart({
    super.key,
    required this.title,
    required this.data,
    this.colors,
  });

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty || data.every((d) => d.count == 0)) {
      return _buildEmptyState();
    }

    final palette = colors ?? _defaultColors;
    final total = data.fold<int>(0, (s, d) => s + d.count);

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
          SizedBox(
            height: 180,
            child: Row(
              children: [
                Expanded(
                  child: PieChart(
                    PieChartData(
                      sectionsSpace: 2,
                      centerSpaceRadius: 40,
                      sections: List.generate(data.length, (i) {
                        final item = data[i];
                        final pct = total > 0
                            ? (item.count / total * 100)
                            : 0.0;
                        return PieChartSectionData(
                          value: item.count.toDouble(),
                          color: palette[i % palette.length],
                          radius: 35,
                          title: pct >= 5
                              ? '${pct.toStringAsFixed(0)}%'
                              : '',
                          titleStyle: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                          ),
                        );
                      }),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: List.generate(data.length, (i) {
                      final item = data[i];
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(
                          children: [
                            Container(
                              width: 10,
                              height: 10,
                              decoration: BoxDecoration(
                                color: palette[i % palette.length],
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item.label,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey[700],
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Text(
                              '${item.count}',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      height: 220,
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
            Icon(Icons.pie_chart_outline, size: 40, color: Colors.grey[300]),
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

/// Donut chart specifically for rating distribution (1-5 stars).
class RatingDistributionChart extends StatelessWidget {
  final String title;
  final List<RatingDistributionItem> data;

  static const _ratingColors = [
    Color(0xFFE74C3C), // 1 star
    Color(0xFFF39C12), // 2 stars
    Color(0xFFF1C40F), // 3 stars
    Color(0xFF3FD00D), // 4 stars
    Color(0xFF27AE60), // 5 stars
  ];

  const RatingDistributionChart({
    super.key,
    required this.title,
    required this.data,
  });

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty || data.every((d) => d.count == 0)) {
      return DistributionChart(
        title: title,
        data: const [],
      );
    }

    return DistributionChart(
      title: title,
      data: data
          .map((d) => DistributionItem(
                label: '${'★' * d.rating} (${d.percentage.toStringAsFixed(1)}%)',
                count: d.count,
                percentage: d.percentage,
              ))
          .toList(),
      colors: _ratingColors,
    );
  }
}
