import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/main.dart';
import 'package:restaurant_guide_mobile/screens/auth/login_screen.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/filter_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/secure_storage_stand.dart';
import 'support/wire_fixtures.dart';
import 'support/wire_stand.dart';

/// Таблица маршрутов корня приложения — та, что в `RestaurantGuideApp`.
///
/// Тесты навигации экранов пишут свою таблицу маршрутов: это изолирует
/// экран, но саму таблицу приложения (`lib/main.dart`) не строил ни один
/// тест — сторож реестра сбросов читает файл как текст. Опечатка в имени
/// маршрута или не тот экран под именем — тупик в «Показать все», в карточке
/// заведения, в фильтрах, и набор оставался зелёным.
void main() {
  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
  });

  Future<NavigatorState> pumpApp(WidgetTester tester) async {
    installWireStand((options) => options.uri.path.contains('/search')
        ? jsonBody(searchEnvelope())
        : jsonBody(<String, dynamic>{'success': false}, status: 404));
    installSecureStorageStand();
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const RestaurantGuideApp());
    await tester.pump();
    return tester.state<NavigatorState>(find.byType(Navigator).first);
  }

  Future<void> frames(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
  }

  for (final (route, screen) in <(String, Type)>[
    ('/search/results', ResultsListScreen),
    ('/filter', FilterScreen),
    ('/auth/login', LoginScreen),
    ('/establishment/11111111-1111-4111-8111-111111111111',
        EstablishmentDetailScreen),
  ]) {
    testWidgets('$route открывает ${screen.toString()}', (tester) async {
      final navigator = await pumpApp(tester);

      navigator.pushNamed(route);
      await frames(tester);

      expect(find.byType(screen), findsOneWidget);
      if (screen == EstablishmentDetailScreen) {
        expect(
          tester
              .widget<EstablishmentDetailScreen>(
                  find.byType(EstablishmentDetailScreen))
              .establishmentId,
          '11111111-1111-4111-8111-111111111111',
          reason: 'id заведения берётся из пути',
        );
      }
      tester.takeException(); // переполнения вёрстки в тестовом окне — не о том
      await unmount(tester);
    });
  }

  testWidgets('приложение говорит по-русски — пикеры даты и времени тоже',
      (tester) async {
    await pumpApp(tester);

    final context = tester.element(find.byType(Navigator).first);
    expect(Localizations.localeOf(context), const Locale('ru'));
    expect(MaterialLocalizations.of(context).cancelButtonLabel, 'Отмена');
    await unmount(tester);
  });
}
