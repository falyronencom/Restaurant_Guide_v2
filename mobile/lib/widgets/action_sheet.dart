import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/utils/route_links.dart';

/// Строка шторки действий: значок, подпись, что сделать.
typedef ActionSheetItem = ({IconData icon, String label, VoidCallback onTap});

/// Шторка выбора действия — держит человека в приложении до осознанного
/// перехода (адрес, сайт, соцсеть, маршрут): выбор навигатора + «копировать».
/// Нажатие сначала закрывает шторку, потом выполняет действие.
Future<void> showActionSheet(BuildContext context, List<ActionSheetItem> actions) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppTheme.backgroundPrimary,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 12),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppTheme.strokeGrey,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 8),
          for (final a in actions)
            ListTile(
              leading: Icon(a.icon, color: AppTheme.textPrimary),
              title: Text(
                a.label,
                style: const TextStyle(
                  fontSize: 16,
                  color: AppTheme.textPrimary,
                ),
              ),
              onTap: () {
                Navigator.of(ctx).pop();
                a.onTap();
              },
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

/// Строки «Маршрут в Яндекс.Картах» и «Маршрут в Google Картах» до точки
/// ([lat], [lng]). Одни и те же в адресной шторке карточки заведения и за
/// кнопкой «Маршрут» карточки-превью на картах.
///
/// [launch] подменяется только в тестах.
List<ActionSheetItem> routeSheetItems(
  double lat,
  double lng, {
  RouteMode mode = RouteMode.driving,
  Future<void> Function(RouteLinks links) launch = launchRouteLinks,
}) {
  return [
    (
      icon: Icons.navigation_outlined,
      label: 'Маршрут в Яндекс.Картах',
      onTap: () => launch(yandexRouteLinks(lat, lng, mode)),
    ),
    (
      icon: Icons.navigation_outlined,
      label: 'Маршрут в Google Картах',
      onTap: () => launch(googleRouteLinks(lat, lng, mode)),
    ),
  ];
}

/// Кнопка «Маршрут» карточки-превью: рядом с «Подробнее», той же высоты,
/// вторична к ней — контур вместо заливки. Открывает выбор навигатора.
class RouteButton extends StatelessWidget {
  const RouteButton({
    super.key,
    required this.latitude,
    required this.longitude,
    this.mode = RouteMode.driving,
    this.launch = launchRouteLinks,
  });

  final double latitude;
  final double longitude;
  final RouteMode mode;

  /// Подменяется только в тестах.
  final Future<void> Function(RouteLinks links) launch;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: () => showActionSheet(
        context,
        routeSheetItems(latitude, longitude, mode: mode, launch: launch),
      ),
      style: OutlinedButton.styleFrom(
        foregroundColor: AppTheme.primaryOrange,
        backgroundColor: AppTheme.backgroundPrimary,
        side: const BorderSide(color: AppTheme.primaryOrange),
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        ),
      ),
      icon: const Icon(Icons.navigation_outlined, size: 18),
      label: const Text(
        'Маршрут',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
