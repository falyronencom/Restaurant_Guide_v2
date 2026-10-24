import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/chart_scale.dart';

/// Канонический график одной величины по времени — столбцами.
///
/// Был линией с заливкой (`CanonLineChart`). Линия между двумя целыми днями
/// рисует дробные значения, которых в данных нет, — регистраций «2,5» не
/// бывает; столбец говорит ровно то, что посчитано (решение Координатора
/// 20.10, Р6в; F-16).
///
/// Подсказка при наведении — дата столбца и число словами на белой плашке с
/// рамкой («14 октября · 3 регистрации»). Прежняя показывала одно число на
/// белом без рамки поверх белой карточки и дёргалась: точку линии надо было
/// поймать в радиусе десяти пикселей, и подсказка гасла и вспыхивала при
/// каждом движении мыши (К-2, F-14, F-15). Здесь откликается вся колонка над
/// столбцом, а не сам столбец: короткий столбец не теряет подсказку, стоит
/// мыши подняться над ним. Анимации подмены данных нет — перестройка экрана
/// не перезапускает график.
///
/// Вторую величину на тот же график канон разрешает выводить лишь другой
/// геометрией и при двух подписанных шкалах — это [CanonComboChart].
class CanonBarChart extends StatelessWidget {
  final List<TimelinePoint> data;

  /// «day» / «week» / «month» — что покрывает один столбец.
  final String aggregation;

  /// Что написать вместо графика, когда за окно ничего не произошло.
  ///
  /// Задаётся вызывающим, потому что пусто здесь означает разное: на дашборде
  /// не было регистраций, на кадре 08 — не создавали заведений. Общая фраза
  /// «нет данных» сказала бы, что сломалась загрузка, а не что событий не было.
  final String emptyMessage;

  /// Чего столбец — три формы: «регистрация / регистрации / регистраций».
  final (String, String, String) noun;

  const CanonBarChart({
    super.key,
    required this.data,
    this.aggregation = 'day',
    this.emptyMessage = 'За выбранный период регистраций не было',
    this.noun = ('регистрация', 'регистрации', 'регистраций'),
  });

  static const double _leftReserve = 40;

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty || data.every((p) => p.count == 0)) {
      return _NoData(emptyMessage);
    }

    final maxCount = data.fold<int>(0, (m, p) => p.count > m ? p.count : m);
    // Верх кратен четырём делениям, иначе шаг выходит нецелым, а подписи
    // печатаются целыми: при пяти регистрациях шаг был 1,5, и линия сетки,
    // подписанная «2», стояла на высоте 1,5.
    final maxY = niceMaxY(maxCount);
    final step = maxY / 4;

    return LayoutBuilder(
      builder: (context, constraints) {
        final stride = labelStride(
          data.length,
          constraints.maxWidth - _leftReserve,
        );

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
              // Колонка над столбцом откликается целиком — см. описание класса.
              allowTouchBarBackDraw: true,
              touchTooltipData: chartTooltip(
                (index) => '${bucketLabel(data[index].date, aggregation)}\n'
                    '${countWithNoun(data[index].count, noun.$1, noun.$2, noun.$3)}',
              ),
            ),
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
                  reservedSize: _leftReserve,
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
                  getTitlesWidget: (value, _) {
                    final i = value.round();
                    if (i < 0 || i >= data.length) {
                      return const SizedBox.shrink();
                    }
                    if (i % stride != 0) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        axisLabel(data[i].date, aggregation),
                        maxLines: 1,
                        softWrap: false,
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
            barGroups: <BarChartGroupData>[
              for (var i = 0; i < data.length; i++)
                BarChartGroupData(
                  x: i,
                  barRods: <BarChartRodData>[
                    BarChartRodData(
                      toY: data[i].count.toDouble(),
                      width: barWidthFor(data.length),
                      borderRadius: BorderRadius.circular(2),
                      color: AppTheme.primaryOrange,
                      // Невидимая подложка до верха шкалы: по ней ловится
                      // наведение на всю колонку (allowTouchBarBackDraw).
                      backDrawRodData: BackgroundBarChartRodData(
                        show: true,
                        toY: maxY,
                        color: Colors.transparent,
                      ),
                    ),
                  ],
                ),
            ],
          ),
          // Без анимации подмены: перестройка экрана не должна заново
          // «выращивать» столбцы — это и был кадр «1,65» (F-14).
          duration: Duration.zero,
        );
      },
    );
  }
}

/// Ширина столбца по числу точек: тридцать дней и семь дней требуют разной
/// толщины, иначе месяц превращается в частокол, а неделя — в редкие сваи.
double barWidthFor(int count) {
  if (count <= 7) return 18;
  if (count <= 14) return 12;
  if (count <= 31) return 7;
  return 4;
}

/// Подпись оси X: «12.10», у месячных столбцов — «окт».
String axisLabel(String raw, String aggregation) {
  final date = DateTime.tryParse(raw);
  if (date == null) return raw;
  if (aggregation == 'month') return formatMonthShort(date);
  return formatDayMonthShort(date);
}

/// Подсказка столбца — общая у обоих графиков аналитики: белая плашка с
/// рамкой поверх белой карточки, текст в две строки (когда / сколько), не
/// выходит за край графика.
BarTouchTooltipData chartTooltip(String Function(int groupIndex) text) {
  return BarTouchTooltipData(
    getTooltipColor: (_) => AppTheme.backgroundPrimary,
    tooltipRoundedRadius: AppTheme.radiusSmall,
    tooltipBorder: const BorderSide(color: AppTheme.strokeGrey),
    tooltipPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    tooltipMargin: 6,
    fitInsideHorizontally: true,
    fitInsideVertically: true,
    // Второй параметр — индекс ГРУППЫ; четвёртый — `rodIndex`, а стержень в
    // группе один, поэтому он всегда ноль.
    getTooltipItem: (_, groupIndex, __, ___) => BarTooltipItem(
      text(groupIndex),
      const TextStyle(
        color: AppTheme.primaryOrangeDark,
        fontSize: 12,
        height: 1.4,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
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
          const Icon(Icons.bar_chart, size: 40, color: AppTheme.strokeGrey),
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
