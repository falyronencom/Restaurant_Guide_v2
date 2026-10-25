import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/open_status.dart';
import 'package:restaurant_guide_mobile/utils/walk_reach.dart';
import 'package:restaurant_guide_mobile/widgets/frame_cached_image.dart';

// Управление прогулкой над картой (README макета, экран 3): чипы над картой,
// выбор минут и шторка «ближайшие». Ничего не знает ни про избранное, ни про
// карту: тексты и действия приходят от хозяина.

/// Чип над картой: пилюля 34 видимых, радиус 17, подпись 13.
///
/// Активный — оранжевый с тенью, подпись белая 13/w600, иконка белая;
/// неактивный — белый с рамкой `strokeGrey`, подпись `textDark` 13/w500,
/// иконка `gray600`. Зона нажатия — [minTapHeight]: невидимые поля по 5
/// сверху и снизу, как у чипов обложки.
class MapFilterChip extends StatelessWidget {
  const MapFilterChip({
    super.key,
    required this.label,
    required this.active,
    this.icon,
    this.onTap,
  });

  final String label;
  final bool active;

  /// Иконка слева от подписи; `null` — без иконки.
  final IconData? icon;
  final VoidCallback? onTap;

  static const double visibleHeight = 34;
  static const double minTapHeight = 44;

  @override
  Widget build(BuildContext context) {
    final foreground = active ? Colors.white : AppTheme.textDark;
    return Semantics(
      button: true,
      selected: active,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              vertical: (minTapHeight - visibleHeight) / 2),
          child: Container(
            height: visibleHeight,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: active ? AppTheme.primaryOrange : Colors.white,
              borderRadius: BorderRadius.circular(visibleHeight / 2),
              border: active ? null : Border.all(color: AppTheme.strokeGrey),
              boxShadow: active
                  ? [
                      BoxShadow(
                        color: AppTheme.primaryOrangeShadow
                            .withValues(alpha: 0.28),
                        blurRadius: 6,
                        offset: const Offset(0, 2),
                      ),
                    ]
                  : null,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(
                    icon,
                    size: 16,
                    color: active ? Colors.white : AppTheme.gray600,
                  ),
                  const SizedBox(width: 6),
                ],
                Text(
                  label,
                  maxLines: 1,
                  style: TextStyle(
                    fontFamily: AppTheme.fontBodyFamily,
                    fontSize: 13,
                    fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                    color: foreground,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Выбор минут прогулки — шторка в стиле шторки сортировки: «✕», заголовок
/// по центру, строки с квадратом-галочкой. [current] отмечен; [onTurnOff]
/// (пока прогулка включена) добавляет строку «Выключить прогулку».
///
/// Шесть строк выше, чем шторке по умолчанию позволено (9/16 экрана): на
/// низком экране и при крупном шрифте они не поместились бы. Поэтому шторка
/// берёт высоту по содержимому, а если и экрана мало — прокручивается.
Future<void> showWalkMinutesSheet(
  BuildContext context, {
  required int? current,
  required ValueChanged<int> onSelected,
  VoidCallback? onTurnOff,
}) {
  return showModalBottomSheet<void>(
    context: context,
    // Поверх всего приложения, как выбор маршрута: в навигаторе вкладки
    // шторка оставляла бы нижнее меню доступным — ушли на другую вкладку,
    // карта снята, а шторка ждёт выбора, который уже некому принять.
    useRootNavigator: true,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (sheetContext) => SafeArea(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppDimensions.paddingM,
                vertical: AppDimensions.paddingS,
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Text(
                    'Пешком',
                    style:
                        Theme.of(sheetContext).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: IconButton(
                      icon: const Icon(Icons.close),
                      tooltip: 'Закрыть',
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            for (final minutes in kWalkMinuteOptions)
              _WalkMinutesOption(
                label: walkMinutesChoiceLabel(minutes),
                selected: minutes == current,
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  onSelected(minutes);
                },
              ),
            if (onTurnOff != null) ...[
              const Divider(height: 1),
              InkWell(
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  onTurnOff();
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppDimensions.paddingL,
                    vertical: AppDimensions.paddingM,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Выключить прогулку',
                          style: Theme.of(sheetContext)
                              .textTheme
                              .bodyLarge
                              ?.copyWith(color: AppTheme.primaryOrange),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: AppDimensions.paddingM),
          ],
        ),
      ),
    ),
  );
}

class _WalkMinutesOption extends StatelessWidget {
  const _WalkMinutesOption({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppDimensions.paddingL,
          vertical: AppDimensions.paddingM,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(
              child: Text(label, style: Theme.of(context).textTheme.bodyLarge),
            ),
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: selected ? AppTheme.textPrimary : Colors.transparent,
                borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                border: Border.all(
                  color: selected ? AppTheme.textPrimary : Colors.grey.shade400,
                  width: 1.5,
                ),
              ),
              child: selected
                  ? const Icon(Icons.check,
                      size: 16, color: AppTheme.textOnPrimary)
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// Шторка «ближайшие» над низом карты (README, «Шторка "ближайшие"»): фон
/// `backgroundWarm`, верхние углы 16, ручка, заголовок и справа подпись,
/// под ними ряд мини-карточек [places] или, если мест нет, [action].
///
/// Заголовок с местами — одной строкой и ужимается, а не переносится (в
/// макете `nowrap`); без мест — переносится: там он фраза, а не счётчик.
class WalkReachSheet extends StatelessWidget {
  const WalkReachSheet({
    super.key,
    required this.title,
    this.caption,
    this.places = const [],
    this.onPlaceTap,
    this.busy = false,
    this.action,
  });

  /// «3 места в 15 минутах», «Ищем, где вы…», «В 15 минутах ничего…».
  final String title;

  /// Справа от заголовка: «из избранного». Только при местах.
  final String? caption;

  final List<WalkPlace> places;
  final ValueChanged<Establishment>? onPlaceTap;

  /// Позиции ещё нет — под заголовком тонкая полоса ожидания.
  final bool busy;

  /// Кнопка под заголовком, когда мест нет: «Выбрать больше минут»,
  /// «Повторить».
  final ({String label, VoidCallback onTap})? action;

  @override
  Widget build(BuildContext context) {
    final hasPlaces = places.isNotEmpty;
    const titleStyle = TextStyle(
      fontFamily: AppTheme.fontBodyFamily,
      fontSize: 15,
      fontWeight: FontWeight.w600,
      color: AppTheme.textPrimary,
    );
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        16,
        14,
        16,
        18 + MediaQuery.paddingOf(context).bottom,
      ),
      decoration: BoxDecoration(
        color: AppTheme.backgroundWarm,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 14),
              decoration: BoxDecoration(
                color: AppTheme.gray300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          if (hasPlaces)
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(title, maxLines: 1, style: titleStyle),
                  ),
                ),
                if (caption != null) ...[
                  const SizedBox(width: 12),
                  Text(
                    caption!,
                    maxLines: 1,
                    style: const TextStyle(
                      fontFamily: AppTheme.fontBodyFamily,
                      fontSize: 13,
                      fontWeight: FontWeight.w400,
                      color: AppTheme.textGrey,
                    ),
                  ),
                ],
              ],
            )
          else
            Text(title, style: titleStyle),
          if (busy)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: LinearProgressIndicator(
                minHeight: 2,
                color: AppTheme.cockadeCornflower,
                backgroundColor: AppTheme.strokeWarm,
              ),
            ),
          if (hasPlaces)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              // Ряд по высоте самой высокой карточки: при крупном шрифте
              // карточка подрастает, а не режет строки.
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                clipBehavior: Clip.none,
                child: IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var i = 0; i < places.length; i++) ...[
                        if (i > 0) const SizedBox(width: 10),
                        WalkPlaceCard(
                          place: places[i],
                          onTap: onPlaceTap == null
                              ? null
                              : () => onPlaceTap!(places[i].establishment),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          if (!hasPlaces && action != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: TextButton(
                onPressed: action!.onTap,
                style: TextButton.styleFrom(
                  foregroundColor: AppTheme.primaryOrange,
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 44),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  textStyle: const TextStyle(
                    fontFamily: AppTheme.fontBodyFamily,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                child: Text(action!.label),
              ),
            ),
        ],
      ),
    );
  }
}

/// Мини-карточка места в шторке (README): 196 в ширину, поле 10, радиус
/// 14, белая с рамкой `strokeWarm`; фото 56 радиус 10; название 14/w600
/// одной строкой; «≈ 7 мин · 550 м» 12 `gray600`; статус 12/w500 — та же
/// подпись «Открыто · до 23:00», что у карточки списка ([openUntilSuffix]).
class WalkPlaceCard extends StatelessWidget {
  const WalkPlaceCard({super.key, required this.place, this.onTap});

  final WalkPlace place;
  final VoidCallback? onTap;

  static const double width = 196;
  static const double photoSize = 56;

  @override
  Widget build(BuildContext context) {
    final establishment = place.establishment;
    final open = establishment.isCurrentlyOpen;
    final closing = establishment.todayClosingTime;
    final thumbnail = establishment.thumbnailUrl;
    Widget placeholder() => Container(
          color: AppTheme.gray200,
          child: const Icon(Icons.restaurant, color: AppTheme.gray500),
        );
    return Semantics(
      button: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: width,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppTheme.strokeWarm),
          ),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: SizedBox(
                  width: photoSize,
                  height: photoSize,
                  child: thumbnail != null
                      ? FrameCachedImage(
                          imageUrl: thumbnail,
                          placeholder: (context, url) => placeholder(),
                          errorWidget: (context, url, error) => placeholder(),
                        )
                      : placeholder(),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      establishment.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: AppTheme.fontBodyFamily,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${walkMinutesLabel(place.meters)} · '
                      '${walkDistanceLabel(place.meters)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: AppTheme.fontBodyFamily,
                        fontSize: 12,
                        fontWeight: FontWeight.w400,
                        color: AppTheme.gray600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      open
                          ? 'Открыто${closing != null ? openUntilSuffix(closing) : ''}'
                          : 'Закрыто',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: AppTheme.fontBodyFamily,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: open ? AppTheme.statusGreen : AppTheme.errorRed,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
