import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Подсказка-чип на главной: одно нажатие — один запрос умного поиска.
///
/// Умный поиск разбирает фразу платной моделью, и лишний запрос — это
/// лишняя плата и лишний шаг к пределу 429 у человека. Чип не нажимал ни
/// один тест: поиск, вызванный по нажатию дважды, прошёл бы весь набор.
void main() {
  setUp(() {
    AccountScope.debugReset();
    // Город в хранилище: без него post-frame ветка «GPS не дали и города нет»
    // открывает шторку выбора города поверх экрана.
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
  });

  testWidgets('чип «Кофе» — ровно один запрос умного поиска с этой фразой',
      (tester) async {
    final wire = installWireStand((options) =>
        options.uri.path == '/api/v1/search/smart'
            ? jsonBody(smartSearchEnvelope())
            : jsonBody(searchEnvelope()));
    final establishments = EstablishmentsProvider();
    addTearDown(establishments.dispose);
    final smart = SmartSearchProvider();
    addTearDown(smart.dispose);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<EstablishmentsProvider>.value(
              value: establishments),
          ChangeNotifierProvider<SmartSearchProvider>.value(value: smart),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const SearchHomeScreen(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    // Подсказки видны, пока поле в фокусе; ряд въезжает анимацией 250 мс,
    // и до её конца в чип не попасть.
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    final opacity = tester.widget<AnimatedOpacity>(find.ancestor(
      of: find.text('Кофе'),
      matching: find.byType(AnimatedOpacity),
    ));
    expect(opacity.opacity, 1.0, reason: 'предпосылка: подсказки видны');
    wire.requests.clear();

    await tester.tap(find.text('Кофе'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    final smartCalls = wire.requests
        .where((r) => r.uri.path == '/api/v1/search/smart')
        .toList();
    expect(smartCalls, hasLength(1));
    expect((smartCalls.single.data as Map<String, dynamic>)['query'], 'Кофе');
  });
}
