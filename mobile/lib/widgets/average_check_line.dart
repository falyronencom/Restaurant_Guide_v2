import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/utils/venue_labels.dart';

/// «Средний чек: до 50 руб» — под часами работы в карточке заведения и в её
/// превью у партнёра.
///
/// Так же сайт: в карточке заведения рядом с часами — «Средний чек» и слова
/// («до 50 руб»), значки «$$» — только там, где места нет (список, квадрат
/// оценки). Одна строка `Text.rich`, а не ряд с колонкой фиксированной
/// ширины, как у часов: при крупном системном шрифте на узком экране она
/// переносится, а не переполняется. Цены нет — строки нет.
class AverageCheckLine extends StatelessWidget {
  const AverageCheckLine(this.priceRange, {super.key});

  /// Значение сервера: «$», «$$», «$$$».
  final String? priceRange;

  static const Key lineKey = ValueKey<String>('average-check-line');

  @override
  Widget build(BuildContext context) {
    final words = priceDescription(priceRange);
    if (words == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Text.rich(
        key: lineKey,
        TextSpan(
          children: [
            const TextSpan(
              text: 'Средний чек: ',
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            TextSpan(text: words),
          ],
        ),
        style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: AppTheme.textPrimary,
        ),
      ),
    );
  }
}
