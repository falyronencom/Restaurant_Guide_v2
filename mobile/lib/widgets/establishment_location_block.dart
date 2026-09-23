import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Шапка блока «Карта» на карточке заведения: заголовок, расстояние, адрес и
/// переход в навигатор.
///
/// Адрес здесь был обычным текстом, и тестировщики тапали по нему впустую:
/// единственным кликабельным местом блока была мини-карта, а она ведёт на
/// внутренний экран карты, а не в навигатор. Действие появилось — кнопка
/// «Как добраться»; мини-карта под блоком осталась «посмотреть, что рядом».
///
/// **Адрес намеренно НЕ кликабелен, и это решение, а не недоделка.** Сначала он
/// был сделан строкой-кнопкой (подложка, рамка, шеврон) и вёл в тот же выбор
/// карт, что и кнопка. На устройстве 20.09.2026 стало видно, в чём беда: два
/// соседних контрола делают одно и то же, но обещают РАЗНОЕ — шеврон на всех
/// остальных экранах означает «перейти куда-то ещё». Оставлен один контрол;
/// адрес вернулся к роли подписи, но с пином, который привязывает его к метке
/// на карте. Если снова захочется сделать строку кликабельной — сначала убрать
/// кнопку, иначе вернётся то же расхождение обещания с результатом.
///
/// Формулировка кнопки взята с веб-витрины (`web/src/components/establishment/
/// Location.tsx`), чтобы одно действие называлось одинаково на обеих площадках.
///
/// Вынесено из `detail_screen.dart` отдельным виджетом ради теста: экран
/// карточки целиком в widget-тест не поднимается — внутри `yandex_mapkit`.
class EstablishmentLocationBlock extends StatelessWidget {
  const EstablishmentLocationBlock({
    super.key,
    required this.address,
    required this.city,
    required this.onRouteTap,
    this.distanceText,
    this.showRouteButton = true,
  });

  final String address;
  final String city;

  /// Выбор карт — тот же, что и у чипа адреса на фронте карточки.
  final VoidCallback onRouteTap;

  /// `null` — геолокация не получена, строка расстояния не рисуется.
  final String? distanceText;

  /// `false` — у заведения нет координат, маршрут прокладывать некуда.
  final bool showRouteButton;

  /// Оптический сдвиг пина влево, чтобы его видимый край встал на ту же
  /// вертикаль, что и цифра расстояния над ним (замер — в [_buildAddressLine]).
  static const double _pinOpticalInset = 2;

  /// Зона тапа единственного контрола блока.
  ///
  /// Своим ограничением она НЕ задаётся: `ElevatedButton` по умолчанию идёт с
  /// `MaterialTapTargetSize.padded`, и тот уже добивает высоту до 48 — замер
  /// даёт ровно 48.0. Явный `minimumSize` здесь стоял и был снят как мёртвый:
  /// мутация «убрать его» тест не красила. Константа живёт ради теста, который
  /// падает, если у кнопки отнимут padded-цель или ужмут отступы.
  static const double minTapHeight = 48;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: AppTheme.backgroundWarm,
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(30),
          bottomRight: Radius.circular(30),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Карта',
            style: TextStyle(
              fontFamily: AppTheme.fontDisplayFamily,
              fontSize: 30,
              fontWeight: FontWeight.w400,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 14),
          if (distanceText != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Text(
                distanceText!,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.primaryOrange,
                ),
              ),
            ),
          _buildAddressLine(),
          if (showRouteButton) ...[
            const SizedBox(height: 14),
            _buildRouteButton(),
          ],
        ],
      ),
    );
  }

  /// Адрес — подпись к блоку, а не контрол: ни подложки, ни рамки, ни шеврона,
  /// ни тапа. Пин оставлен — он привязывает подпись к метке на карте ниже.
  Widget _buildAddressLine() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Сдвиг оптический, а не отступ: коробки строки расстояния и этой
        // строки начинаются в одной точке, но глиф пина уже своей 18-точечной
        // коробки и потому визуально стоит правее цифры. Замер на устройстве
        // 20.09.2026: левый край «8.0» — 59 px, левый край пина — 65 px при
        // dpr 3, то есть ровно 2 dp. `Transform` не трогает раскладку, поэтому
        // текст адреса остаётся на месте.
        Transform.translate(
          offset: const Offset(-_pinOpticalInset, 2),
          child: const Icon(
            Icons.place_outlined,
            size: 18,
            color: AppTheme.primaryOrange,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            '$address, $city',
            style: const TextStyle(
              fontSize: 16,
              color: AppTheme.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildRouteButton() {
    return Align(
      alignment: Alignment.centerLeft,
      child: ElevatedButton.icon(
        onPressed: onRouteTap,
        icon: const Icon(Icons.navigation_outlined, size: 18),
        label: const Text('Как добраться'),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppTheme.primaryOrange,
          foregroundColor: AppTheme.textOnPrimary,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          elevation: 0,
          textStyle: const TextStyle(
            fontFamily: AppTheme.fontBodyFamily,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
