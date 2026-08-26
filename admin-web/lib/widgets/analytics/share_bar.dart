import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Доля целого одной величины: горизонтальная полоса из окрашенных отрезков.
///
/// Пришла на смену кольцевым диаграммам. Кольцо заставляет сравнивать углы, а
/// человек плохо сравнивает углы и хорошо — длины; при шести долях, две из
/// которых меньше процента, кольцо превращалось в цветной ободок, по которому
/// нельзя было прочитать ничего, и все настоящие числа всё равно приходилось
/// писать в легенде рядом.
///
/// Соседние отрезки одного цвета сливаются в один. Разделять их зазором
/// значило бы нарисовать границу там, где по смыслу цвета её нет: «убрано из
/// каталога» — это одна величина, а не две рядом.
class ShareSegment {
  final Color color;
  final int value;

  const ShareSegment({required this.color, required this.value});
}

class ShareBar extends StatelessWidget {
  final List<ShareSegment> segments;

  static const double height = 24;
  static const double _gap = 2;

  /// Ненулевая доля не имеет права исчезнуть: полоса, на которой
  /// пятнадцати заведений не видно, спорит с легендой, где они написаны.
  static const double _minVisible = 4;

  const ShareBar({super.key, required this.segments});

  @override
  Widget build(BuildContext context) {
    final merged = _mergeAdjacent(segments)
        .where((s) => s.value > 0)
        .toList(growable: false);
    final total = merged.fold<int>(0, (sum, s) => sum + s.value);

    if (total == 0) {
      return Container(
        height: height,
        decoration: BoxDecoration(
          color: AppTheme.backgroundWarm,
          borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
        ),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final widths = _layout(merged, total, constraints.maxWidth);

        return SizedBox(
          height: height,
          child: Row(
            spacing: _gap,
            children: [
              for (var i = 0; i < merged.length; i++)
                SizedBox(
                  width: widths[i],
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: merged[i].color,
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusXSmall),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  static List<ShareSegment> _mergeAdjacent(List<ShareSegment> input) {
    final merged = <ShareSegment>[];
    for (final segment in input) {
      if (merged.isNotEmpty && merged.last.color == segment.color) {
        merged[merged.length - 1] = ShareSegment(
          color: segment.color,
          value: merged.last.value + segment.value,
        );
      } else {
        merged.add(segment);
      }
    }
    return merged;
  }

  /// Ширины отрезков в пикселях.
  ///
  /// Доли не отдаются `Expanded`-ам: минимальная ширина для крошечной доли
  /// через флексы не выражается, а без неё «0,4% администраторов» пропадает
  /// с полосы совсем. Излишек, набежавший от подтягивания мелких отрезков,
  /// снимается с самого крупного — там он незаметен, потому что там он
  /// составляет доли процента от его же длины.
  static List<double> _layout(
    List<ShareSegment> segments,
    int total,
    double maxWidth,
  ) {
    final available = maxWidth - _gap * (segments.length - 1);
    if (available <= 0) {
      return List<double>.filled(segments.length, 0);
    }

    // Минимальная ширина — обещание «ненулевая доля видна», и оно выполнимо,
    // только пока места хватает всем. Когда не хватает, обещание уступает:
    // отрезки идут строго по пропорции. Иначе полоса вылезает за карточку —
    // а раньше `clamp` с нижней границей выше верхней ещё и бросал, то есть
    // вместо раздела вставала красная коробка.
    final floor =
        _minVisible * segments.length <= available ? _minVisible : 0.0;
    final widths = <double>[
      for (final s in segments)
        (available * s.value / total).clamp(floor, available),
    ];

    var overflow = widths.fold<double>(0, (a, b) => a + b) - available;
    while (overflow > 0.01) {
      var largest = 0;
      for (var i = 1; i < widths.length; i++) {
        if (widths[i] > widths[largest]) largest = i;
      }
      final take = (widths[largest] - floor).clamp(0.0, overflow);
      if (take <= 0) break;
      widths[largest] -= take;
      overflow -= take;
    }

    return widths;
  }
}

/// Строка легенды под полосой: точка, подпись, число, доля.
///
/// Доля считается здесь, а не приходит с бэкенда: распределения статусов и
/// ролей отдаются одними счётчиками, и складывать проценты из двух источников
/// (своих и чужих) — верный способ получить сумму, не равную ста.
class ShareLegendRow extends StatelessWidget {
  final Color color;
  final String label;
  final int value;
  final int total;

  /// Ширина колонки процента. Фиксирована, чтобы проценты стояли столбцом.
  static const double _percentWidth = 44;

  const ShareLegendRow({
    super.key,
    required this.color,
    required this.label,
    required this.value,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      spacing: 9,
      children: [
        _Dot(color),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontSize: 13, color: AppTheme.textDark),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Text(
          formatCount(value),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        SizedBox(
          width: _percentWidth,
          child: Text(
            formatShare(value, total),
            textAlign: TextAlign.right,
            style: const TextStyle(fontSize: 12, color: AppTheme.textGrey),
          ),
        ),
      ],
    );
  }
}

/// Компактная легенда в строку — для полосы во всю ширину экрана,
/// где вертикальный список из трёх пунктов оставил бы карточку полупустой.
class ShareLegendChip extends StatelessWidget {
  final Color color;
  final String label;
  final int value;
  final int total;

  const ShareLegendChip({
    super.key,
    required this.color,
    required this.label,
    required this.value,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 9,
      children: [
        _Dot(color),
        Text(
          label,
          style: const TextStyle(fontSize: 13, color: AppTheme.textDark),
        ),
        Text(
          formatCount(value),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        Text(
          formatShare(value, total),
          style: const TextStyle(fontSize: 12, color: AppTheme.textGrey),
        ),
      ],
    );
  }
}

class _Dot extends StatelessWidget {
  final Color color;

  const _Dot(this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
