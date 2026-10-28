import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Превью умного поиска на главной: побеждает последний начатый поиск
/// (сверка «Честность тестов клиентов», 25.10.2026, Q-DP1).
///
/// Было: провайдер писал любой пришедший ответ поверх выдачи. Гость искал
/// «паста с грибами», передумывал и тапал «Суши»; суши приходили быстро
/// (фраза в кэше сервера), паста — через несколько секунд, и под полем
/// «Суши» оставались карточки пасты и «Показать все (N)» с её N. Запоздавшая
/// ошибка первого поиска так же стирала удачную выдачу второго. Экран
/// результатов (`_searchSeq`) и карта (`_fetchGeneration`) от этого уже
/// защищены; превью — нет.
///
/// Ответы сервера здесь управляемые: каждый запрос ждёт, пока тест не
/// отпустит его, поэтому порядок прихода задаёт тест, а не сеть.
void main() {
  late _GatedAdapter gate;

  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
    // Стенд провода ставит мок хранилища и возвращает прежний транспорт в
    // tearDown; транспорт подменяется управляемым поверх него.
    installWireStand((_) => jsonBody(searchEnvelope()));
    gate = _GatedAdapter();
    ApiClient().dio.httpClientAdapter = gate;
  });

  ResponseBody answer(String name, {int total = 3}) => jsonBody(
        smartSearchEnvelope(
          establishments: [establishmentRow(name: name)],
          intent: smartIntent(),
          total: total,
        ),
      );

  List<String> shownNames(SmartSearchProvider smart) =>
      smart.smartResults.map((e) => e.name).toList();

  group('провайдер', () {
    late SmartSearchProvider smart;

    setUp(() {
      smart = SmartSearchProvider();
      addTearDown(smart.dispose);
    });

    test('ответ первого поиска пришёл после второго — остаётся второй',
        () async {
      final first = smart.executeSmartSearch('паста с грибами');
      final second = smart.executeSmartSearch('суши');
      await gate.sent(2);

      gate.release('суши', answer('Суши-бар', total: 7));
      await second;
      gate.release('паста с грибами', answer('Паста-хаус', total: 40));
      await first;

      expect(gate.queries, ['паста с грибами', 'суши']);
      expect(shownNames(smart), ['Суши-бар'],
          reason: 'запоздавший ответ первого поиска лёг поверх второго');
      expect(smart.totalResults, 7);
      expect(smart.lastQuery, 'суши');
      expect(smart.state, SmartSearchState.results);
    });

    test('первый поиск отказал после успеха второго — выдача второго цела',
        () async {
      final first = smart.executeSmartSearch('паста с грибами');
      final second = smart.executeSmartSearch('суши');
      await gate.sent(2);

      gate.release('суши', answer('Суши-бар', total: 7));
      await second;
      gate.fail('паста с грибами');
      await first;

      expect(smart.state, SmartSearchState.results,
          reason: 'запоздавшая ошибка первого поиска стёрла выдачу второго');
      expect(smart.errorMessage, isNull);
      expect(shownNames(smart), ['Суши-бар']);
      expect(smart.totalResults, 7);
    });

    test('ответы пришли по порядку — показан второй', () async {
      // Контроль: защита не должна глушить и сам последний ответ.
      final first = smart.executeSmartSearch('паста с грибами');
      final second = smart.executeSmartSearch('суши');
      await gate.sent(2);

      gate.release('паста с грибами', answer('Паста-хаус', total: 40));
      await first;
      expect(smart.state, SmartSearchState.loading,
          reason: 'ответ прежнего поиска не должен подменять «Ищем…» '
              'текущего');
      expect(smart.smartResults, isEmpty);

      gate.release('суши', answer('Суши-бар', total: 7));
      await second;
      expect(shownNames(smart), ['Суши-бар']);
      expect(smart.state, SmartSearchState.results);
    });

    test('очистка поля: ответ поиска, ушедшего до неё, не всплывает',
        () async {
      // Фокус в поле зовёт clear() — гость начинает новую фразу, под полем
      // подсказки. Ответ прежнего поиска не должен вытеснить их карточками.
      final first = smart.executeSmartSearch('паста с грибами');
      await gate.sent(1);
      smart.clear();

      gate.release('паста с грибами', answer('Паста-хаус', total: 40));
      await first;

      expect(smart.state, SmartSearchState.idle);
      expect(smart.smartResults, isEmpty);
      expect(smart.lastQuery, isEmpty);
    });

    test('очистка поля: отказ поиска, ушедшего до неё, не показывает ошибку',
        () async {
      final first = smart.executeSmartSearch('паста с грибами');
      await gate.sent(1);
      smart.clear();

      gate.fail('паста с грибами');
      await first;

      expect(smart.state, SmartSearchState.idle);
      expect(smart.errorMessage, isNull);
    });
  });

  group('экран', () {
    testWidgets('под полем «суши» — карточка суши, хотя ответ пасты пришёл '
        'последним', (tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 2400);
      addTearDown(tester.view.reset);

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
          child: const MaterialApp(home: SearchHomeScreen()),
        ),
      );
      await tester.pump();
      await tester.pump();

      final field = find.descendant(
          of: find.byType(SmartSearchBar), matching: find.byType(TextField));

      // Настоящий ввод-вывод (канал хранилища, транспорт) идёт вне
      // поддельного времени теста, а его продолжения — внутри: крутим оба,
      // пока условие не выполнится.
      Future<void> settle(bool Function() done) async {
        for (var i = 0; i < 100 && !done(); i++) {
          await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 10)));
          await tester.pump(const Duration(milliseconds: 10));
        }
        expect(done(), isTrue, reason: 'стенд не дождался условия');
      }

      // Две фразы подряд тем путём, каким их отправляет гость: клавиша
      // «Найти» на клавиатуре. На экране вторая фраза начинается с фокуса в
      // поле, а фокус зовёт clear() — поэтому этот тест держит наблюдаемое
      // гостем «под полем — последняя фраза», а номер поиска в самом
      // executeSmartSearch (путь без очистки — перезапуск после «Фильтра»)
      // держат тесты провайдера выше (ревью Phase 3.5, Sonnet, 26.10.2026).
      await tester.enterText(field, 'паста с грибами');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await settle(() => gate.queries.isNotEmpty);
      await tester.enterText(field, 'суши');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await settle(() => gate.queries.length == 2);
      expect(gate.queries, ['паста с грибами', 'суши']);

      gate.release('суши', answer('Суши-бар', total: 7));
      await settle(() => find.text('Суши-бар').evaluate().isNotEmpty);
      gate.release('паста с грибами', answer('Паста-хаус', total: 40));
      await settle(() => gate.deliveredCount == 2);
      for (var i = 0; i < 8; i++) {
        await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 10)));
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(find.text('Суши-бар'), findsOneWidget);
      expect(find.text('Паста-хаус'), findsNothing,
          reason: 'под полем «суши» лежит выдача прежней фразы');
      expect(find.textContaining('(40)'), findsNothing,
          reason: '«Показать все» обещает число прежней фразы');

      // Периодический таймер подсказок в строке не должен пережить тест.
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });
}

/// Транспорт, который держит каждый запрос умного поиска, пока тест не
/// отпустит его по фразе. Прочие запросы (если экран их сделает) отвечают
/// пустой выдачей сразу.
class _GatedAdapter implements HttpClientAdapter {
  final Map<String, Completer<ResponseBody>> _pending = {};
  final List<String> queries = [];
  int _delivered = 0;
  final _changes = StreamController<void>.broadcast();

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (!options.uri.path.endsWith('/search/smart')) {
      return jsonBody(searchEnvelope());
    }
    final query = (options.data as Map)['query'] as String;
    final completer = Completer<ResponseBody>();
    _pending[query] = completer;
    queries.add(query);
    _changes.add(null);
    try {
      return await completer.future;
    } finally {
      _delivered++;
      _changes.add(null);
    }
  }

  Future<void> _until(bool Function() done) async {
    while (!done()) {
      await _changes.stream.first.timeout(const Duration(seconds: 3));
    }
    // Ответ отдан транспорту; перехватчики и провайдер дорабатывают в
    // следующих микрозадачах.
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }

  /// Ждёт, пока на провод уйдут [count] запросов поиска.
  Future<void> sent(int count) => _until(() => queries.length >= count);

  /// Сколько ответов транспорт уже отдал.
  int get deliveredCount => _delivered;

  void release(String query, ResponseBody body) =>
      _pending.remove(query)!.complete(body);

  /// Обрыв связи: ответа нет, лестницы повторов 5xx тоже нет.
  void fail(String query) => _pending.remove(query)!.completeError(
        DioException.connectionError(
          requestOptions: RequestOptions(path: '/api/v1/search/smart'),
          reason: 'обрыв связи (стенд)',
        ),
      );

  @override
  void close({bool force = false}) {}
}
