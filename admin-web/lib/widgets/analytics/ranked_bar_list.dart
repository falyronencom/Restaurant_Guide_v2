import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Ранжированный список: подпись, полоса, число. Строки идут по убыванию.
///
/// Полоса меряется ОТ МАКСИМУМА, а не от суммы. Это осознанный выбор, и он
/// разный по смыслу для двух потребителей. Города делят каталог между собой,
/// но их шесть и Минск забирает половину — от суммы все остальные вышли бы
/// одинаковыми огрызками. Категории же и вовсе не делят целое: у заведения их
/// может быть несколько, сумма по категориям больше числа заведений, и
/// «процент от суммы» означал бы неизвестно что. Поэтому доля не пишется
/// нигде: полоса сравнивает строки между собой, а точное значение стоит
/// числом справа.
class RankedBarItem {
  final String label;
  final int value;

  const RankedBarItem({required this.label, required this.value});
}

class RankedBarList extends StatelessWidget {
  final List<RankedBarItem> items;

  /// Ширина колонки подписи.
  final double labelWidth;

  /// Высота полосы; радиус — половина высоты, полоса всегда пилюлей.
  final double barHeight;

  /// Ширина колонки числа.
  final double valueWidth;

  final double rowGap;
  final double labelFontSize;

  /// Сколько строк показывать. `null` — все.
  final int? maxItems;

  const RankedBarList({
    super.key,
    required this.items,
    required this.labelWidth,
    required this.barHeight,
    required this.valueWidth,
    required this.rowGap,
    required this.labelFontSize,
    this.maxItems,
  });

  /// Немного строк, есть куда дышать — города.
  const RankedBarList.spacious({
    Key? key,
    required List<RankedBarItem> items,
    int? maxItems,
  }) : this(
          key: key,
          items: items,
          labelWidth: 66,
          barHeight: 18,
          // Под «1 248» с неразрывным пробелом: он не переносится, и узкая
          // колонка выпускала бы число в зазор молча, без ленты переполнения.
          valueWidth: 38,
          rowGap: 12,
          labelFontSize: 13,
          maxItems: maxItems,
        );

  /// Много строк в ту же высоту — категории.
  const RankedBarList.dense({
    Key? key,
    required List<RankedBarItem> items,
    int? maxItems,
  }) : this(
          key: key,
          items: items,
          labelWidth: 88,
          barHeight: 14,
          valueWidth: 34,
          rowGap: 7,
          labelFontSize: 12,
          maxItems: maxItems,
        );

  @override
  Widget build(BuildContext context) {
    final sorted = [...items]..sort((a, b) => b.value.compareTo(a.value));
    final limit = maxItems;
    final shown = limit == null || sorted.length <= limit
        ? sorted
        : sorted.sublist(0, limit);
    final maxValue = shown.fold<int>(0, (m, i) => i.value > m ? i.value : m);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      spacing: rowGap,
      children: [
        for (final item in shown) _row(item, maxValue),
      ],
    );
  }

  Widget _row(RankedBarItem item, int maxValue) {
    final fraction = maxValue > 0 ? item.value / maxValue : 0.0;

    return Row(
      spacing: 10,
      children: [
        SizedBox(
          width: labelWidth,
          child: Text(
            item.label,
            style: TextStyle(
              fontSize: labelFontSize,
              color: AppTheme.textDark,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(barHeight / 2),
            child: Container(
              height: barHeight,
              color: AppTheme.backgroundWarm,
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: fraction,
                child: const ColoredBox(color: AppTheme.primaryOrange),
              ),
            ),
          ),
        ),
        SizedBox(
          width: valueWidth,
          child: Text(
            formatCount(item.value),
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: labelFontSize,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}
