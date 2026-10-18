import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/filter_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/smart_search_service.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_preview.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Поиск по названию, которого нет (сверка находок тестировщика, 17.10,
/// пункты 9, 10, 6, 36; решение Координатора В3): «Buno» давал «Результаты:
/// 46» — весь город под видом совпадений. Теперь сервер говорит, сколько
/// первых заведений выдачи совпали (`matchedTotal`), и экран показывает
/// «По запросу «…» ничего не найдено», а ниже — «Возможно, вам подойдут».
void main() {
  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
  });

  final three = [
    establishmentRow(id: '11111111-1111-4111-8111-111111111111', name: 'Бар'),
    establishmentRow(
        id: '22222222-2222-4222-8222-222222222222', name: 'Кофейня А'),
    establishmentRow(
        id: '33333333-3333-4333-8333-333333333333', name: 'Пекарня Б'),
  ];

  Map<String, dynamic> envelope(int? matchedTotal) => smartSearchEnvelope(
        establishments: three,
        intent: smartIntent(),
        total: 3,
        totalPages: 1,
        hasNext: false,
        matchedTotal: matchedTotal,
      );

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  group('SmartSearchResult.fromJson — matchedTotal', () {
    test('читает поле; без поля (сервер до 18.10) — null', () {
      expect(SmartSearchResult.fromJson(envelope(0)).matchedTotal, 0);
      expect(SmartSearchResult.fromJson(envelope(1)).matchedTotal, 1);
      expect(SmartSearchResult.fromJson(envelope(null)).matchedTotal, isNull);
    });
  });

  group('EstablishmentsProvider.suggestionsStartIndex', () {
    Future<EstablishmentsProvider> searched(int? matchedTotal) async {
      installWireStand((_) => jsonBody(envelope(matchedTotal)));
      final provider = EstablishmentsProvider();
      provider.setSearchQuery('Buno');
      await provider.searchEstablishments();
      return provider;
    }

    test('ничего не совпало — запасная выдача с первого места', () async {
      final provider = await searched(0);
      expect(provider.searchMatchedTotal, 0);
      expect(provider.suggestionsStartIndex, 0);
    });

    test('совпало одно из трёх — запасная выдача со второго', () async {
      expect((await searched(1)).suggestionsStartIndex, 1);
    });

    test('«Сброс» фильтров убирает фразу — и деление выдачи с ней (ревью PR #83, M1)',
        () async {
      final provider = await searched(0);
      provider.clearFilters();
      expect(provider.suggestionsStartIndex, isNull);
    });

    test('совпало всё или поля нет — делить нечего', () async {
      expect((await searched(3)).suggestionsStartIndex, isNull);
      expect((await searched(null)).suggestionsStartIndex, isNull);
    });
  });

  group('Экран результатов', () {
    Future<void> pumpResults(WidgetTester tester, int? matchedTotal) async {
      installWireStand((_) => jsonBody(envelope(matchedTotal)));
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 2400);
      addTearDown(tester.view.reset);

      final provider = EstablishmentsProvider();
      addTearDown(provider.dispose);
      provider.setSearchQuery('Buno');

      await tester.pumpWidget(
        ChangeNotifierProvider<EstablishmentsProvider>.value(
          value: provider,
          child: const MaterialApp(home: ResultsListScreen()),
        ),
      );
      await settle(tester);
    }

    double topOf(WidgetTester tester, String text) =>
        tester.getRect(find.text(text)).top;

    testWidgets(
        '«Buno»: «ничего не найдено», заведения — под «Возможно, вам подойдут»',
        (tester) async {
      await pumpResults(tester, 0);

      expect(find.text('По запросу «Buno» ничего не найдено'), findsOneWidget);
      expect(find.textContaining('Результаты:'), findsNothing);
      expect(topOf(tester, 'Возможно, вам подойдут'),
          lessThan(topOf(tester, 'Бар')));
    });

    testWidgets(
        'совпало одно: «Результаты: 1», затем заголовок, затем остальные',
        (tester) async {
      await pumpResults(tester, 1);

      expect(find.text('Результаты: 1'), findsOneWidget);
      final heading = topOf(tester, 'Возможно, вам подойдут');
      expect(topOf(tester, 'Бар'), lessThan(heading));
      expect(heading, lessThan(topOf(tester, 'Кофейня А')));
    });

    testWidgets('поля нет — как прежде', (tester) async {
      await pumpResults(tester, null);

      expect(find.text('Результаты: 3'), findsOneWidget);
      expect(find.text('Возможно, вам подойдут'), findsNothing);
      expect(find.textContaining('ничего не найдено'), findsNothing);
    });
  });

  group('Превью на главной', () {
    Future<void> pumpPreview(WidgetTester tester, int? matchedTotal) async {
      installWireStand((_) => jsonBody(smartSearchEnvelope(
            establishments: three,
            // Прочтение с блюдом: без совпадений его строка над карточками
            // выдавала бы запасную выдачу за ответ.
            intent: smartIntent(dish: 'булочка'),
            total: 9,
            matchedTotal: matchedTotal,
          )));
      final smart = SmartSearchProvider();
      addTearDown(smart.dispose);
      await tester.runAsync(() => smart.executeSmartSearch('Buno'));

      await tester.pumpWidget(
        ChangeNotifierProvider<SmartSearchProvider>.value(
          value: smart,
          child: MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: SmartSearchPreview(
                  onShowAll: () {},
                  onEstablishmentTap: (_) {},
                ),
              ),
            ),
          ),
        ),
      );
    }

    testWidgets(
        '«Buno»: «ничего не найдено», без прочтения, карточки под «Возможно, вам подойдут»',
        (tester) async {
      await pumpPreview(tester, 0);

      expect(find.text('По запросу «Buno» ничего не найдено'), findsOneWidget);
      expect(find.text('булочка'), findsNothing);
      expect(tester.getRect(find.text('Возможно, вам подойдут')).top,
          lessThan(tester.getRect(find.text('Бар')).top));
      // «Показать все» под «ничего не найдено» звучало бы как «все найденные».
      expect(find.text('Показать варианты (9)'), findsOneWidget);
      expect(find.textContaining('Показать все'), findsNothing);
    });

    testWidgets('совпадения есть — прочтение на месте, заголовка нет',
        (tester) async {
      await pumpPreview(tester, 9);

      expect(find.text('булочка'), findsOneWidget);
      expect(find.text('Показать все (9)'), findsOneWidget);
      expect(find.text('Возможно, вам подойдут'), findsNothing);
      expect(find.textContaining('ничего не найдено'), findsNothing);
    });
  });

  group('Лист города (пункт 6)', () {
    testWidgets(
        'вместо непонятного «Сброс» — «Минск — по умолчанию», и он выбирает Минск',
        (tester) async {
      installWireStand((_) => jsonBody(searchEnvelope()));
      SharedPreferences.setMockInitialValues(
        <String, Object>{BelarusCities.persistenceKey: 'Гродно'},
      );
      final establishments = EstablishmentsProvider();
      addTearDown(establishments.dispose);
      final smart = SmartSearchProvider();
      addTearDown(smart.dispose);
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(360, 800);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<EstablishmentsProvider>.value(
                value: establishments),
            ChangeNotifierProvider<SmartSearchProvider>.value(value: smart),
          ],
          child: const MaterialApp(home: SearchHomeScreen()),
        ),
      );
      await settle(tester);
      expect(establishments.selectedCity, 'Гродно');

      await tester.tap(find.text('Гродно').first);
      await tester.pumpAndSettle();

      expect(find.text('Сброс'), findsNothing);
      await tester.tap(find.text('Минск — по умолчанию'));
      await tester.pump();
      await tester.tap(find.text('Применить'));
      await tester.pumpAndSettle();

      expect(establishments.selectedCity, BelarusCities.defaultCity);
      expect(tester.takeException(), isNull);
    });
  });

  group('Фильтры: невыбранное не выглядит выключенным (пункт 36)', () {
    double contrast(Color a, Color b) {
      final la = a.computeLuminance();
      final lb = b.computeLuminance();
      final hi = la > lb ? la : lb;
      final lo = la > lb ? lb : la;
      return (hi + 0.05) / (lo + 0.05);
    }

    Future<void> pumpFilters(WidgetTester tester) async {
      installWireStand((_) => jsonBody(searchEnvelope()));
      final provider = EstablishmentsProvider();
      addTearDown(provider.dispose);
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 2400);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ChangeNotifierProvider<EstablishmentsProvider>.value(
          value: provider,
          child: const MaterialApp(home: FilterScreen()),
        ),
      );
      await tester.pump();
      // Карточка цены («$», 45 пт) в тестовом шрифте выше, чем на телефоне, и
      // переполняет свои 107 × 107. К цветам, которые проверяются здесь, это
      // отношения не имеет — исключение снимается, чтобы не ронять тест.
      final error = tester.takeException();
      expect(error == null || '$error'.contains('overflowed'), isTrue,
          reason: 'снимается только известное переполнение, не любая ошибка');
    }

    Border borderAround(WidgetTester tester, Finder label) {
      final box = tester.widget<Container>(find
          .ancestor(of: label, matching: find.byType(Container))
          .first);
      return (box.decoration! as BoxDecoration).border! as Border;
    }

    testWidgets('«Время работы»: текст ≥ 4,5 : 1, рамка ≥ 3 : 1 на фоне экрана',
        (tester) async {
      await pumpFilters(tester);

      const background = AppTheme.backgroundWarm;
      final labelFinder = find.text(HoursFilter.until22.displayLabel);
      final label = tester.widget<Text>(labelFinder);
      expect(contrast(label.style!.color!, background),
          greaterThanOrEqualTo(4.5));
      expect(contrast(borderAround(tester, labelFinder).top.color, background),
          greaterThanOrEqualTo(3.0));
    });

    testWidgets('карточка категории: рамка невыбранной ≥ 3 : 1',
        (tester) async {
      await pumpFilters(tester);

      expect(
          contrast(borderAround(tester, find.text('Кофейня')).top.color,
              AppTheme.backgroundWarm),
          greaterThanOrEqualTo(3.0));
    });
  });
}
