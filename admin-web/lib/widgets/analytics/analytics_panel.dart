import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Карточка сетки аналитики: белая инструментальная, заголовок и содержимое.
///
/// Один каркас на все карточки кадров 08–10 — метрики распределений, графики,
/// сводки. Раньше каждая рисовала свою белую коробку со своими отступами и
/// своей тенью, и они уже разошлись: три радиуса, две тени, четыре паддинга.
class AnalyticsPanel extends StatelessWidget {
  final String title;

  /// Правый край строки заголовка — легенда графика, ссылка, что угодно.
  final List<Widget> titleTrailing;

  /// Отступ между заголовком и содержимым. У карточек-графиков в макете 12,
  /// у карточек-распределений 14.
  final double titleGap;

  final Widget child;

  /// Содержимое тянется на всю высоту карточки (график), а не по контенту.
  final bool expandChild;

  const AnalyticsPanel({
    super.key,
    required this.title,
    this.titleTrailing = const <Widget>[],
    this.titleGap = 14,
    this.expandChild = false,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: expandChild ? MainAxisSize.max : MainAxisSize.min,
        children: [
          Row(
            spacing: 12,
            children: [
              Expanded(
                child: Text(
                  title,
                  style: AppTheme.canonCardTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              ...titleTrailing,
            ],
          ),
          SizedBox(height: titleGap),
          if (expandChild) Expanded(child: child) else child,
        ],
      ),
    );
  }
}

/// Форма метки легенды. Она обязана повторять геометрию ряда на графике:
/// линия читается линией, столбец — прямоугольником. Одинаковая точка для
/// обоих рядов на комбинированном графике не сказала бы, где какая шкала.
enum LegendMark { line, bar }

/// Метка легенды с подписью: «— новые заведения, в день».
class ChartLegend extends StatelessWidget {
  final Color color;
  final String label;
  final LegendMark mark;

  const ChartLegend({
    super.key,
    required this.color,
    required this.label,
    this.mark = LegendMark.line,
  });

  @override
  Widget build(BuildContext context) {
    final isLine = mark == LegendMark.line;

    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 6,
      children: [
        Container(
          width: isLine ? 14 : 10,
          height: isLine ? 3 : 12,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(isLine ? 2 : 3),
          ),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
        ),
      ],
    );
  }
}

/// Нечего показать внутри карточки: одна приглушённая строка по центру.
///
/// Ни `AdminEmptyState` (560), ни `AdminColumnMessage` здесь не годятся, и не
/// по ширине: у карточки уже есть заголовок, а оба несут собственный — 18/w600,
/// то есть крупнее заголовка карточки, внутри которой стоят. Второй заголовок,
/// перебивающий первый, читается как отдельный раздел, а не как пометка о том,
/// что данных нет.
class PanelEmpty extends StatelessWidget {
  final String message;

  const PanelEmpty(this.message, {super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 13,
            color: AppTheme.textTertiary,
            height: 1.4,
          ),
        ),
      ),
    );
  }
}

/// Сноска карточки — приглушённый вывод под содержимым: «Минск — 52% каталога».
class PanelFootnote extends StatelessWidget {
  final String text;
  final int maxLines;

  const PanelFootnote(this.text, {super.key, this.maxLines = 2});

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 12,
        color: AppTheme.textTertiary,
        height: 1.45,
      ),
      maxLines: maxLines,
      overflow: TextOverflow.ellipsis,
    );
  }
}
