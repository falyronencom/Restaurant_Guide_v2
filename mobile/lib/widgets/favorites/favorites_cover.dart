import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Обложка экрана «Избранное»: фото приложения с каноничным затемнением,
/// заголовок и чипы поверх него (макет `2b`, handoff 29.09.2026).
///
/// Заменила белый AppBar 56 + белую строку «Сортировка» 44: сто точек под
/// одно слово и один контрол, стыковавшиеся с бежевым телом жёсткой линией.
///
/// Затемнение и тёплый градиент — те же приёмы и значения, что в
/// `SearchHomeScreen._buildBackground()`: вкладки одного приложения держат
/// один свет. Нижний левый угол скруглён радиусом 40 — эхо «ванны» карточки
/// заведения (`_ImageClipper` в `establishment_card.dart`).
///
/// [collapse] — доля сжатия от 0 (полная, 163 под статус-баром) до 1
/// (компактная, 93): при скролле списка чипы уходят, заголовок уменьшается
/// 25 → 22, скругление угла сходит на нет.
class FavoritesCover extends StatelessWidget {
  const FavoritesCover({
    super.key,
    required this.topInset,
    this.collapse = 0,
    this.subtitle,
    this.sortLabel,
    this.onSortTap,
  });

  /// Высота статус-бара: обложка уходит под него.
  final double topInset;

  /// 0 — полная обложка, 1 — компактная.
  final double collapse;

  /// «12 мест · Минск». `null` — строки нет (гость, загрузка, пусто).
  final String? subtitle;

  /// Текущий порядок сортировки — подпись чипа. `null` — чипа нет:
  /// сортировать нечего.
  final String? sortLabel;
  final VoidCallback? onSortTap;

  /// Высота под статус-баром: полная (макет — 210 с баром 47) и компактная.
  static const double expandedBodyHeight = 163;
  static const double collapsedBodyHeight = 93;

  /// Радиус нижнего левого угла полной обложки.
  static const double cornerRadius = 40;

  static const Color _warmTint = Color(0xFFC8714B);

  @override
  Widget build(BuildContext context) {
    final t = collapse.clamp(0.0, 1.0);
    // Чипы уходят быстрее, чем сжимается обложка: к середине сжатия их нет,
    // иначе они наезжали бы на заголовок.
    final chipsGone = math.min(1.0, t * 1.8);
    final radius = cornerRadius * (1 - t);

    return ClipRRect(
      borderRadius: BorderRadius.only(bottomLeft: Radius.circular(radius)),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(
            'assets/images/search_background.jpg',
            fit: BoxFit.cover,
            // object-position 50% 42% макета: y = 0.42 * 2 - 1.
            alignment: const Alignment(0, -0.16),
            errorBuilder: (context, error, stackTrace) =>
                const ColoredBox(color: Color(0xFF2C1810)),
          ),
          ColoredBox(color: Colors.black.withValues(alpha: 0.6)),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 150,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    _warmTint.withValues(alpha: 0.15),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 20,
            // Блок прижат только к низу и растёт вверх: при системном шрифте
            // ×2 заголовок заезжал бы под статус-бар (163 и 93 рассчитаны на
            // обычный кегль). ×1.3 ещё помещается в обе высоты.
            child: MediaQuery.withClampedTextScaling(
              maxScaleFactor: 1.3,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Избранное',
                    maxLines: 1,
                    style: TextStyle(
                      fontFamily: AppTheme.fontDisplayFamily,
                      fontSize: lerpDouble(25, 22, t),
                      fontWeight: FontWeight.w400,
                      height: 1.1,
                      color: Colors.white,
                    ),
                  ),
                  if (subtitle != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 7),
                      child: Text(
                        subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: AppTheme.fontBodyFamily,
                          fontSize: lerpDouble(14, 13, t),
                          fontWeight: FontWeight.w400,
                          color: Colors.white.withValues(alpha: 0.78),
                        ),
                      ),
                    ),
                  if (sortLabel != null && chipsGone < 1)
                    ClipRect(
                      child: Align(
                        alignment: Alignment.topLeft,
                        heightFactor: 1 - chipsGone,
                        child: Opacity(
                          opacity: 1 - chipsGone,
                          child: Padding(
                            // 16 макета минус 5 невидимого поля зоны тапа чипа.
                            padding: const EdgeInsets.only(top: 11),
                            child: FavoritesCoverChip(
                              icon: Icons.compare_arrows,
                              rotateIcon: true,
                              label: sortLabel!,
                              onTap: onSortTap,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Стеклянный чип обложки: 34 видимых, радиус 8, подпись 13/w500.
///
/// Видимая плашка — 34 по макету, а зона тапа — [minTapHeight]: невидимые
/// поля по 5 сверху и снизу. Урок `GlassActionChip`: зона тапа ростом с
/// текст — тестировщики промахиваются.
class FavoritesCoverChip extends StatelessWidget {
  const FavoritesCoverChip({
    super.key,
    required this.icon,
    required this.label,
    this.onTap,
    this.rotateIcon = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  /// Сортировка — `compare_arrows`, повёрнутая на 90°, как была в строке
  /// «Сортировка» до обложки.
  final bool rotateIcon;

  static const double visibleHeight = 34;
  static const double minTapHeight = 44;

  @override
  Widget build(BuildContext context) {
    final iconWidget = Icon(icon, size: 18, color: Colors.white);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.symmetric(
            vertical: (minTapHeight - visibleHeight) / 2),
        child: Container(
          height: visibleHeight,
          padding: const EdgeInsets.symmetric(horizontal: 13),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.16),
            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
            border: Border.all(color: Colors.white.withValues(alpha: 0.38)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              rotateIcon
                  ? Transform.rotate(angle: math.pi / 2, child: iconWidget)
                  : iconWidget,
              const SizedBox(width: 7),
              Text(
                label,
                maxLines: 1,
                style: const TextStyle(
                  fontFamily: AppTheme.fontBodyFamily,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Шапка списка: полная обложка, при скролле сжимается до компактной и
/// остаётся прижатой к верху.
class FavoritesCoverHeaderDelegate extends SliverPersistentHeaderDelegate {
  FavoritesCoverHeaderDelegate({
    required this.topInset,
    this.subtitle,
    this.sortLabel,
    this.onSortTap,
  });

  final double topInset;
  final String? subtitle;
  final String? sortLabel;
  final VoidCallback? onSortTap;

  @override
  double get maxExtent => topInset + FavoritesCover.expandedBodyHeight;

  @override
  double get minExtent => topInset + FavoritesCover.collapsedBodyHeight;

  @override
  Widget build(
      BuildContext context, double shrinkOffset, bool overlapsContent) {
    return FavoritesCover(
      topInset: topInset,
      collapse: shrinkOffset / (maxExtent - minExtent),
      subtitle: subtitle,
      sortLabel: sortLabel,
      onSortTap: onSortTap,
    );
  }

  @override
  bool shouldRebuild(FavoritesCoverHeaderDelegate oldDelegate) =>
      oldDelegate.topInset != topInset ||
      oldDelegate.subtitle != subtitle ||
      oldDelegate.sortLabel != sortLabel ||
      oldDelegate.onSortTap != onSortTap;
}

/// «1 место · 2 места · 5 мест · 11 мест · 21 место».
String favoritePlacesCount(int count) {
  final mod100 = count % 100;
  final mod10 = count % 10;
  final String word;
  if (mod100 >= 11 && mod100 <= 14) {
    word = 'мест';
  } else if (mod10 == 1) {
    word = 'место';
  } else if (mod10 >= 2 && mod10 <= 4) {
    word = 'места';
  } else {
    word = 'мест';
  }
  return '$count $word';
}

/// Подзаголовок обложки: счётчик, и город — только если он у всех мест
/// один. Избранное к городу не привязано: «12 мест · Минск» при местах в
/// Минске и Гродно было бы неправдой (решение Координатора 29.09.2026).
String favoritesSubtitle(List<String?> cities) {
  final count = favoritePlacesCount(cities.length);
  final distinct = cities.toSet();
  final only = distinct.length == 1 ? distinct.single : null;
  if (only == null || only.trim().isEmpty) return count;
  return '$count · $only';
}
