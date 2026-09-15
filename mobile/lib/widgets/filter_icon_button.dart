import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Кнопка «Фильтры» со счётчиком активных фильтров.
///
/// Одна на три места — главная и обе шапки экрана результатов (развёрнутая и
/// сжимающаяся). Раньше блок был скопирован трижды, и правка геометрии
/// расходилась по экранам.
///
/// **Геометрия индикатора.** Круг садится центром на дугу скругления угла по
/// биссектрисе: центр дуги — `(ширина − R, R)`, точка дуги под 45° —
/// `(центр + R/√2, центр − R/√2)`. Отсюда вынос наружу [badgeOutset],
/// одинаковый по обеим осям.
///
/// `Stack` держит [Clip.none] намеренно. Со значением по умолчанию
/// (`Clip.hardEdge`) круг срезается границами кнопки — 4 px справа и 2 px
/// сверху, — два прямых среза встречаются в углу, и индикатор читается как
/// капля с острым углом, чужим скруглению кнопки.
class FilterIconButton extends StatelessWidget {
  const FilterIconButton({
    super.key,
    required this.activeCount,
    required this.onTap,
  });

  /// Сколько видов фильтров активно. `0` — индикатор не рисуется.
  final int activeCount;

  final VoidCallback onTap;

  /// Размеры кнопки из макета Figma.
  static const double buttonWidth = 53;
  static const double buttonHeight = 43;

  /// Скругление угла кнопки — оно же задаёт посадку индикатора.
  static const double cornerRadius = AppTheme.radiusMedium;

  /// Диаметр индикатора. Коробка строго квадратная: `BoxShape.circle` рисует
  /// круг по короткой стороне, поэтому у прямоугольной коробки заявленный
  /// отступ и видимый расходятся.
  static const double badgeDiameter = 18;

  /// Вынос индикатора наружу — одинаковый вправо и вверх.
  static const double badgeOutset =
      badgeDiameter / 2 + cornerRadius / math.sqrt2 - cornerRadius;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: buttonWidth,
            height: buttonHeight,
            decoration: BoxDecoration(
              color: Colors.transparent,
              borderRadius: BorderRadius.circular(cornerRadius),
              border: Border.all(color: AppTheme.backgroundWarm, width: 1),
            ),
            child: const Icon(
              Icons.tune,
              color: AppTheme.backgroundWarm,
              size: 20,
            ),
          ),
          if (activeCount > 0)
            Positioned(
              top: -badgeOutset,
              right: -badgeOutset,
              child: Container(
                width: badgeDiameter,
                height: badgeDiameter,
                decoration: const BoxDecoration(
                  color: AppTheme.primaryOrange,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    '$activeCount',
                    style: const TextStyle(
                      color: AppTheme.textOnPrimary,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
