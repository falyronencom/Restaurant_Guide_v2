import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/filter_icon_button.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Главная во вкладке: её переходы уходят в КОРНЕВОЙ навигатор, а поиск
/// запускают настоящие обработчики экрана.
///
/// В приложении главная живёт во вкладочном навигаторе
/// (`MainNavigationScreen._buildTabNavigator`), а экраны «Результаты» и
/// «Фильтр» — в таблице маршрутов корневого. Вкладочный навигатор на любое
/// имя молча отдаёт тот же экран вкладки (в отладке — assert): «нажал —
/// приехала та же страница». Прежние тесты главной поднимали её прямо под
/// `MaterialApp`, где навигатор один и `rootNavigator: true` ничем не
/// отличается от ближайшего, — уход перехода не в тот навигатор они не
/// видели. Обработчик «Показать все» не исполнял ни один тест (превью
/// получало `onShowAll: () {}`), а строку умного поиска проверяли с
/// подставными колбэками — без настоящего `_executeSmartSearch`.
///
/// Здесь — два навигатора, как в приложении: корневой с маршрутами и
/// вложенный, который, как вкладочный, знает только свой корень.
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

  List<RequestOptions> smartRequests() => adapter.requests
      .where((r) => r.uri.path == '/api/v1/search/smart')
      .toList();

  Future<void> frames(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Future<void> pumpHomeInTab(WidgetTester tester) async {
    adapter = installWireStand((options) =>
        options.uri.path == '/api/v1/search/smart'
            ? jsonBody(smartSearchEnvelope(
                establishments: [establishmentRow(name: 'Бар')],
                intent: smartIntent(),
                total: 9,
                matchedTotal: 9,
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
          // Корневой навигатор: здесь живут экраны приложения. Адресаты
          // подставные — проверяется, КУДА ушёл переход.
          routes: {
            '/search/results': (_) =>
                const Scaffold(body: Center(child: Text('РЕЗУЛЬТАТЫ'))),
            '/filter': (_) =>
                const Scaffold(body: Center(child: Text('ФИЛЬТРЫ'))),
          },
          // Вложенный навигатор — как вкладочный: свой корень, на чужое имя
          // — метка вместо экрана (в приложении — тот же экран вкладки).
          home: Navigator(
            onGenerateRoute: (settings) => MaterialPageRoute(
              settings: settings,
              builder: (_) => settings.name == null || settings.name == '/'
                  ? const SearchHomeScreen()
                  : Scaffold(
                      body: Center(
                          child: Text('ВКЛАДКА ПОЛУЧИЛА ${settings.name}'))),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  Finder field() => find.descendant(
      of: find.byType(SmartSearchBar), matching: find.byType(TextField));

  /// Оранжевая кнопка строки: при тексте — лупа, при пустой строке — стрелка.
  Finder barButton(IconData icon) => find.descendant(
      of: find.byType(SmartSearchBar), matching: find.byIcon(icon));

  Future<void> typePhrase(WidgetTester tester, String phrase) async {
    await tester.enterText(field(), phrase);
    await tester.pump();
  }

  Future<void> unmount(WidgetTester tester) async {
    // Периодический таймер подсказок в строке не должен пережить тест.
    await tester.pumpWidget(const SizedBox.shrink());
  }

  group('Переходы с главной — в корневой навигатор', () {
    testWidgets('стрелка (пустая строка) открывает результаты корневого '
        'навигатора', (tester) async {
      await pumpHomeInTab(tester);

      await tester.tap(barButton(Icons.chevron_right));
      await frames(tester);

      expect(find.text('РЕЗУЛЬТАТЫ'), findsOneWidget);
      expect(find.textContaining('ВКЛАДКА ПОЛУЧИЛА'), findsNothing);
      await unmount(tester);
    });

    testWidgets('«Показать все» под превью переносит фразу и открывает '
        'результаты корневого навигатора', (tester) async {
      await pumpHomeInTab(tester);
      await typePhrase(tester, 'Buno');
      await tester.tap(barButton(Icons.search));
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)));
      await frames(tester);
      final showAll = find.text('Показать все (9)');
      expect(showAll, findsOneWidget,
          reason: 'предусловие: превью умного поиска с кнопкой');

      await tester.tap(showAll);
      await frames(tester);

      expect(find.text('РЕЗУЛЬТАТЫ'), findsOneWidget,
          reason: '«Показать все» — единственный путь от превью к списку');
      expect(find.textContaining('ВКЛАДКА ПОЛУЧИЛА'), findsNothing);
      expect(establishments.searchQuery, 'Buno',
          reason: 'экран результатов ищет по фразе из строки');
      await unmount(tester);
    });

    testWidgets('кнопка фильтров открывает «Фильтр» корневого навигатора',
        (tester) async {
      await pumpHomeInTab(tester);

      await tester.tap(find.byType(FilterIconButton));
      await frames(tester);

      expect(find.text('ФИЛЬТРЫ'), findsOneWidget);
      expect(find.textContaining('ВКЛАДКА ПОЛУЧИЛА'), findsNothing);
      await unmount(tester);
    });
  });

  group('Строка умного поиска главной — настоящий обработчик', () {
    for (final (how, submit) in <(String, Future<void> Function(WidgetTester))>[
      ('оранжевая кнопка', (t) => t.tap(barButton(Icons.search))),
      (
        'клавиша «Найти» клавиатуры',
        (t) => t.testTextInput.receiveAction(TextInputAction.search)
      ),
    ]) {
      testWidgets('$how: ровно один запрос умного поиска с фразой строки',
          (tester) async {
        await pumpHomeInTab(tester);
        await typePhrase(tester, 'Buno');
        final before = smartRequests().length;

        await submit(tester);
        await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 50)));
        await frames(tester);

        final sent = smartRequests().skip(before).toList();
        expect(sent, hasLength(1),
            reason: 'одно нажатие — один платный запрос, не ноль и не два');
        expect((sent.single.data as Map)['query'], 'Buno');
        expect(find.text('Показать все (9)'), findsOneWidget,
            reason: 'ответ лёг в превью главной');
        await unmount(tester);
      });
    }
  });
}
