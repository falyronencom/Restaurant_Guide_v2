import 'package:url_launcher/url_launcher.dart';

/// Как добираться до заведения. Карточка заведения и карточка-превью на
/// картах ведут авто; прогулка «Избранного» (этап 4) поведёт пешком.
enum RouteMode { driving, walking }

/// Ссылка в приложение карт и запасная — в браузер, если приложения нет.
typedef RouteLinks = ({Uri app, Uri web});

/// Маршрут в Яндекс.Картах от текущего положения до точки.
///
/// `rtext` — единственный параметр Яндекса, который берёт широту ПЕРВОЙ
/// (в отличие от `pt`/`ll`); `~` вместо точки старта значит «старт не задан»,
/// и Яндекс подставляет текущее положение. Ссылка та же, что на веб-витрине
/// (`web/src/lib/establishment-helpers.ts`), чтобы обе площадки вели в одно
/// место. `rtt`: `auto` — на машине, `pd` — пешком (макет «Избранного»,
/// раздел «Маршрут»).
///
/// Схема `yandexmaps` объявлена в `AndroidManifest.xml` (`<queries>`) и в
/// `Info.plist` (`LSApplicationQueriesSchemes`) — без объявления обе
/// платформы отвечают на [canLaunchUrl] отказом, и ветка приложения
/// недостижима.
RouteLinks yandexRouteLinks(double lat, double lng, RouteMode mode) {
  final rtt = switch (mode) {
    RouteMode.driving => 'auto',
    RouteMode.walking => 'pd',
  };
  return (
    app: Uri.parse('yandexmaps://maps.yandex.ru/?rtext=~$lat,$lng&rtt=$rtt'),
    web: Uri.parse('https://yandex.by/maps/?rtext=~$lat,$lng&rtt=$rtt'),
  );
}

/// Маршрут в Google Картах: схема приложения (только iOS) → универсальная
/// ссылка, которую на Android подхватывает само приложение.
///
/// Вид маршрута — по документации Google: у схемы `comgooglemaps://`
/// параметр `directionsmode` (`driving` / `walking`,
/// developers.google.com/maps/documentation/urls/ios-urlscheme), у
/// универсальной ссылки — `travelmode` (developers.google.com/maps/
/// documentation/urls/get-started). Авто-ссылка в браузер — без `travelmode`,
/// как была до этапа 3: Google выбирает вид сам.
RouteLinks googleRouteLinks(double lat, double lng, RouteMode mode) {
  return switch (mode) {
    RouteMode.driving => (
        app: Uri.parse(
            'comgooglemaps://?daddr=$lat,$lng&directionsmode=driving'),
        web: Uri.parse(
            'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng'),
      ),
    RouteMode.walking => (
        app: Uri.parse(
            'comgooglemaps://?daddr=$lat,$lng&directionsmode=walking'),
        web: Uri.parse('https://www.google.com/maps/dir/?api=1'
            '&destination=$lat,$lng&travelmode=walking'),
      ),
  };
}

/// Открыть маршрут: приложение карт, если телефон его знает, иначе браузер.
///
/// [canLaunch] и [launch] подменяются только в тестах.
Future<void> launchRouteLinks(
  RouteLinks links, {
  Future<bool> Function(Uri) canLaunch = canLaunchUrl,
  Future<bool> Function(Uri, {LaunchMode mode}) launch = _launch,
}) async {
  if (await canLaunch(links.app)) {
    await launch(links.app, mode: LaunchMode.platformDefault);
  } else {
    await launch(links.web, mode: LaunchMode.externalApplication);
  }
}

Future<bool> _launch(Uri uri, {LaunchMode mode = LaunchMode.platformDefault}) =>
    launchUrl(uri, mode: mode);
