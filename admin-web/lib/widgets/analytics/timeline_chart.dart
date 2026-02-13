import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';

/// Wrapper around fl_chart LineChart for timeline data.
/// Supports optional secondary series (e.g. average_rating overlay).
class TimelineChart extends StatelessWidget {
  final List<TimelinePoint> data;
  final String aggregation;
  final bool showSecondaryAxis;
  final String primaryLabel;
  final String? secondaryLabel;
  final Color primaryColor;
  final Color secondaryColor;

  const TimelineChart({
    super.key,
    required this.data,
    this.aggregation = 'day',
    this.showSecondaryAxis = false,
    this.primaryLabel = 'Количество',
    this.secondaryLabel,
    this.primaryColor = const Color(0xFFF06B32),
    this.secondaryColor = const Color(0xFF3FD00D),
  });

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty || data.every((p) => p.count == 0)) {
      return _buildEmptyState();
    }

    final maxCount = data.fold<int>(0, (m, p) => p.count > m ? p.count : m);
    final maxY = (maxCount * 1.2).ceilToDouble().clamp(1.0, double.infinity);

    return Container(
      height: 280,
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
          _buildLegend(),
          const SizedBox(height: 12),
          Expanded(
            child: LineChart(
              LineChartData(
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: (maxY / 4).toDouble(),
                  getDrawingHorizontalLine: (_) => FlLine(
                    color: Colors.grey[200]!,
                    strokeWidth: 1,
                  ),
                ),
                titlesData: _buildTitles(maxY),
                borderData: FlBorderData(show: false),
                lineBarsData: _buildLineBars(maxY),
                lineTouchData: LineTouchData(
                  touchTooltipData: LineTouchTooltipData(
                    getTooltipItems: (spots) => spots.map((spot) {
                      final point = data[spot.x.toInt()];
                      final isSecondary = spot.barIndex == 1;
                      return LineTooltipItem(
                        isSecondary
                            ? (point.averageRating?.toStringAsFixed(1) ?? '-')
                            : '${point.count}',
                        TextStyle(
                          color: isSecondary ? secondaryColor : primaryColor,
                          fontWeight: FontWeight.w600,
                        ),
                      );
                    }).toList(),
                  ),
                ),
                minY: 0,
                maxY: maxY,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLegend() {
    return Row(
      children: [
        _legendDot(primaryColor, primaryLabel),
        if (showSecondaryAxis && secondaryLabel != null) ...[
          const SizedBox(width: 16),
          _legendDot(secondaryColor, secondaryLabel!),
        ],
      ],
    );
  }

  Widget _legendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(fontSize: 12, color: Colors.grey[600])),
      ],
    );
  }

  FlTitlesData _buildTitles(double maxY) {
    return FlTitlesData(
      topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
      rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
      leftTitles: AxisTitles(
        sideTitles: SideTitles(
          showTitles: true,
          reservedSize: 40,
          interval: (maxY / 4).toDouble(),
          getTitlesWidget: (value, _) => Text(
            value.toInt().toString(),
            style: TextStyle(fontSize: 11, color: Colors.grey[500]),
          ),
        ),
      ),
      bottomTitles: AxisTitles(
        sideTitles: SideTitles(
          showTitles: true,
          reservedSize: 30,
          interval: _xLabelInterval(),
          getTitlesWidget: (value, _) {
            final idx = value.toInt();
            if (idx < 0 || idx >= data.length) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _formatXLabel(data[idx].date),
                style: TextStyle(fontSize: 10, color: Colors.grey[500]),
              ),
            );
          },
        ),
      ),
    );
  }

  double _xLabelInterval() {
    if (data.length <= 7) return 1;
    if (data.length <= 14) return 2;
    if (data.length <= 31) return 5;
    return (data.length / 6).ceilToDouble();
  }

  String _formatXLabel(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      if (aggregation == 'month') return DateFormat('MMM', 'ru').format(date);
      return DateFormat('dd.MM').format(date);
    } catch (_) {
      return dateStr;
    }
  }

  List<LineChartBarData> _buildLineBars(double maxY) {
    final primary = LineChartBarData(
      spots: List.generate(
        data.length,
        (i) => FlSpot(i.toDouble(), data[i].count.toDouble()),
      ),
      isCurved: true,
      preventCurveOverShooting: true,
      color: primaryColor,
      barWidth: 2.5,
      dotData: FlDotData(show: data.length <= 14),
      belowBarData: BarAreaData(
        show: true,
        color: primaryColor.withValues(alpha: 0.1),
      ),
    );

    if (!showSecondaryAxis) return [primary];

    // Scale secondary (rating 0-5) to same Y range
    final secondary = LineChartBarData(
      spots: List.generate(data.length, (i) {
        final rating = data[i].averageRating ?? 0;
        return FlSpot(i.toDouble(), (rating / 5) * maxY);
      }),
      isCurved: true,
      preventCurveOverShooting: true,
      color: secondaryColor,
      barWidth: 2,
      dashArray: [6, 3],
      dotData: const FlDotData(show: false),
    );

    return [primary, secondary];
  }

  Widget _buildEmptyState() {
    return Container(
      height: 280,
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
            Icon(Icons.show_chart, size: 48, color: Colors.grey[300]),
            const SizedBox(height: 12),
            Text(
              'Нет данных за выбранный период',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
            ),
          ],
        ),
      ),
    );
  }
}
