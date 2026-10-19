import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/filter_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/filter_icon_button.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Превью поиска на главной после экрана «Фильтр» (сверка находок
/// тестировщика с сайтом, 19.10, Ш23).
///
/// Было: превью под строкой считалось с фразой и фильтрами на момент поиска
/// и после «Сброс → Применить» оставалось прежним — «Buno» в строке, его
/// карточки и «Показать все (N)» по старым фильтрам, хотя фразу «Сброс» уже
/// снял. Теперь «Сброс» очищает строку и превью (как поле экрана
/// результатов, Ш6), а смена фильтров без «Сброса» пересчитывает превью той
/// же фразы.
void main() {
  late EstablishmentsProvider establishments;
  late SmartSearchProvider smart;
  late StubAdapter adapter;

  setUp(() {
    AccountScope.debugReset();
    // Город в хранилище: без него главная открывает шторку выбора города.
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
  });

  List<RequestOptions> smartRequests() =>
      adapter.requests.where((r) => r.uri.path.endsWith('/search/smart')).toList();

  Future<void> frames(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  /// Главная с превью по «Buno».
  Future<void> pumpHomeWithPreview(WidgetTester tester) async {
    adapter = installWireStand((options) => options.uri.path.endsWith('/search/smart')
        ? jsonBody(smartSearchEnvelope(
            establishments: [establishmentRow(name: 'Бар')],
            intent: smartIntent(),
            total: 9,
            matchedTotal: 0,
          ))
        : jsonBody(searchEnvelope()));
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 2400);
    addTearDown(tester.view.reset);

    establishments = EstablishmentsProvider();
    addTearDown(establishments.dispose);
    smart = SmartSearchProvider();
    addTearDown(smart.dispose);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<EstablishmentsProvider>.value(
              value: establishments),
          ChangeNotifierProvider<SmartSearchProvider>.value(value: smart),
        ],
        child: MaterialApp(
          home: const SearchHomeScreen(),
          routes: {'/filter': (_) => const FilterScreen()},
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.enterText(
        find.descendant(
            of: find.byType(SmartSearchBar), matching: find.byType(TextField)),
        'Buno');
    // Отправка фразы закрывает клавиатуру (_executeSmartSearch): строка без
    // фокуса. Иначе возврат с экрана фильтров вернул бы ей фокус, а фокус
    // строки сам очищает превью — это не то, что здесь проверяется.
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.runAsync(() => smart.executeSmartSearch('Buno',
        filters: establishments.screenFilters));
    await frames(tester);
    expect(find.text('По запросу «Buno» ничего не найдено'), findsOneWidget);
  }

  String fieldText(WidgetTester tester) => tester
      .widget<TextField>(find.descendant(
          of: find.byType(SmartSearchBar), matching: find.byType(TextField)))
      .controller!
      .text;

  Future<void> openFilters(WidgetTester tester) async {
    await tester.tap(find.byType(FilterIconButton));
    await frames(tester);
    tester.takeException(); // известное переполнение карточки цены в тестовом шрифте
  }

  Future<void> apply(WidgetTester tester) async {
    await tester.tap(find.text('Применить'));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await frames(tester);
  }

  Future<void> unmount(WidgetTester tester) async {
    // Периодический таймер подсказок в строке не должен пережить тест.
    await tester.pumpWidget(const SizedBox.shrink());
  }

  testWidgets('«Сброс → Применить»: строка и превью очищены', (tester) async {
    await pumpHomeWithPreview(tester);

    await openFilters(tester);
    await tester.tap(find.text('Сброс'));
    await tester.pump();
    await apply(tester);

    expect(fieldText(tester), isEmpty);
    expect(smart.state, SmartSearchState.idle);
    expect(find.textContaining('Buno'), findsNothing);
    await unmount(tester);
  });

  testWidgets('фильтр сменили без «Сброса» — превью той же фразы считается заново',
      (tester) async {
    await pumpHomeWithPreview(tester);
    final before = smartRequests().length;

    await openFilters(tester);
    await tester.tap(find.text('Кофейня'));
    await tester.pump();
    await apply(tester);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await frames(tester);

    final after = smartRequests();
    expect(after.length, before + 1, reason: 'превью пересчитано');
    expect('${after.last.data}', contains('Кофейня'),
        reason: 'с новым фильтром');
    expect(fieldText(tester), 'Buno');
    await unmount(tester);
  });

  testWidgets('открыли фильтры и вернулись без изменений — превью не трогается',
      (tester) async {
    await pumpHomeWithPreview(tester);
    final before = smartRequests().length;

    await openFilters(tester);
    await tester.tap(find.descendant(
        of: find.byType(FilterScreen),
        matching: find.byIcon(Icons.arrow_back_ios)));
    await frames(tester);

    expect(smartRequests().length, before);
    expect(fieldText(tester), 'Buno');
    expect(find.text('По запросу «Buno» ничего не найдено'), findsOneWidget);
    await unmount(tester);
  });
}
