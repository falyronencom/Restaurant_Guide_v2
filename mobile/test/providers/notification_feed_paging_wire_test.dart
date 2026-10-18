import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Лента уведомлений на проводе: листание, которое не теряет и не повторяет
/// строки, и фильтр, который не расходится со списком под ним.
///
/// С 16.10.2026 (PR #51) лента листается дальше первых 20 — и стали
/// достижимы два дефекта догрузки, а третий был с первого дня:
///   1а. номер страницы рос до запроса: обрыв сети на догрузке пропускал
///       страницу, и лента выглядела законченной на 25 из 45;
///   1б. сервер листает смещением: уведомление, пришедшее между загрузками,
///       сдвигает выдачу, и последняя строка страницы приходила снова;
///   1в. смена чипа во время загрузки молча терялась: запрос с новым
///       фильтром не уходил, под чипом «Мои отзывы» оставались брони.
///
/// Обрыв — именно обрыв без ответа (исключение из транспорта), не 5xx:
/// `ApiClient` повторяет 5xx сам, и такая страница доходит со второй
/// попытки, не воспроизводя дефект.
///
/// Транспорт подставной и может держать ответ «за воротами», пока тест его
/// не отпустит: так смена фильтра вставляется между запросом и ответом.
class _FeedAdapter implements HttpClientAdapter {
  _FeedAdapter(this.respond);

  final Future<ResponseBody> Function(RequestOptions options) respond;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late _FeedAdapter adapter;

  List<Map<String, dynamic>> rows(int from, int count,
          {String type = 'booking_received'}) =>
      [
        for (var i = from; i < from + count; i++)
          notificationRow(id: 'n-$i', title: 'Уведомление $i', type: type),
      ];

  ResponseBody unread(int count) => jsonBody(<String, dynamic>{
        'success': true,
        'data': <String, dynamic>{'count': count},
      });

  /// Транспорт ленты: [feed] отвечает на запросы списка и отметки
  /// «прочитано», счётчик непрочитанных — [unreadCount].
  void serve(Future<ResponseBody> Function(RequestOptions options) feed,
      {int unreadCount = 0}) {
    adapter = _FeedAdapter((options) async {
      if (options.path == '/api/v1/notifications/unread-count') {
        return unread(unreadCount);
      }
      return feed(options);
    });
    ApiClient().dio.httpClientAdapter = adapter;
  }

  List<RequestOptions> feedRequests() => adapter.requests
      .where((r) => r.path == '/api/v1/notifications')
      .toList();

  List<Object?> pagesAsked() =>
      feedRequests().map((r) => r.queryParameters['page']).toList();

  NotificationProvider signedIn() {
    final provider = NotificationProvider();
    addTearDown(provider.dispose);
    provider.startPolling();
    return provider;
  }

  setUp(() {
    AccountScope.debugReset();
    // Канал хранилища и возврат прежнего транспорта в tearDown — от обычного
    // стенда; поверх него — свой транспорт.
    installWireStand((_) => jsonBody(<String, dynamic>{}), accessToken: 'tok');
  });

  test('1а. обрыв сети на второй странице — страница не пропадает: «Повторить» '
      'запрашивает её же, лента дочитывается до 45', () async {
    var secondPageAttempts = 0;
    serve((options) async {
      final page = options.queryParameters['page'] as int;
      if (page == 2 && ++secondPageAttempts == 1) {
        throw const SocketException('обрыв связи');
      }
      return jsonBody(notificationsEnvelope(
        items: rows((page - 1) * 20, page == 3 ? 5 : 20),
        page: page,
        total: 45,
        pages: 3,
      ));
    });
    final provider = signedIn();

    await provider.fetchNotifications(refresh: true);
    await provider.loadMore();
    expect(provider.notifications, hasLength(20));
    expect(provider.errorMessage, isNotNull,
        reason: 'сбой догрузки виден — экран покажет «Повторить»');
    expect(provider.hasMore, isTrue,
        reason: 'вторая страница не пришла — лента не закончилась');

    // Прокрутка у нижнего края зовёт loadMore на каждом шаге — после сбоя
    // это не должно сыпать запросами.
    await provider.loadMore();
    expect(pagesAsked(), [1, 2], reason: 'после сбоя прокрутка не шлёт запрос');

    await provider.retry();
    expect(provider.errorMessage, isNull);
    await provider.loadMore();

    expect(pagesAsked(), [1, 2, 2, 3],
        reason: '«Повторить» просит ту же вторую страницу, не третью');
    expect(provider.notifications.map((n) => n.id),
        [for (var i = 0; i < 45; i++) 'n-$i']);
    expect(provider.hasMore, isFalse);
  });

  test('1б. уведомление, пришедшее между загрузками, сдвигает выдачу — '
      'строка со стыка страниц не повторяется', () async {
    serve((options) async {
      final page = options.queryParameters['page'] as int;
      // Между первой и второй загрузкой на сервере появилось новое
      // уведомление: смещение 20 теперь начинается с прежней 20-й строки.
      return jsonBody(page == 1
          ? notificationsEnvelope(
              items: rows(0, 20), page: 1, total: 26, pages: 2)
          : notificationsEnvelope(
              items: rows(19, 7), page: 2, total: 27, pages: 2));
    });
    final provider = signedIn();

    await provider.fetchNotifications(refresh: true);
    await provider.loadMore();

    expect(provider.notifications.map((n) => n.id),
        [for (var i = 0; i < 26; i++) 'n-$i'],
        reason: 'n-19 пришло дважды — в ленте остаётся одна копия');
  });

  group('1в. смена фильтра во время загрузки', () {
    test('выбран «Мои отзывы», пока грузится «Все» — запрос с фильтром уходит, '
        'поздний ответ «Все» не ложится под чип', () async {
      final allGate = Completer<ResponseBody>();
      serve((options) {
        final category = options.queryParameters['category'];
        if (category == null) return allGate.future;
        return Future.value(jsonBody(notificationsEnvelope(
          items: rows(100, 3, type: 'new_review'),
          total: 3,
          pages: 1,
        )));
      });
      final provider = signedIn();

      final firstLoad = provider.fetchNotifications(refresh: true);
      await pumpEventQueue();
      provider.setCategory('reviews');
      await pumpEventQueue();

      expect(feedRequests().map((r) => r.queryParameters['category']),
          [null, 'reviews'],
          reason: 'запрос с новым фильтром ушёл, не дожидаясь первого');
      expect(provider.notifications.map((n) => n.id),
          ['n-100', 'n-101', 'n-102']);

      allGate.complete(jsonBody(
          notificationsEnvelope(items: rows(0, 20), total: 40, pages: 2)));
      await firstLoad;
      await pumpEventQueue();

      expect(provider.currentCategory, 'reviews');
      expect(provider.notifications.map((n) => n.id),
          ['n-100', 'n-101', 'n-102'],
          reason: 'ответ на «Все», пришедший позже, отброшен');
      expect(provider.hasMore, isFalse,
          reason: 'число страниц — тоже от ответа с фильтром');
      expect(provider.isLoading, isFalse);
    });

    test('выбран «Мои отзывы», пока грузится «Все» — поздний ОТКАЗ «Все» тоже '
        'не ложится под чип', () async {
      // Ответ прежнего фильтра — и отказ тоже: сбой «Все» под чипом «Мои
      // отзывы» показал бы ошибку над загруженным списком, а успех её не
      // снимает — подгрузка следующих страниц встала бы.
      final allGate = Completer<ResponseBody>();
      serve((options) {
        final category = options.queryParameters['category'];
        if (category == null) return allGate.future;
        return Future.value(jsonBody(notificationsEnvelope(
          items: rows(100, 3, type: 'new_review'),
          total: 3,
          pages: 1,
        )));
      });
      final provider = signedIn();

      final firstLoad = provider.fetchNotifications(refresh: true);
      await pumpEventQueue();
      provider.setCategory('reviews');
      await pumpEventQueue();
      expect(provider.notifications.map((n) => n.id),
          ['n-100', 'n-101', 'n-102'],
          reason: 'предпосылка: «Мои отзывы» загружены');

      allGate.completeError(const SocketException('обрыв связи'));
      await firstLoad;
      await pumpEventQueue();

      expect(provider.currentCategory, 'reviews');
      expect(provider.errorMessage, isNull,
          reason: 'сбой «Все» — не сбой «Мои отзывы»');
      expect(provider.notifications.map((n) => n.id),
          ['n-100', 'n-101', 'n-102']);
      expect(provider.isLoading, isFalse);
    });

    test('при смене чипа список прежнего фильтра снимается сразу — пока идёт '
        'загрузка и если она сорвалась', () async {
      final reviewsGate = Completer<ResponseBody>();
      serve((options) {
        if (options.queryParameters['category'] == 'reviews') {
          return reviewsGate.future;
        }
        return Future.value(jsonBody(
            notificationsEnvelope(items: rows(0, 20), total: 20, pages: 1)));
      });
      final provider = signedIn();
      await provider.fetchNotifications(refresh: true);
      expect(provider.notifications, hasLength(20));

      provider.setCategory('reviews');
      await pumpEventQueue();
      expect(provider.notifications, isEmpty,
          reason: 'брони «Все» не стоят под чипом «Мои отзывы»');
      expect(provider.isLoading, isTrue);

      reviewsGate.completeError(const SocketException('обрыв связи'));
      await pumpEventQueue();
      expect(provider.notifications, isEmpty);
      expect(provider.errorMessage, isNotNull,
          reason: 'экран покажет сбой, а не чужой список');
    });
  });

  group('Отметка «прочитано» сорвалась', () {
    test('пока шёл запрос, сменили чип — откат не падает и возвращает счётчик',
        () async {
      // Откат писал в строку по номеру, взятому до запроса. Смена чипа
      // снимает список сразу, и номер указывал за его конец: исключение из
      // `catch`, которого никто не ловит — экран зовёт отметку без await.
      final markGate = Completer<ResponseBody>();
      serve((options) {
        if (options.path.endsWith('/read')) return markGate.future;
        final reviews = options.queryParameters['category'] == 'reviews';
        return Future.value(jsonBody(reviews
            ? notificationsEnvelope(items: rows(100, 3), total: 3, pages: 1)
            : notificationsEnvelope(items: rows(0, 20), total: 20, pages: 1)));
      }, unreadCount: 5);
      final provider = signedIn();
      await provider.fetchNotifications(refresh: true);
      await pumpEventQueue();
      expect(provider.unreadCount, 5);

      final marking = provider.markAsRead('n-15');
      await pumpEventQueue();
      expect(provider.unreadCount, 4);

      provider.setCategory('reviews');
      await pumpEventQueue();
      markGate.completeError(const SocketException('обрыв связи'));

      await expectLater(marking, completes);
      expect(provider.unreadCount, 5, reason: 'отметка не удалась — счётчик назад');
      expect(provider.notifications.map((n) => n.isRead), everyElement(isFalse),
          reason: 'строки нового списка не задеты чужим откатом');
    });

    test('уведомление уже было прочитано — откат его не трогает', () async {
      serve((options) {
        if (options.path.endsWith('/read')) {
          throw const SocketException('обрыв связи');
        }
        return Future.value(jsonBody(notificationsEnvelope(
          items: [
            notificationRow(id: 'n-read', isRead: true),
            notificationRow(id: 'n-new'),
          ],
          total: 2,
          pages: 1,
        )));
      }, unreadCount: 1);
      final provider = signedIn();
      await provider.fetchNotifications(refresh: true);
      await pumpEventQueue();

      await provider.markAsRead('n-read');

      expect(provider.notifications.first.isRead, isTrue,
          reason: 'прочитанное не становится «новым» из-за сбоя');
      expect(provider.unreadCount, 1, reason: 'счётчик не растёт сверх правды');
    });
  });
}
