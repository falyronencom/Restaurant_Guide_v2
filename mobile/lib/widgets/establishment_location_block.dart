import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Шапка блока «Карта» на карточке заведения: заголовок, расстояние, адрес и
/// переход в навигатор.
///
/// Адрес здесь был обычным текстом: тестировщики тапали по нему и не получали
/// ничего — единственным кликабельным местом блока была мини-карта, а она ведёт
/// на внутренний экран карты, а не в навигатор. Теперь намерения разведены явно:
/// строка адреса и кнопка «Как добраться» ведут в навигатор, мини-карта под
/// блоком — по-прежнему «посмотреть, что рядом».
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
    required this.onAddressTap,
    this.distanceText,
    this.showRouteButton = true,
  });

  final String address;
  final String city;

  /// Тот же выбор карт, что и у чипа адреса на фронте карточки.
  final VoidCallback onAddressTap;

  /// `null` — геолокация не получена, строка расстояния не рисуется.
  final String? distanceText;

  /// `false` — у заведения нет координат, маршрут прокладывать некуда.
  final bool showRouteButton;

  /// Минимальная высота строки адреса как зоны тапа.
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
          Text(
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
          _buildAddressRow(),
          if (showRouteButton) ...[
            const SizedBox(height: 14),
            _buildRouteButton(),
          ],
        ],
      ),
    );
  }

  /// Строка адреса — кликабельная целиком, а не по буквам текста.
  Widget _buildAddressRow() {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onAddressTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: minTapHeight),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: AppTheme.backgroundPrimary,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          border: Border.all(color: AppTheme.strokeGrey),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.place_outlined,
              size: 18,
              color: AppTheme.primaryOrange,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                '$address, $city',
                style: const TextStyle(
                  fontSize: 16,
                  color: AppTheme.textPrimary,
                ),
              ),
            ),
            const Icon(
              Icons.chevron_right,
              size: 20,
              color: AppTheme.textGrey,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRouteButton() {
    return Align(
      alignment: Alignment.centerLeft,
      child: ElevatedButton.icon(
        onPressed: onAddressTap,
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
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
