// Маршрут до заведения: адреса Яндекса и Google, авто и пешком, и выбор
// «приложение, иначе браузер».
//
// Ожидаемые адреса — литералами: авто — те, что карточка заведения открывала
// до этапа 3 (detail_screen.dart на 2bce0b9), пешком — Яндекс `rtt=pd`
// (README макета, раздел «Маршрут»), Google `directionsmode=walking` /
// `travelmode=walking` (документация Google Maps URLs).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/utils/route_links.dart';
import 'package:restaurant_guide_mobile/widgets/action_sheet.dart';
import 'package:url_launcher/url_launcher.dart';

void main() {
  group('адреса маршрута', () {
    const lat = 53.9045;
    const lng = 27.5615;

    final table = <(String, RouteLinks, String, String)>[
      (
        'Яндекс, авто',
        yandexRouteLinks(lat, lng, RouteMode.driving),
        'yandexmaps://maps.yandex.ru/?rtext=~53.9045,27.5615&rtt=auto',
        'https://yandex.by/maps/?rtext=~53.9045,27.5615&rtt=auto',
      ),
      (
        'Яндекс, пешком',
        yandexRouteLinks(lat, lng, RouteMode.walking),
        'yandexmaps://maps.yandex.ru/?rtext=~53.9045,27.5615&rtt=pd',
        'https://yandex.by/maps/?rtext=~53.9045,27.5615&rtt=pd',
      ),
      (
        'Google, авто',
        googleRouteLinks(lat, lng, RouteMode.driving),
        'comgooglemaps://?daddr=53.9045,27.5615&directionsmode=driving',
        'https://www.google.com/maps/dir/?api=1&destination=53.9045,27.5615',
      ),
      (
        'Google, пешком',
        googleRouteLinks(lat, lng, RouteMode.walking),
        'comgooglemaps://?daddr=53.9045,27.5615&directionsmode=walking',
        'https://www.google.com/maps/dir/?api=1&destination=53.9045,27.5615'
            '&travelmode=walking',
      ),
    ];

    for (final (name, links, app, web) in table) {
      test(name, () {
        expect(links.app.toString(), app, reason: 'приложение');
        expect(links.web.toString(), web, reason: 'браузер');
      });
    }
  });

  group('открыть маршрут', () {
    final links = (
      app: Uri.parse('yandexmaps://maps.yandex.ru/?rtext=~1,2&rtt=auto'),
      web: Uri.parse('https://yandex.by/maps/?rtext=~1,2&rtt=auto'),
    );

    Future<List<(Uri, LaunchMode)>> run({required bool appInstalled}) async {
      final launched = <(Uri, LaunchMode)>[];
      await launchRouteLinks(
        links,
        canLaunch: (uri) async => uri == links.app && appInstalled,
        launch: (uri, {LaunchMode mode = LaunchMode.platformDefault}) async {
          launched.add((uri, mode));
          return true;
        },
      );
      return launched;
    }

    test('приложение есть — открывается приложение, браузер нет', () async {
      expect(await run(appInstalled: true),
          [(links.app, LaunchMode.platformDefault)]);
    });

    test('приложения нет — браузер, отдельным приложением', () async {
      expect(await run(appInstalled: false),
          [(links.web, LaunchMode.externalApplication)]);
    });
  });

  group('кнопка «Маршрут»', () {
    Future<List<RouteLinks>> pumpButton(WidgetTester tester,
        {RouteMode mode = RouteMode.driving}) async {
      final launched = <RouteLinks>[];
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 175,
              child: RouteButton(
                latitude: 53.9045,
                longitude: 27.5615,
                mode: mode,
                launch: (links) async => launched.add(links),
              ),
            ),
          ),
        ),
      ));
      return launched;
    }

    testWidgets('открывает выбор из двух навигаторов, без «Скопировать адрес»',
        (tester) async {
      await pumpButton(tester);
      await tester.tap(find.byType(RouteButton));
      await tester.pumpAndSettle();

      expect(find.text('Маршрут в Яндекс.Картах'), findsOneWidget);
      expect(find.text('Маршрут в Google Картах'), findsOneWidget);
      expect(find.byType(ListTile), findsNWidgets(2));
    });

    testWidgets(
        'выбор открывается поверх всего приложения: навигатору вкладки '
        'по-прежнему нечего закрывать', (tester) async {
      // Вкладка живёт в своём навигаторе (main_navigation); экран «Карты»
      // показывает кнопку «назад», когда его навигатор может закрыть экран.
      final tabNavigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Navigator(
          key: tabNavigator,
          onGenerateRoute: (_) => MaterialPageRoute<void>(
            builder: (_) => Scaffold(
              body: Center(
                child: SizedBox(
                  width: 175,
                  child: RouteButton(
                    latitude: 53.9045,
                    longitude: 27.5615,
                    launch: (_) async {},
                  ),
                ),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.byType(RouteButton));
      await tester.pumpAndSettle();

      expect(find.text('Маршрут в Яндекс.Картах'), findsOneWidget);
      expect(tabNavigator.currentState!.canPop(), isFalse,
          reason: 'шторка в навигаторе вкладки — у «Карты» всплывает «назад»');
    });

    final choices = [
      ('Маршрут в Яндекс.Картах', RouteMode.driving,
          yandexRouteLinks(53.9045, 27.5615, RouteMode.driving)),
      ('Маршрут в Google Картах', RouteMode.driving,
          googleRouteLinks(53.9045, 27.5615, RouteMode.driving)),
      ('Маршрут в Яндекс.Картах', RouteMode.walking,
          yandexRouteLinks(53.9045, 27.5615, RouteMode.walking)),
      // Таблица — все пары «навигатор × способ»: пропущенная пара — та, где
      // кнопка может открыть не тот маршрут, и никто этого не увидит.
      ('Маршрут в Google Картах', RouteMode.walking,
          googleRouteLinks(53.9045, 27.5615, RouteMode.walking)),
    ];
    for (final (label, mode, expected) in choices) {
      testWidgets('«$label» ($mode): шторка закрыта, открыт этот маршрут',
          (tester) async {
        final launched = await pumpButton(tester, mode: mode);
        await tester.tap(find.byType(RouteButton));
        await tester.pumpAndSettle();
        await tester.tap(find.text(label));
        await tester.pumpAndSettle();

        expect(launched, [expected]);
        expect(find.byType(ListTile), findsNothing, reason: 'шторка закрыта');
      });
    }
  });
}
