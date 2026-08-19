import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Вес блока-заглушки.
///
/// Оттенок кодирует значимость будущего содержимого, а не его размер:
/// [strong] — фото и первая строка карточки, [mid] — вторичные строки и
/// значения полей, [weak] — лейблы и всё, что читается последним.
enum SkeletonShade { strong, mid, weak }

/// Прямоугольник-заглушка на месте будущего содержимого.
///
/// Скелетон повторяет раскладку, которая придёт, — это его смысл. Шапка
/// экрана и рейл в него не входят: грузится только тело, мигать всему
/// экрану незачем.
///
/// Анимации нет намеренно: в макете её нет ни в одном кадре
/// (`@keyframes`/`animation`/`transition` отсутствуют во всём файле).
/// Добавлять пульсацию «как принято» — значит изобретать внесистемное.
class SkeletonBlock extends StatelessWidget {
  /// Ширина в пикселях. Взаимоисключающа с [widthFactor].
  final double? width;

  /// Ширина долей от родителя (в макете задана процентами: 62%, 44%…).
  final double? widthFactor;

  final double height;
  final double radius;
  final SkeletonShade shade;

  const SkeletonBlock({
    super.key,
    this.width,
    this.widthFactor,
    required this.height,
    this.radius = 6,
    this.shade = SkeletonShade.mid,
  }) : assert(
          width == null || widthFactor == null,
          'ширина задаётся либо в пикселях, либо долей — не одновременно',
        );

  /// Строка текста: радиус 6, ширина долей.
  const SkeletonBlock.line({
    Key? key,
    required double widthFactor,
    double height = 11,
    SkeletonShade shade = SkeletonShade.mid,
  }) : this(
          key: key,
          widthFactor: widthFactor,
          height: height,
          shade: shade,
        );

  /// Изображение: радиус 10, квадрат или заданный размер.
  const SkeletonBlock.photo({
    Key? key,
    required double size,
    SkeletonShade shade = SkeletonShade.strong,
  }) : this(
          key: key,
          width: size,
          height: size,
          radius: 10,
          shade: shade,
        );

  Color get _color => switch (shade) {
        SkeletonShade.strong => AppTheme.skeletonStrong,
        SkeletonShade.mid => AppTheme.skeletonMid,
        SkeletonShade.weak => AppTheme.skeletonWeak,
      };

  @override
  Widget build(BuildContext context) {
    final box = Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: _color,
        borderRadius: BorderRadius.circular(radius),
      ),
    );

    if (widthFactor == null) return box;

    return FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widthFactor,
      child: box,
    );
  }
}
