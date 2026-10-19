import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Чтение избранного с сервера: не дублируется, не теряет место, добавленное
/// за время чтения, и не пускает ответ прежнего аккаунта.
///
/// Вход и первый кадр «Избранного» просят избранное в один и тот же момент
/// (п. 40 прохода тестировщика, 17.10.2026): на сервер должен уйти один
/// запрос, а не два. С другой стороны, чтение после сердечка (этап 3) обязано
/// начаться ПОСЛЕ ответа на добавление — идущее чтение началось раньше и не
/// видит нового места, присоединяться к нему нельзя.
///
/// Сервер здесь — с состоянием; ответ на чтение можно придержать (гейт),
/// чтобы второй вызов пришёл, пока первое чтение ещё идёт.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  late Map<String, Map<String, dynamic>> server;
  late bool failReads;
  late List<Map<String, dynamic>> searchRows;
  late List<Completer> gates;

  /// Не null — ответ на ближайшее добавление придержан до слова теста; сервер
  /// принимает добавление в момент, когда ответ уходит, а не когда пришёл запрос.
  late Completer<void>? postGate;
  late StubAdapter wire;

  /// Ответ на чтение избранного, который тест держит до своего слова.
  ResponseBody held(Completer gate, Map<String, dynamic> body,
      {int status = 200}) {
    return ResponseBody(
      Stream<Uint8List>.fromFuture(gate.future.then(
        (_) => Uint8List.fromList(utf8.encode(jsonEncode(body))),
      )),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  setUp(() {
    server = {'a': favoriteRow(id: 'a', name: 'Место a')};
    failReads = false;
    searchRows = [];
    gates = [];
    postGate = null;
    wire = installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/favorites' && options.method == 'POST') {
        final id = (options.data as Map)['establishmentId'] as String;
        final gate = postGate;
        if (gate != null) {
          postGate = null;
          gate.future.then((_) => server[id] = favoriteRow(id: id, name: 'Место $id'));
          return held(gate, {'success': true});
        }
        server[id] = favoriteRow(id: id, name: 'Место $id');
        return jsonBody({'success': true}, status: 201);
      }
      if (path == '/api/v1/favorites') {
        // 400, а не 500: на 5xx транспорт сам повторяет запрос с задержкой.
        if (failReads) {
          final refusal = {'success': false};
          if (gates.isNotEmpty) {
            return held(gates.removeAt(0), refusal, status: 400);
          }
          return jsonBody(refusal, status: 400);
        }
        // Снимок сервера берётся в момент запроса: придержанный ответ
        // «стареет», как настоящий.
        final body = favoritesEnvelope(favorites: server.values.toList());
        if (gates.isNotEmpty) return held(gates.removeAt(0), body);
        return jsonBody(body);
      }
      return jsonBody(searchEnvelope(
        establishments: searchRows,
        total: searchRows.length,
        totalPages: 1,
      ));
    });
  });

  int reads() => wire.requests
      .where((RequestOptions r) =>
          r.method == 'GET' && r.uri.path == '/api/v1/favorites')
      .length;

  List<String> listIds(EstablishmentsProvider p) =>
      [for (final e in p.favoriteEstablishments) e.id]..sort();

  EstablishmentsProvider makeProvider() {
    final p = EstablishmentsProvider();
    addTearDown(p.dispose);
    return p;
  }

  test('второй вызов, пока чтение идёт, присоединяется к нему — запрос один',
      () async {
    final gate = Completer<void>();
    gates.add(gate);
    final p = makeProvider();

    final first = p.loadFavorites();
    final second = p.loadFavorites();
    await pumpEventQueue();
    gate.complete();
    await Future.wait([first, second]);

    expect(reads(), 1, reason: 'вход и первый кадр «Избранного» — один запрос');
    expect(listIds(p), ['a']);
  });

  test('чтение закончилось — следующий вызов читает заново', () async {
    final p = makeProvider();
    await p.loadFavorites();
    await p.loadFavorites();

    expect(reads(), 2,
        reason: 'переход на вкладку и обновление вниз должны перечитывать');
  });

  test('ensureFavoritesLoaded: прочитано удачно — второго запроса нет',
      () async {
    final p = makeProvider();
    await p.ensureFavoritesLoaded();
    await p.ensureFavoritesLoaded();

    expect(reads(), 1);
    expect(listIds(p), ['a']);
  });

  test('ensureFavoritesLoaded: чтение сорвалось — следующий вызов повторяет',
      () async {
    failReads = true;
    final p = makeProvider();
    await p.ensureFavoritesLoaded();
    expect(listIds(p), isEmpty, reason: 'предпосылка: чтение не удалось');

    failReads = false;
    await p.ensureFavoritesLoaded();

    expect(reads(), 2);
    expect(listIds(p), ['a'], reason: 'сорвавшееся чтение не считается');
  });

  test('сброс аккаунта: прочитанное прежнего аккаунта не мешает читать '
      'нового', () async {
    final p = makeProvider();
    await p.ensureFavoritesLoaded();

    p.resetAccountScope();
    server = {'c': favoriteRow(id: 'c', name: 'Место c')};
    await p.ensureFavoritesLoaded();

    expect(reads(), 2);
    expect(listIds(p), ['c']);
  });

  test('сброс аккаунта во время чтения: новое чтение не присоединяется к '
      'чтению прежнего, ответ прежнего не доходит', () async {
    final gate = Completer<void>();
    gates.add(gate); // первое чтение (аккаунт A) придержано
    final p = makeProvider();

    final readA = p.ensureFavoritesLoaded();
    await pumpEventQueue();
    p.resetAccountScope();
    server = {'c': favoriteRow(id: 'c', name: 'Место c')};
    await p.ensureFavoritesLoaded(); // аккаунт B: свой запрос, не придержан
    expect(listIds(p), ['c'], reason: 'предпосылка: B прочитано');

    gate.complete(); // ответ A приходит позже
    await readA;

    expect(reads(), 2);
    expect(listIds(p), ['c'], reason: 'чужие места не появляются');
    expect(p.favoriteIds, {'c'});
  });

  test('сброс аккаунта во время чтения: поздний отказ прежнего не доходит до '
      'нового', () async {
    // «Ответ прежнего» — и отказ тоже. Отказ аккаунта A под чтением B
    // показал бы B сбой и опустил бы флаг загрузки, пока B ещё читает; успех
    // B ошибку не снимает, и она осталась бы над прочитанным списком.
    final gateA = Completer<void>();
    final gateB = Completer<void>();
    gates.addAll([gateA, gateB]);
    failReads = true; // чтение A сорвётся — но позже, чем начнётся чтение B
    final p = makeProvider();

    final readA = p.ensureFavoritesLoaded();
    await pumpEventQueue();
    p.resetAccountScope();
    failReads = false;
    server = {'c': favoriteRow(id: 'c', name: 'Место c')};
    final readB = p.ensureFavoritesLoaded();
    await pumpEventQueue();
    expect(reads(), 2, reason: 'предпосылка: B читает своим запросом');

    gateA.complete(); // отказ A приходит, пока B ещё читает
    await readA;
    expect(p.favoritesError, isNull, reason: 'отказ A — не сбой B');
    expect(p.isFavoritesLoading, isTrue, reason: 'чтение B ещё идёт');

    gateB.complete();
    await readB;
    expect(listIds(p), ['c']);
    expect(p.favoritesError, isNull);
  });

  test('сердечко, пока идёт чтение: место читается заново после ответа на '
      'добавление, а не из идущего чтения', () async {
    final gate = Completer<void>();
    gates.add(gate); // чтение придержано; его снимок — только место a
    final p = makeProvider();
    final reading = p.loadFavorites();
    await pumpEventQueue();

    final adding = p.toggleFavorite('b'); // места b нет ни в выдаче, ни в списке
    await pumpEventQueue();

    expect(reads(), 2,
        reason: 'идущее чтение началось до добавления и места b не увидит — '
            'нужен новый запрос');
    expect(listIds(p), ['a', 'b']);

    gate.complete();
    await Future.wait([reading, adding]);

    expect(listIds(p), ['a', 'b'],
        reason: 'старое чтение, закончившись позже свежего, его не затирает');
  });

  test('сердечко, пока идёт чтение: чтение закончилось раньше ответа на '
      'добавление и стёрло сердечко — оно возвращается', () async {
    final readGate = Completer<void>();
    gates.add(readGate); // снимок чтения — только место a
    final post = Completer<void>();
    postGate = post;
    final p = makeProvider();
    final reading = p.loadFavorites();
    await pumpEventQueue();
    final adding = p.toggleFavorite('b');
    await pumpEventQueue();

    readGate.complete();
    await reading;
    expect(p.isFavorite('b'), isFalse,
        reason: 'предпосылка: чтение, снятое до добавления, стёрло сердечко');

    post.complete();
    await adding;

    expect(p.favoriteIds, {'a', 'b'});
    expect(listIds(p), ['a', 'b']);
  });

  test('сердечко, потом чтение началось и закончилось до ответа на '
      'добавление — сердечко возвращается', () async {
    final post = Completer<void>();
    postGate = post;
    final p = makeProvider();
    final adding = p.toggleFavorite('b');
    await pumpEventQueue();
    await p.loadFavorites(); // например, переход на вкладку «Избранное»
    expect(p.isFavorite('b'), isFalse,
        reason: 'предпосылка: сервер добавление ещё не принял');

    post.complete();
    await adding;

    expect(p.favoriteIds, {'a', 'b'});
  });

  test('свежее чтение идёт, старое закончилось — новый вызов присоединяется '
      'к свежему, а не начинает третье', () async {
    final first = Completer<void>();
    final second = Completer<void>();
    gates.addAll([first, second]);
    final p = makeProvider();
    final r1 = p.loadFavorites();
    final r2 = p.loadFavorites(fresh: true);
    await pumpEventQueue();
    expect(reads(), 2, reason: 'предпосылка: свежее чтение не присоединилось');

    first.complete();
    await r1;
    final r3 = p.loadFavorites();
    await pumpEventQueue();
    expect(reads(), 2, reason: 'свежее чтение ещё идёт — третьего запроса нет');

    second.complete();
    await Future.wait([r2, r3]);
  });

  test('выход во время чтения: ответ прежнего аккаунта не появляется',
      () async {
    final gate = Completer<void>();
    gates.add(gate);
    final p = makeProvider();
    final reading = p.loadFavorites();
    await pumpEventQueue();

    p.resetAccountScope(); // выход: нового чтения нет
    gate.complete();
    await reading;

    expect(p.favoriteIds, isEmpty);
    expect(listIds(p), isEmpty,
        reason: 'выйти и увидеть чужое избранное нельзя; единственная защита — '
            'поколение аккаунта: более позднего чтения, которое отсеяло бы '
            'ответ по номеру, здесь нет');
  });

  test('чтение, начатое до нажатия, пришло после ответа на добавление — '
      'место из выдачи не стёрто', () async {
    searchRows = [establishmentRow(id: 'b', name: 'Место b')];
    final readGate = Completer<void>();
    gates.add(readGate); // снимок чтения — только место a
    final p = makeProvider();
    await p.searchEstablishments();
    final reading = p.loadFavorites();
    await pumpEventQueue();

    await p.toggleFavorite('b'); // место в выдаче, список дополнен сразу
    expect(listIds(p), ['a', 'b'], reason: 'предпосылка');
    readGate.complete();
    await reading;

    expect(p.favoriteIds, {'a', 'b'},
        reason: 'ответ чтения, снятого до добавления, пришёл после него');
    expect(listIds(p), ['a', 'b']);
  });

  test('чтение, начатое после нажатия, пришло после ответа на добавление — '
      'место из выдачи не стёрто', () async {
    searchRows = [establishmentRow(id: 'b', name: 'Место b')];
    final post = Completer<void>();
    postGate = post;
    final readGate = Completer<void>();
    gates.add(readGate); // снимок чтения — до приёма добавления сервером
    final p = makeProvider();
    await p.searchEstablishments();
    final adding = p.toggleFavorite('b');
    await pumpEventQueue();
    final reading = p.loadFavorites(); // например, переход на вкладку
    await pumpEventQueue();

    post.complete();
    await adding;
    expect(listIds(p), ['a', 'b'], reason: 'предпосылка');
    readGate.complete();
    await reading;

    expect(p.favoriteIds, {'a', 'b'});
    expect(listIds(p), ['a', 'b']);
  });
}
