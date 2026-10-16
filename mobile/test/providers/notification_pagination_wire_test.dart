import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Лента уведомлений на проводе: доходит ли до экрана вторая страница.
///
/// С марта по 16.10.2026 не доходила ни в одной сборке. Провайдер решает,
/// есть ли ещё страницы, по `pagination.totalPages`, а сервер называл число
/// страниц только `pages`; пропавший ключ подставлялся единицей, и после
/// первых 20 уведомлений лента молча кончалась — без ошибки и без индикатора
/// внизу. Правка — на сервере: он шлёт оба имени. Поэтому она доходит до уже
/// установленных сборок без пересборки, и здесь проверено, что приложение в
/// нынешнем виде листает такой ответ до конца.
///
/// Стенд подменяет транспорт, а не сервис: разбор конверта и имена ключей
/// пагинации исполняет настоящий `NotificationService`.
void main() {
  late StubAdapter adapter;

  // 25 уведомлений при странице 20: на первой 20, на второй 5.
  List<Map<String, dynamic>> rows(int from, int count) => [
        for (var i = from; i < from + count; i++)
          notificationRow(id: 'n-$i', title: 'Уведомление $i'),
      ];

  void serveTwoPageFeed({required bool withTotalPages}) {
    adapter = installWireStand((options) {
      if (options.path == '/api/v1/notifications/unread-count') {
        return jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'count': 0},
        });
      }
      final page = options.queryParameters['page'] as int;
      return jsonBody(notificationsEnvelope(
        items: page == 1 ? rows(0, 20) : rows(20, 5),
        page: page,
        total: 25,
        pages: 2,
        withTotalPages: withTotalPages,
      ));
    }, accessToken: 'tok');
  }

  List<RequestOptions> feedRequests() => adapter.requests
      .where((r) => r.path == '/api/v1/notifications')
      .toList();

  /// Провайдер вошедшего пользователя: без `startPolling` лента не грузится.
  NotificationProvider signedIn() {
    final provider = NotificationProvider();
    addTearDown(provider.dispose);
    provider.startPolling();
    return provider;
  }

  setUp(AccountScope.debugReset);

  test('ответ сервера с двумя страницами — лента дочитывает вторую и на ней '
      'кончается', () async {
    serveTwoPageFeed(withTotalPages: true);
    final provider = signedIn();

    await provider.fetchNotifications(refresh: true);
    expect(provider.notifications, hasLength(20));
    expect(provider.hasMore, isTrue,
        reason: 'на сервере 25 уведомлений — впереди вторая страница');

    await provider.loadMore();
    expect(provider.notifications.map((n) => n.id),
        [for (var i = 0; i < 25; i++) 'n-$i'],
        reason: 'вторая страница дописана за первой, по порядку');
    expect(provider.hasMore, isFalse, reason: 'вторая страница — последняя');

    await provider.loadMore();
    expect(
      feedRequests().map((r) => r.queryParameters['page']),
      [1, 2],
      reason: 'за последней страницей запросов нет',
    );
    expect(feedRequests().map((r) => r.queryParameters['limit']), [20, 20]);
    expect(provider.errorMessage, isNull);
  });

  test('ГРАНИЦА: ответ без totalPages (сервер до правки) — лента молча '
      'кончается на первой странице', () async {
    // Фиксация цены, а не желаемое поведение: так лента вела себя у всех с
    // марта. Ответ при этом честно говорит «страниц 2» — под именем `pages`,
    // которого провайдер не читает. Убрать `totalPages` из ответа сервера —
    // вернуть это состояние на каждое установленное устройство.
    serveTwoPageFeed(withTotalPages: false);
    final provider = signedIn();

    await provider.fetchNotifications(refresh: true);
    await provider.loadMore();

    expect(provider.notifications, hasLength(20));
    expect(provider.hasMore, isFalse);
    expect(feedRequests().map((r) => r.queryParameters['page']), [1],
        reason: 'вторая страница не запрошена');
    expect(provider.errorMessage, isNull,
        reason: 'ошибки нет — экран выглядит исправным');
  });
}
