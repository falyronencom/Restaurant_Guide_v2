import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/chart_scale.dart';

/// Две величины на одном поле — количество столбцами, оценка линией.
///
/// Заменяет `TimelineChart`, который выводил оценку формулой `(rating / 5) *
/// maxY`, то есть наносил её на шкалу КОЛИЧЕСТВА, а правую ось не рисовал
/// вовсе. Такой график не «неточен» — он нечитаем: у зелёной линии не было
/// величины, по которой её можно расшифровать, и высота точки означала
/// ровно ничего.
///
/// Канон разрешает две величины на одном поле при двух условиях, и оба
/// выполняются здесь:
///
/// 1. **Разная геометрия.** Количество — столбцы, оценка — линия. Одинаковыми
///    линиями два ряда читались бы как один ряд из двух частей.
/// 2. **Две подписанные шкалы.** Слева количество, справа оценка. Каждый ряд
///    считается по СВОЕЙ шкале — ни одна величина не пересчитывается в чужую.
///
/// Устройство: два графика `fl_chart` в `Stack`, поля построения которых
/// обязаны совпасть пиксель в пиксель — столбец под чужой точкой это тот же
/// молчаливый обман, только тоньше прежнего. Совпадение держится на двух
/// вещах, и обе неочевидны:
///
/// * **Зеркальные стороны рисуют пустоту, а не выключены.** `fl_chart` берёт
///   резерв в расчёт только там, где подписи включены:
///   `showSideTitles => showTitles && reservedSize != 0`
///   (`axis_chart_data.dart`). Выключить подписи и оставить `reservedSize`
///   недостаточно — резерв просто отбрасывается, и поля расходятся на все
///   сорок пикселей левой шкалы. Поэтому каждый график включает подписи со
///   всех четырёх сторон, а на чужих сторонах отдаёт пустой виджет.
/// * **Столбцы и точки живут в одной сетке слотов.** `BarChartAlignment
///   .spaceAround` ставит центр группы `i` в `(i + ½)·W/n` — это выводится из
///   `calculateGroupsX` и, что важно, НЕ зависит от ширины столбца. Линия
///   получает домен `[-½; n-½]`, и её `x = i` попадает ровно туда же. При
///   `spaceBetween` центры стояли бы в `w/2 … W-w/2`, и крайняя точка уезжала
///   бы на полстолбца — на семидневке это девять пикселей.
class CanonComboChart extends StatelessWidget {
  final List<TimelinePoint> data;

  /// «day» / «week» / «month» — влияет только на формат подписей оси X.
  final String aggregation;

  final String emptyMessage;

  const CanonComboChart({
    super.key,
    required this.data,
    this.aggregation = 'day',
    this.emptyMessage = 'За выбранный период отзывов не оставляли',
  });

  /// Домен оценки. Единица — не усечение шкалы, а настоящий её низ:
  /// оценки ниже одной звезды не существует.
  static const double minRating = 1;
  static const double maxRating = 5;

  /// Резервы под подписи. Одни и те же у обоих графиков — иначе поля
  /// построения разойдутся.
  static const double _leftReserve = 40;
  static const double _rightReserve = 34;
  static const double _bottomReserve = 24;

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty || data.every((p) => p.count == 0)) {
      return _NoData(emptyMessage);
    }

    final maxCount = data.fold<int>(0, (m, p) => p.count > m ? p.count : m);
    final maxY = niceMaxY(maxCount);

    return Stack(
      children: <Widget>[
        Positioned.fill(child: _bars(maxY)),
        Positioned.fill(child: _ratingLine()),
      ],
    );
  }

  // ==========================================================================
  // Количество — столбцы, левая шкала
  // ==========================================================================

  Widget _bars(double maxY) {
    final step = maxY / 4;

    return BarChart(
      BarChartData(
        minY: 0,
        maxY: maxY,
        alignment: BarChartAlignment.spaceAround,
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
        barTouchData: BarTouchData(
          touchTooltipData: BarTouchTooltipData(
            getTooltipColor: (_) => AppTheme.backgroundPrimary,
            tooltipRoundedRadius: AppTheme.radiusSmall,
            // Второй параметр — индекс ГРУППЫ. Четвёртый это `rodIndex`, а
            // стержень в группе один, поэтому он всегда ноль: тултип показывал
            // первый день ряда, на какой столбец ни наведись.
            getTooltipItem: (_, groupIndex, __, ___) => BarTooltipItem(
              _tooltipText(groupIndex),
              const TextStyle(
                color: AppTheme.primaryOrangeDark,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false, reservedSize: 0),
          ),
          // Пустые подписи, а не выключенные: выключенная сторона теряет
          // резерв, и поле построения этого графика становится шире чужого.
          rightTitles: AxisTitles(sideTitles: _blank(_rightReserve)),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: _leftReserve,
              interval: step,
              getTitlesWidget: (value, _) => Padding(
                padding: const EdgeInsets.only(right: 9),
                child: Text(
                  value.round().toString(),
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontSize: 11, color: AppTheme.textGrey),
                ),
              ),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: _bottomReserve,
              interval: 1,
              getTitlesWidget: (value, _) {
                final i = value.round();
                if (i < 0 || i >= data.length) return const SizedBox.shrink();
                if (i % _xStride != 0) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    _xLabel(data[i].date),
                    style: const TextStyle(fontSize: 10, color: AppTheme.textGrey),
                  ),
                );
              },
            ),
          ),
        ),
        barGroups: <BarChartGroupData>[
          for (var i = 0; i < data.length; i++)
            BarChartGroupData(
              x: i,
              barRods: <BarChartRodData>[
                BarChartRodData(
                  toY: data[i].count.toDouble(),
                  width: _barWidth,
                  borderRadius: BorderRadius.circular(2),
                  color: AppTheme.primaryOrange.withValues(alpha: 0.85),
                ),
              ],
            ),
        ],
      ),
    );
  }

  /// Ширина столбца по числу точек: тридцать дней и семь дней требуют разной
  /// толщины, иначе месяц превращается в частокол, а неделя — в редкие сваи.
  double get _barWidth {
    if (data.length <= 7) return 18;
    if (data.length <= 14) return 12;
    if (data.length <= 31) return 7;
    return 4;
  }

  /// Через сколько точек ставить подпись оси X.
  int get _xStride {
    if (data.length <= 7) return 1;
    if (data.length <= 16) return 2;
    return (data.length / 7).ceil();
  }

  String _tooltipText(int index) {
    final point = data[index];
    final rating = point.averageRating;
    final count = countWithNoun(point.count, 'отзыв', 'отзыва', 'отзывов');
    if (rating == null) return count;
    return '$count · ${formatDecimal(rating)}';
  }

  // ==========================================================================
  // Оценка — линия, правая шкала
  // ==========================================================================

  Widget _ratingLine() {
    return IgnorePointer(
      child: LineChart(
        LineChartData(
          // Домен на полслота шире ряда: так `x = i` попадает в центр
          // столбца `i` при `spaceAround`.
          minX: -0.5,
          maxX: data.length - 0.5,
          minY: minRating,
          maxY: maxRating,
          // Сетку рисует нижний график — вторая наложилась бы поверх
          // столбцов чужими линиями на чужих высотах.
          gridData: const FlGridData(show: false),
          borderData: FlBorderData(show: false),
          lineTouchData: const LineTouchData(enabled: false),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false, reservedSize: 0),
            ),
            // Зеркально нижнему графику: слева резервируем, но не рисуем.
            leftTitles: AxisTitles(sideTitles: _blank(_leftReserve)),
            bottomTitles: AxisTitles(sideTitles: _blank(_bottomReserve)),
            rightTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: _rightReserve,
                interval: 1,
                getTitlesWidget: (value, _) => Padding(
                  padding: const EdgeInsets.only(left: 9),
                  child: Text(
                    value.round().toString(),
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.statusGreen,
                    ),
                  ),
                ),
              ),
            ),
          ),
          lineBarsData: <LineChartBarData>[
            for (final segment in ratingSegments(data))
              LineChartBarData(
                spots: segment,
                isCurved: false,
                color: AppTheme.statusGreen,
                barWidth: 2,
                isStrokeCapRound: true,
                dotData: FlDotData(show: segment.length == 1),
              ),
          ],
        ),
      ),
    );
  }

  /// Непрерывные куски линии оценки.
  ///
  /// В день без отзывов средней оценки не существует, и бэкенд присылает
  /// `null`. Соединять соседей через такой день нельзя: отрезок между ними
  /// изображал бы плавный переход, которого никто не наблюдал. Ряд поэтому
  /// разрезается на куски, а одиночный день рисуется точкой — иначе он
  /// пропал бы совсем.
  static List<List<FlSpot>> ratingSegments(List<TimelinePoint> points) {
    final segments = <List<FlSpot>>[];
    var current = <FlSpot>[];

    for (var i = 0; i < points.length; i++) {
      final rating = points[i].averageRating;
      if (rating == null) {
        if (current.isNotEmpty) segments.add(current);
        current = <FlSpot>[];
        continue;
      }
      current.add(FlSpot(i.toDouble(), rating.clamp(minRating, maxRating)));
    }
    if (current.isNotEmpty) segments.add(current);

    return segments;
  }

  /// Сторона, которая держит резерв, но ничего не рисует.
  static SideTitles _blank(double reserved) => SideTitles(
        showTitles: true,
        reservedSize: reserved,
        getTitlesWidget: (_, __) => const SizedBox.shrink(),
      );

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
        children: <Widget>[
          const Icon(Icons.bar_chart, size: 40, color: AppTheme.strokeGrey),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }
}
