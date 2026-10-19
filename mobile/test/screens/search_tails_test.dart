import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/filter_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/filter_icon_button.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_search_plaque.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Хвосты поиска в приложении (сверка находок тестировщика с сайтом, 18.10):
/// Ш5 — галочки «Расстояние» читаемы, Ш6 — «Сброс» на экране «Фильтр» и
/// поле поиска не расходятся, Ш1 — плашка карты говорит, что совпало не всё.
void main() {
  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
  });

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  group('Ш5: галочки «Расстояние» и удобств читаемы', () {
    double contrast(Color a, Color b) {
      final la = a.computeLuminance();
      final lb = b.computeLuminance();
      final hi = la > lb ? la : lb;
      final lo = la > lb ? lb : la;
      return (hi + 0.05) / (lo + 0.05);
    }

    Future<void> pumpFilters(WidgetTester tester,
        {required bool withLocation}) async {
      installWireStand((_) => jsonBody(searchEnvelope()));
      final provider = EstablishmentsProvider();
      addTearDown(provider.dispose);
      if (withLocation) provider.setUserLocation(53.9, 27.56);
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 3200);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ChangeNotifierProvider<EstablishmentsProvider>.value(
          value: provider,
          child: const MaterialApp(home: FilterScreen()),
        ),
      );
      await tester.pump();
      // Известное переполнение карточки цены в тестовом шрифте (см.
      // search_no_match_test.dart, пункт 36) — к рамкам отношения не имеет.
      final error = tester.takeException();
      expect(error == null || '$error'.contains('overflowed'), isTrue,
          reason: 'снимается только известное переполнение, не любая ошибка');
    }

    /// Рамка квадратика галочки в строке с подписью [label].
    Color checkboxStroke(WidgetTester tester, String label) {
      final row = find
          .ancestor(of: find.text(label), matching: find.byType(Row))
          .first;
      final box = tester.widget<Container>(find
          .descendant(of: row, matching: find.byType(Container))
          .last);
      return ((box.decoration! as BoxDecoration).border! as Border).top.color;
    }

    testWidgets('«Расстояние», геолокация есть: рамка невыбранной ≥ 3 : 1',
        (tester) async {
      await pumpFilters(tester, withLocation: true);

      final label = DistanceOption.values
          .firstWhere((o) => o != DistanceOption.all)
          .displayLabel;
      expect(
          contrast(checkboxStroke(tester, label), AppTheme.backgroundWarm),
          greaterThanOrEqualTo(3.0));
    });

    testWidgets('«Расстояние» без геолокации — по-прежнему бледное (выключено)',
        (tester) async {
      await pumpFilters(tester, withLocation: false);

      expect(checkboxStroke(tester, DistanceOption.values.last.displayLabel),
          AppTheme.strokeGrey);
    });

    testWidgets('удобства — та же галочка, та же рамка ≥ 3 : 1',
        (tester) async {
      await pumpFilters(tester, withLocation: false);

      expect(
          contrast(checkboxStroke(tester, 'Wi-Fi'), AppTheme.backgroundWarm),
          greaterThanOrEqualTo(3.0));
    });
  });

  group('Ш6: «Сброс» на экране «Фильтр» и поле поиска', () {
    Future<EstablishmentsProvider> pumpResults(WidgetTester tester) async {
      installWireStand((_) => jsonBody(smartSearchEnvelope(
            establishments: [establishmentRow(name: 'Бар')],
            intent: smartIntent(),
            total: 1,
            totalPages: 1,
            hasNext: false,
            matchedTotal: 0,
          )));
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 2400);
      addTearDown(tester.view.reset);

      final provider = EstablishmentsProvider();
      addTearDown(provider.dispose);
      provider.setSearchQuery('Buno');

      await tester.pumpWidget(
        ChangeNotifierProvider<EstablishmentsProvider>.value(
          value: provider,
          child: MaterialApp(
            home: const ResultsListScreen(),
            routes: {'/filter': (_) => const FilterScreen()},
          ),
        ),
      );
      await settle(tester);
      return provider;
    }

    String fieldText(WidgetTester tester) =>
        tester.widget<TextField>(find.byType(TextField)).controller!.text;

    /// Назад с экрана «Фильтр» — его собственной стрелкой.
    Future<void> backFromFilters(WidgetTester tester) async {
      await tester.tap(find.descendant(
          of: find.byType(FilterScreen),
          matching: find.byIcon(Icons.arrow_back_ios)));
      // Не pumpAndSettle: курсор поля мигает бесконечно.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
    }

    Future<void> openFilters(WidgetTester tester) async {
      await tester.tap(find.byType(FilterIconButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
      tester.takeException(); // известное переполнение карточки цены
    }

    testWidgets('«Сброс», затем назад: фразы нет — поле пустое', (tester) async {
      final provider = await pumpResults(tester);
      expect(fieldText(tester), 'Buno');

      await openFilters(tester);
      await tester.tap(find.text('Сброс'));
      await tester.pump();
      // Экран фильтров ещё открыт, поле под ним пока прежнее — сверка при
      // возврате.
      await backFromFilters(tester);

      expect(provider.searchQuery, isNull);
      expect(fieldText(tester), isEmpty);
    });

    testWidgets('без «Сброса» поле держит фразу, как прежде', (tester) async {
      await pumpResults(tester);

      await openFilters(tester);
      await backFromFilters(tester);

      expect(fieldText(tester), 'Buno');
    });
  });

  group('Ш1: плашка карты — совпало не всё', () {
    Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

    testWidgets('ничего не совпало: «ничего не найдено», метки — «могут подойти»',
        (tester) async {
      await tester.pumpWidget(host(Center(
        child: MapSearchPlaque(
            phrase: 'Buno', shown: 9, total: 9, matchedTotal: 0, onClear: () {}),
      )));

      expect(find.text('По запросу «Buno» ничего не найдено'), findsOneWidget);
      expect(find.text('На карте — места, которые могут подойти'),
          findsOneWidget);
      expect(find.textContaining('Поиск:'), findsNothing);
    });

    testWidgets('совпало одно из девяти: «найдено: 1», остальные — «могут подойти»',
        (tester) async {
      await tester.pumpWidget(host(Center(
        child: MapSearchPlaque(
            phrase: 'бар', shown: 9, total: 9, matchedTotal: 1, onClear: () {}),
      )));

      expect(find.text('Поиск: «бар» · найдено: 1'), findsOneWidget);
      expect(find.text('Остальные на карте — места, которые могут подойти'),
          findsOneWidget);
    });

    testWidgets('совпало всё или поля нет — как прежде, одной строкой',
        (tester) async {
      await tester.pumpWidget(host(Column(children: [
        MapSearchPlaque(
            phrase: 'кафе', shown: 9, total: 9, matchedTotal: 9, onClear: () {}),
        MapSearchPlaque(phrase: 'кофе', shown: 9, total: 9, onClear: () {}),
      ])));

      expect(find.text('Поиск: «кафе»'), findsOneWidget);
      expect(find.text('Поиск: «кофе»'), findsOneWidget);
      expect(find.textContaining('могут подойти'), findsNothing);
    });

    testWidgets(
        'узкий экран (320 dp, вкладка карты): «ничего не найдено» не уходит под многоточие, без переполнения',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(host(Stack(children: [
        Positioned(
          top: 12,
          // Вкладка «Карта»: кнопки «назад» нет — полоса по 16 dp с краёв.
          left: 16,
          right: 16,
          child: Center(
            child: MapSearchPlaque(
                phrase: 'Buno',
                shown: 9,
                total: 9,
                matchedTotal: 0,
                onClear: () {}),
          ),
        ),
      ])));

      expect(tester.takeException(), isNull);
      final title = find.text('По запросу «Buno» ничего не найдено');
      final painter = TextPainter(
        text: TextSpan(
            text: 'По запросу «Buno» ничего не найдено',
            style: tester.widget<Text>(title).style),
        textDirection: TextDirection.ltr,
        maxLines: tester.widget<Text>(title).maxLines,
      )..layout(maxWidth: tester.getSize(title).width);
      expect(painter.didExceedMaxLines, isFalse);
      expect(find.byTooltip('Показать все заведения'), findsOneWidget);
    });
  });
}
