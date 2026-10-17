import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Список избранного на телефоне совпадает с сервером при сердечке.
///
/// Сердечко сразу кладёт id в множество, а само заведение в список — только
/// если находит его в текущей выдаче поиска. Карточка заведения держит
/// заведение у себя, поэтому сердечко в карточке, открытой с карты или из
/// «Избранного», список не дополняло: сердечко залито, а на карте
/// «Избранного» пина нет, и счёт в профиле (длина списка) отстаёт — п. 40
/// прохода тестировщика 17.10.2026. Сценарий карты: «Подробнее» → снять
/// сердечко → поставить снова → «назад».
///
/// Сервер здесь — с состоянием: POST кладёт место в избранное, DELETE
/// убирает, GET отдаёт текущий список; выдача поиска — отдельный набор.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  late Map<String, Map<String, dynamic>> server;
  late List<Map<String, dynamic>> searchRows;
  late bool failAdd;
  late StubAdapter wire;

  setUp(() {
    server = {'a': favoriteRow(id: 'a', name: 'Место a')};
    searchRows = [];
    failAdd = false;
    wire = installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/favorites' && options.method == 'POST') {
        if (failAdd) return jsonBody({'success': false}, status: 500);
        final id = (options.data as Map)['establishmentId'] as String;
        server[id] = favoriteRow(id: id, name: 'Место $id');
        return jsonBody({'success': true}, status: 201);
      }
      if (path.startsWith('/api/v1/favorites/') && options.method == 'DELETE') {
        server.remove(path.split('/').last);
        return jsonBody({'success': true});
      }
      if (path == '/api/v1/favorites') {
        return jsonBody(favoritesEnvelope(favorites: server.values.toList()));
      }
      return jsonBody(searchEnvelope(
        establishments: searchRows,
        total: searchRows.length,
        totalPages: 1,
      ));
    });
  });

  Future<EstablishmentsProvider> withFavoritesLoaded() async {
    final p = EstablishmentsProvider();
    addTearDown(p.dispose);
    await p.loadFavorites();
    return p;
  }

  List<String> listIds(EstablishmentsProvider p) =>
      [for (final e in p.favoriteEstablishments) e.id]..sort();

  int favoritesReads() => wire.requests
      .where((RequestOptions r) =>
          r.method == 'GET' && r.uri.path == '/api/v1/favorites')
      .length;

  test('место не из выдачи: сердечко — место в списке, счёт верный', () async {
    final p = await withFavoritesLoaded();
    expect(p.establishments, isEmpty,
        reason: 'предпосылка: выдачи нет, места b в ней нет');

    await p.toggleFavorite('b');

    expect(p.isFavorite('b'), isTrue);
    expect(listIds(p), ['a', 'b'],
        reason: 'сердечко залито, а места нет — пина на карте нет');
    expect(p.favoriteEstablishments, hasLength(2), reason: 'счёт профиля');
  });

  test(
      'снять и снова поставить сердечко месту не из выдачи (карта '
      '«Избранного» → «Подробнее») — место снова в списке', () async {
    server['b'] = favoriteRow(id: 'b', name: 'Место b');
    final p = await withFavoritesLoaded();
    expect(listIds(p), ['a', 'b']);

    await p.toggleFavorite('b');
    expect(listIds(p), ['a'], reason: 'снятое место уходит из списка сразу');

    await p.toggleFavorite('b');
    expect(listIds(p), ['a', 'b']);
  });

  test('место из выдачи — в списке сразу, избранное заново не читается',
      () async {
    searchRows = [establishmentRow(id: 'b', name: 'Место b')];
    final p = await withFavoritesLoaded();
    await p.searchEstablishments();
    final before = favoritesReads();

    await p.toggleFavorite('b');

    expect(listIds(p), ['a', 'b']);
    expect(favoritesReads(), before, reason: 'лишний запрос — тоже дефект');
  });

  test(
      'сердечко сняли, пока сервер принимал добавление, — избранное заново '
      'не читается', () async {
    final p = await withFavoritesLoaded();
    final before = favoritesReads();

    final adding = p.toggleFavorite('b'); // ответ на добавление ещё не пришёл
    await p.toggleFavorite('b');
    await adding;

    expect(p.isFavorite('b'), isFalse);
    expect(listIds(p), ['a']);
    expect(favoritesReads(), before);
  });

  test('сервер не принял сердечко — место не в избранном, чтения нет',
      () async {
    failAdd = true;
    final p = await withFavoritesLoaded();
    final before = favoritesReads();

    await p.toggleFavorite('b');

    expect(p.isFavorite('b'), isFalse, reason: 'сердечко откатилось');
    expect(listIds(p), ['a']);
    expect(favoritesReads(), before);
  });
}
