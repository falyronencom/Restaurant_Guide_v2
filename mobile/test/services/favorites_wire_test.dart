import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Избранное на проводе: сколько мест доходит до экрана.
///
/// До 29.09.2026 приложение запрашивало `/api/v1/favorites` без `limit`, а
/// бэкенд по умолчанию отдаёт 10 (`favoriteController`). Одиннадцатое
/// сохранённое место молча пропадало из списка и счётчика — без ошибки,
/// без пустого экрана. Макет «Избранного» (счётчик «12 мест» в обложке, все
/// сохранённые на карте) держится на том, что сервис приносит всё.
void main() {
  List<Map<String, dynamic>> rows(int from, int count) => [
        for (var i = from; i < from + count; i++)
          favoriteRow(id: 'id-$i', name: 'Место $i'),
      ];

  group('Загрузка избранного', () {
    test('размер страницы уходит в запрос — не умолчание бэкенда', () async {
      final adapter = installWireStand((_) => jsonBody(favoritesEnvelope()));

      await EstablishmentsService().getFavorites();

      final q = adapter.requests.single.queryParameters;
      expect(adapter.requests.single.path, '/api/v1/favorites');
      expect(q['limit'], 50,
          reason: 'без limit бэкенд отдаёт 10 мест, остальные теряются');
      expect(q['page'], 1);
    });

    test('при hasNext сервис дочитывает следующие страницы', () async {
      final adapter = installWireStand((options) {
        final page = options.queryParameters['page'] as int;
        return jsonBody(page == 1
            ? favoritesEnvelope(
                favorites: rows(0, 50), page: 1, total: 62, hasNext: true)
            : favoritesEnvelope(favorites: rows(50, 12), page: 2, total: 62));
      });

      final result = await EstablishmentsService().getFavorites();

      expect(result, hasLength(62));
      expect(result.last.name, 'Место 61');
      expect(adapter.requests.map((r) => r.queryParameters['page']), [1, 2]);
    });

    test('у кого больше ста мест — список приходит целиком, все пять страниц',
        () async {
      // Предохранитель от вечного hasNext не должен резать реальный
      // список: тесты выше читают не больше двух страниц, и потолок «2» их
      // не красил бы — а у кого 101+ мест, список молча обрезался бы. Здесь
      // проверено «не меньше пяти страниц» (250 мест), не сам потолок.
      final adapter = installWireStand((options) {
        final page = options.queryParameters['page'] as int;
        return jsonBody(favoritesEnvelope(
          favorites: rows((page - 1) * 50, page < 5 ? 50 : 7),
          page: page,
          total: 207,
          hasNext: page < 5,
        ));
      });

      final result = await EstablishmentsService().getFavorites();

      expect(result, hasLength(207));
      expect(result.last.name, 'Место 206');
      expect(adapter.requests.map((r) => r.queryParameters['page']),
          [1, 2, 3, 4, 5]);
    });

    test('последняя страница — запрос ровно один', () async {
      final adapter = installWireStand(
          (_) => jsonBody(favoritesEnvelope(favorites: rows(0, 12))));

      final result = await EstablishmentsService().getFavorites();

      expect(result, hasLength(12));
      expect(adapter.requests, hasLength(1),
          reason: 'лишний запрос — тоже дефект');
    });

    test('место, съехавшее на следующую страницу, не приходит дважды',
        () async {
      // Бэкенд листает смещением: снятое между страницами сердечко сдвигает
      // выдачу, и последнее место первой страницы повторится во второй.
      installWireStand((options) {
        final page = options.queryParameters['page'] as int;
        return jsonBody(page == 1
            ? favoritesEnvelope(favorites: rows(0, 50), hasNext: true)
            : favoritesEnvelope(favorites: rows(49, 3), page: 2));
      });

      final result = await EstablishmentsService().getFavorites();

      expect(result.map((e) => e.id).toSet(), hasLength(result.length),
          reason: 'повтор по id');
      expect(result, hasLength(52));
    });

    test('вечное hasNext не крутит транспорт бесконечно', () async {
      final adapter = installWireStand((options) => jsonBody(favoritesEnvelope(
          favorites: [favoriteRow(id: 'x-${options.queryParameters['page']}')],
          hasNext: true)));

      await EstablishmentsService().getFavorites();

      expect(
          adapter.requests, hasLength(EstablishmentsService.favoritesMaxPages));
    });
  });
}
