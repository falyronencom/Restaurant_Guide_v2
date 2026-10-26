import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/results_search_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Поиск заново из шапки экрана результатов — настоящим обработчиком экрана.
///
/// `widgets/search_bar_submit_test.dart` проверяет саму строку
/// `ResultsSearchBar` с подставным колбэком; проводку «шапка экрана → его
/// поиск» не исполнял ни один тест: экран результатов строили четыре теста,
/// и ни один не вводил текст и не нажимал поиск.
void main() {
  late StubAdapter adapter;

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

  /// Запросы поиска, в которых ушла фраза [phrase] — в теле или в адресе.
  List<RequestOptions> searchesFor(String phrase) => adapter.requests
      .where((r) =>
          r.uri.path.contains('/search') &&
          (r.uri.queryParameters.values.contains(phrase) ||
              (r.data != null && jsonEncode(r.data).contains('"$phrase"'))))
      .toList();

  /// [empty] — выдача пустая: у экрана другая, статичная шапка (состояния
  /// загрузки, ошибки и «ничего не найдено»), а в ней — своя строка поиска.
  Future<EstablishmentsProvider> pumpResults(WidgetTester tester,
      {bool empty = false}) async {
    adapter = installWireStand((_) => jsonBody(smartSearchEnvelope(
          establishments: empty ? [] : [establishmentRow(name: 'Бар')],
          intent: smartIntent(),
          total: empty ? 0 : 1,
          totalPages: empty ? 0 : 1,
          hasNext: false,
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
        child: const MaterialApp(home: ResultsListScreen()),
      ),
    );
    await settle(tester);
    expect(find.text('Бар'), empty ? findsNothing : findsWidgets,
        reason: empty
            ? 'предусловие: выдача пустая — статичная шапка'
            : 'предусловие: выдача показана — шапка с результатами');
    expect(find.byType(ResultsSearchBar), findsOneWidget);
    return provider;
  }

  Finder field() => find.descendant(
      of: find.byType(ResultsSearchBar), matching: find.byType(TextField));

  for (final (how, submit) in <(String, Future<void> Function(WidgetTester))>[
    (
      'клавиша «Найти»',
      (t) => t.testTextInput.receiveAction(TextInputAction.search)
    ),
    (
      'лупа',
      (t) => t.tap(find.descendant(
          of: find.byType(ResultsSearchBar),
          matching: find.byIcon(Icons.search)))
    ),
  ]) {
    testWidgets('$how в шапке ищет заново по новой фразе — одним запросом',
        (tester) async {
      final provider = await pumpResults(tester);
      expect(searchesFor('Суши'), isEmpty);

      await tester.enterText(field(), 'Суши');
      await submit(tester);
      await settle(tester);

      expect(provider.searchQuery, 'Суши');
      expect(searchesFor('Суши'), hasLength(1),
          reason: 'одно нажатие — один поиск по новой фразе');
    });

    testWidgets('$how в шапке пустой выдачи ищет другое — одним запросом',
        (tester) async {
      // «Ничего не нашлось — ищу другое»: у пустой выдачи своя шапка и
      // своя проводка строки поиска.
      final provider = await pumpResults(tester, empty: true);

      await tester.enterText(field(), 'Суши');
      await submit(tester);
      await settle(tester);

      expect(provider.searchQuery, 'Суши');
      expect(searchesFor('Суши'), hasLength(1));
    });
  }
}
