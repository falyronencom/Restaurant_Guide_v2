import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Точечный индикатор занятости: кольцо 2px, дуга брендовая.
///
/// Канон допускает спиннер только точечно — в шапке экрана или рядом с
/// действием. Спиннера «на всю область» в макете нет ни одного: при
/// первичной загрузке тело занимает скелетон, который показывает будущую
/// раскладку, а не просто факт ожидания.
///
/// Размеры из макета: 13 — рядом с подписью «обновляем», 14 — в шапке
/// при первичной загрузке, 16 — рядом с кнопками действия.
class AdminInlineSpinner extends StatelessWidget {
  final double size;

  /// Незакрашенная часть кольца. В шапке — плотный [AppTheme.beigeDivider],
  /// поверх приглушённого контента — полупрозрачный брендовый.
  final Color track;

  const AdminInlineSpinner({
    super.key,
    this.size = 14,
    this.track = AppTheme.beigeDivider,
  });

  /// Вариант поверх приглушённого контента (панель «ошибка действия»).
  const AdminInlineSpinner.overContent({Key? key, double size = 16})
      : this(key: key, size: size, track: const Color(0x40F06B32));

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: AppTheme.primaryOrange,
        backgroundColor: track,
      ),
    );
  }
}
