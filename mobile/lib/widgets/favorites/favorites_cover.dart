import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_view_mode.dart';

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
/// 25 → 22, скругление угла сходит на нет. Режим «На карте» (макет `3a`) —
/// та же компактная обложка с тумблером режимов в [trailing].
class FavoritesCover extends StatelessWidget {
  const FavoritesCover({
    super.key,
    required this.topInset,
    this.collapse = 0,
    this.subtitle,
    this.sortLabel,
    this.onSortTap,
    this.onMapTap,
    this.trailing,
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

  /// Чип «На карте» рядом с сортировкой; `null` — чипа нет. Показывается
  /// только вместе с чипом сортировки: пустому «Избранному» на карте
  /// показывать нечего.
  final VoidCallback? onMapTap;

  /// Справа от заголовка, прижат к низу вместе с ним — тумблер
  /// «Списком / На карте» в режиме карты.
  final Widget? trailing;

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
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(child: _titleBlock(t, chipsGone)),
                  if (trailing != null) ...[
                    const SizedBox(width: 12),
                    trailing!,
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _titleBlock(double t, double chipsGone) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Рядом с тумблером на узком экране и крупном шрифте
        // заголовок ужимается, а не обрезается.
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(
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
                  // На узком экране с крупным шрифтом два чипа не помещаются
                  // в строку (320 dp, ×1,2) — ряд ужимается целиком, подписи
                  // остаются полными.
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FavoritesCoverChip(
                          icon: Icons.compare_arrows,
                          rotateIcon: true,
                          label: sortLabel!,
                          onTap: onSortTap,
                        ),
                        if (onMapTap != null) ...[
                          const SizedBox(width: 8),
                          FavoritesCoverChip(
                            icon: Icons.map,
                            label: 'На карте',
                            onTap: onMapTap,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Тумблер «Списком | На карте» компактной обложки (макет `3a`). Слова — те
/// же, что у переключателя на сайте (`ResultsSwitcher.tsx`).
///
/// Видимая плашка — по макету: отступ 3, радиус 9, стекло белое 16 % с
/// рамкой 38 %; сегмент 6 / 11, радиус 7; активный — белый с тёмной
/// подписью 13/w600. Зона нажатия каждого сегмента — его половина плашки и
/// ещё [tapOverhang] невидимого поля сверху и снизу, как у чипов.
class FavoritesViewToggle extends StatelessWidget {
  const FavoritesViewToggle({
    super.key,
    required this.mode,
    required this.onChanged,
  });

  final FavoritesViewMode mode;
  final ValueChanged<FavoritesViewMode> onChanged;

  /// Невидимое поле нажатия над и под плашкой.
  static const double tapOverhang = 3;

  /// Внутренний отступ плашки 3 + рамка 1.
  static const double _inset = 4;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          top: tapOverhang,
          bottom: tapOverhang,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: Colors.white.withValues(alpha: 0.38)),
            ),
          ),
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _segment('Списком', FavoritesViewMode.list, first: true),
            _segment('На карте', FavoritesViewMode.map, first: false),
          ],
        ),
      ],
    );
  }

  Widget _segment(String label, FavoritesViewMode value, {required bool first}) {
    final active = mode == value;
    return Semantics(
      button: true,
      selected: active,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: active ? null : () => onChanged(value),
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            first ? _inset : 0,
            tapOverhang + _inset,
            first ? 0 : _inset,
            tapOverhang + _inset,
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 11),
            decoration: active
                ? BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(7),
                  )
                : null,
            child: Text(
              label,
              maxLines: 1,
              style: TextStyle(
                fontFamily: AppTheme.fontBodyFamily,
                fontSize: 13,
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                color: active
                    ? AppTheme.textDark
                    : Colors.white.withValues(alpha: 0.85),
              ),
            ),
          ),
        ),
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
    this.onMapTap,
  });

  final double topInset;
  final String? subtitle;
  final String? sortLabel;
  final VoidCallback? onSortTap;
  final VoidCallback? onMapTap;

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
      onMapTap: onMapTap,
    );
  }

  @override
  bool shouldRebuild(FavoritesCoverHeaderDelegate oldDelegate) =>
      oldDelegate.topInset != topInset ||
      oldDelegate.subtitle != subtitle ||
      oldDelegate.sortLabel != sortLabel ||
      oldDelegate.onSortTap != onSortTap ||
      oldDelegate.onMapTap != onMapTap;
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
