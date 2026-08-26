import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';

/// Канонический линейный график с заливкой площади — одна величина, одна шкала.
///
/// Намеренно умеет только это. Вторую величину на тот же график канон
/// разрешает выводить лишь другой геометрией и при двух подписанных шкалах
/// (столбцы + линия); масштабировать чужую величину в чужую шкалу — запрещено,
/// такой график врёт. Комбинированный вариант — отдельный виджет, этап 6.
///
/// Не путать с `TimelineChart`: тот пока обслуживает вкладки аналитики и
/// умеет как раз запрещённое наложение. Он уйдёт на этапе 6.
class CanonLineChart extends StatelessWidget {
  final List<TimelinePoint> data;

  /// «day» / «week» / «month» — влияет только на формат подписей оси X.
  final String aggregation;

  /// Что написать вместо графика, когда за окно ничего не произошло.
  ///
  /// Задаётся вызывающим, потому что пусто здесь означает разное: на дашборде
  /// не было регистраций, на кадре 08 — не создавали заведений. Общая фраза
  /// «нет данных» сказала бы, что сломалась загрузка, а не что событий не было.
  final String emptyMessage;

  const CanonLineChart({
    super.key,
    required this.data,
    this.aggregation = 'day',
    this.emptyMessage = 'За выбранный период регистраций не было',
  });

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty || data.every((p) => p.count == 0)) {
      return _NoData(emptyMessage);
    }

    final maxCount = data.fold<int>(0, (m, p) => p.count > m ? p.count : m);
    final maxY = (maxCount * 1.2).ceilToDouble().clamp(1.0, double.infinity);
    final step = maxY / 4;

    return LineChart(
      LineChartData(
        minX: 0,
        maxX: (data.length - 1).toDouble(),
        minY: 0,
        maxY: maxY,
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          horizontalInterval: step,
          getDrawingHorizontalLine: (_) => const FlLine(
            color: AppTheme.borderLight,
            strokeWidth: 1,
          ),
        ),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          rightTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 40,
              interval: step,
              getTitlesWidget: (value, _) => Padding(
                padding: const EdgeInsets.only(right: 9),
                child: Text(
                  value.round().toString(),
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppTheme.textGrey,
                  ),
                ),
              ),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 24,
              interval: _xInterval,
              getTitlesWidget: (value, _) {
                final i = value.round();
                if (i < 0 || i >= data.length) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    _xLabel(data[i].date),
                    style: const TextStyle(
                      fontSize: 10,
                      color: AppTheme.textGrey,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        lineTouchData: LineTouchData(
          touchTooltipData: LineTouchTooltipData(
            getTooltipColor: (_) => AppTheme.backgroundPrimary,
            tooltipRoundedRadius: AppTheme.radiusSmall,
            getTooltipItems: (spots) => spots
                .map(
                  (spot) => LineTooltipItem(
                    '${data[spot.x.round()].count}',
                    const TextStyle(
                      color: AppTheme.primaryOrangeDark,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                )
                .toList(),
          ),
        ),
        lineBarsData: [
          LineChartBarData(
            spots: <FlSpot>[
              for (var i = 0; i < data.length; i++)
                FlSpot(i.toDouble(), data[i].count.toDouble()),
            ],
            // Прямые отрезки, а не сглаживание: сглаженная кривая рисует
            // промежуточные значения, которых в данных нет.
            isCurved: false,
            color: AppTheme.primaryOrange,
            barWidth: 2.5,
            isStrokeCapRound: true,
            isStrokeJoinRound: true,
            belowBarData: BarAreaData(
              show: true,
              color: AppTheme.brandTint(0.10),
            ),
            // Точка только у последнего значения — она отмечает «сегодня»,
            // а не украшает линию.
            dotData: FlDotData(
              show: true,
              checkToShowDot: (spot, _) => spot.x.round() == data.length - 1,
              getDotPainter: (_, __, ___, ____) => FlDotCirclePainter(
                radius: 4,
                color: AppTheme.backgroundPrimary,
                strokeWidth: 2.5,
                strokeColor: AppTheme.primaryOrange,
              ),
            ),
          ),
        ],
      ),
    );
  }

  double get _xInterval {
    if (data.length <= 7) return 1;
    if (data.length <= 16) return 2;
    return (data.length / 7).ceilToDouble();
  }

  String _xLabel(String raw) {
    final date = DateTime.tryParse(raw);
    if (date == null) return raw;
    if (aggregation == 'month') return formatMonthShort(date);
    return formatDayMonthShort(date);
  }
}

class _NoData extends StatelessWidget {
  final String message;

  const _NoData(this.message);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.show_chart, size: 40, color: AppTheme.strokeGrey),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 14,
              color: AppTheme.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
