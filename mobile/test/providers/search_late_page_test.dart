import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Поздний ответ подгрузки старого поиска не дописывается в новый (сверка
/// находок тестировщика с сайтом, 18.10, Ш7).
///
/// Было: новый поиск проверял только `_isLoading`, а у ответа не было
/// признака, к какому поиску он относится. Подгрузка страницы 2 по фразе А,
/// пришедшая после поиска Б, дописывала карточки А под выдачу Б и подменяла
/// её деление на совпадения и «возможно, подойдут».
///
/// Транспорт «с воротами»: каждый запрос ждёт, пока тест отпустит ответ, —
/// так поздний ответ ставится ровно туда, где его застаёт новый поиск.
class _GatedAdapter implements HttpClientAdapter {
  final List<Completer<ResponseBody>> gates = [];
  final List<String> queries = [];

  /// Отпустить ответ на запрос с номером [index] (по порядку отправки).
  void release(int index, Map<String, dynamic> body) =>
      gates[index].complete(jsonBody(body));

  void fail(int index) => gates[index].complete(jsonBody(
        <String, dynamic>{
          'success': false,
          'error': <String, dynamic>{'message': 'Сбой'},
        },
        // 400, не 5xx: на 5xx клиент повторяет запрос, и повтор ждал бы
        // ворот, которых никто не откроет.
        status: 400,
      ));

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final body = requestStream == null
        ? null
        : jsonDecode(utf8.decode(
            await requestStream.expand((chunk) => chunk).toList()));
    queries.add('${body is Map ? body['query'] : ''}:${body is Map ? body['page'] : ''}');
    final gate = Completer<ResponseBody>();
    gates.add(gate);
    return gate.future;
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late _GatedAdapter adapter;

  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
    // Мок хранилища и возврат транспорта на место — от общего стенда;
    // сам транспорт — с воротами.
    installWireStand((_) => throw StateError('транспорт с воротами'));
    adapter = _GatedAdapter();
    ApiClient().dio.httpClientAdapter = adapter;
  });

  Map<String, dynamic> page(String id, String name,
          {required int pageNo, required int total, required int matched}) =>
      smartSearchEnvelope(
        establishments: [establishmentRow(id: id, name: name)],
        intent: smartIntent(),
        page: pageNo,
        total: total,
        totalPages: (total / 20).ceil(),
        hasNext: pageNo * 20 < total,
        matchedTotal: matched,
      );

  const a1 = '11111111-1111-4111-8111-111111111111';
  const a2 = '22222222-2222-4222-8222-222222222222';
  const b1 = '33333333-3333-4333-8333-333333333333';

  Future<void> flush() => Future<void>.delayed(Duration.zero);

  /// Дождаться, пока до транспорта дойдёт [n]-й запрос: между вызовом и
  /// транспортом — асинхронные перехватчики (токен из хранилища).
  Future<void> requests(int n) async {
    for (var i = 0; i < 200 && adapter.gates.length < n; i++) {
      await flush();
    }
    expect(adapter.gates.length, n, reason: 'запрос № $n не дошёл до транспорта');
  }

  /// Поиск по «Бар» (45 совпадений), подгрузка его страницы 2 — в пути, и
  /// новый поиск «Buno» (совпадений нет). Возвращает провайдер; ответ
  /// подгрузки (запрос № 1) ещё не отпущен.
  Future<(EstablishmentsProvider, Future<void>)> searchThenRephrase() async {
    final provider = EstablishmentsProvider();
    addTearDown(provider.dispose);

    provider.setSearchQuery('Бар');
    final first = provider.searchEstablishments();
    await requests(1);
    adapter.release(0, page(a1, 'Бар А', pageNo: 1, total: 45, matched: 45));
    await first;
    expect(provider.hasMorePages, isTrue);

    final more = provider.loadMore();
    await requests(2);
    expect(adapter.queries[1], 'Бар:2');

    provider.setSearchQuery('Buno');
    final second = provider.searchEstablishments();
    await requests(3);
    expect(adapter.queries[2], 'Buno:1');
    return (provider, Future.wait([more, second]).then((_) {}));
  }

  test('страница 2 прежней фразы пришла ПОСЛЕ нового поиска — не дописана, деление не подменено',
      () async {
    final (provider, done) = await searchThenRephrase();

    adapter.release(2, page(b1, 'Кофейня Б', pageNo: 1, total: 1, matched: 0));
    for (var i = 0; i < 20; i++) {
      await flush();
    }
    adapter.release(1, page(a2, 'Бар Б', pageNo: 2, total: 45, matched: 45));
    await done;

    expect(provider.establishments.map((e) => e.id), [b1]);
    expect(provider.searchMatchedTotal, 0);
    expect(provider.suggestionsStartIndex, 0);
    expect(provider.isLoadingMore, isFalse);
  });

  test('страница 2 прежней фразы пришла ДО ответа нового поиска — не попала в выдачу',
      () async {
    final (provider, done) = await searchThenRephrase();

    adapter.release(1, page(a2, 'Бар Б', pageNo: 2, total: 45, matched: 45));
    for (var i = 0; i < 20; i++) {
      await flush();
    }
    expect(provider.establishments, isEmpty);

    adapter.release(2, page(b1, 'Кофейня Б', pageNo: 1, total: 1, matched: 0));
    await done;

    expect(provider.establishments.map((e) => e.id), [b1]);
    expect(provider.searchMatchedTotal, 0);
  });

  test('сбой подгрузки прежней фразы — не ошибка нового поиска', () async {
    final (provider, done) = await searchThenRephrase();

    adapter.release(2, page(b1, 'Кофейня Б', pageNo: 1, total: 1, matched: 0));
    for (var i = 0; i < 20; i++) {
      await flush();
    }
    adapter.fail(1);
    await done;

    expect(provider.error, isNull);
    expect(provider.establishments.map((e) => e.id), [b1]);
  });

  test('подгрузка, которая ещё в пути, не запирает подгрузку нового поиска',
      () async {
    final provider = EstablishmentsProvider();
    addTearDown(provider.dispose);

    provider.setSearchQuery('Бар');
    final first = provider.searchEstablishments();
    await requests(1);
    adapter.release(0, page(a1, 'Бар А', pageNo: 1, total: 45, matched: 45));
    await first;
    final staleMore = provider.loadMore();
    await requests(2);

    provider.setSearchQuery('кафе');
    final second = provider.searchEstablishments();
    await requests(3);
    adapter.release(2, page(b1, 'Кафе', pageNo: 1, total: 30, matched: 30));
    await second;

    final freshMore = provider.loadMore();
    for (var i = 0; i < 200 && adapter.gates.length < 4; i++) {
      await flush();
    }
    expect(adapter.queries.last, 'кафе:2',
        reason: 'подгрузка нового поиска ушла, хотя прежняя ещё в пути');

    adapter.release(3, page(a2, 'Кафе 2', pageNo: 2, total: 30, matched: 30));
    adapter.release(1, page(a2, 'Бар Б', pageNo: 2, total: 45, matched: 45));
    await Future.wait([staleMore, freshMore]);

    expect(provider.establishments.map((e) => e.name), ['Кафе', 'Кафе 2']);
  });
}
