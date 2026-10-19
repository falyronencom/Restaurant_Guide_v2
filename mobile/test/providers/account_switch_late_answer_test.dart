import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/notification_service.dart';

import '../support/wire_stand.dart';

/// Запоздавший ответ сервера не показывает данные прежнего аккаунта
/// (пакет 1 находок критиков, пункт 4 — Codex C2).
///
/// Сброс по смене аккаунта (реестр `AccountScope`) очищает состояние
/// провайдеров — но запрос, отправленный ещё от прежнего аккаунта, живёт
/// дальше и, вернувшись, записывал свой ответ поверх пустого состояния:
/// экран нового аккаунта показывал брони с именами и телефонами гостей
/// прежнего. Приём поколения запроса стоял только в
/// `PartnerDashboardProvider`; здесь он закреплён за остальными.
///
/// Транспорт подставной и «с воротами»: ответ выдаётся, когда тест его
/// отпустит — так смена аккаунта вставляется между запросом и ответом.
class _GatedAdapter implements HttpClientAdapter {
  final Map<String, Completer<ResponseBody>> gates = {};
  final List<String> paths = [];

  /// Отпустить ответ на запрос по [path]. Ворота создаются и здесь: ответ,
  /// отпущенный раньше, чем запрос дошёл до транспорта (виджет-тест без
  /// прокачки очереди), транспорт застанет уже готовым.
  void release(String path, Map<String, dynamic> body) => gates
      .putIfAbsent(path, Completer<ResponseBody>.new)
      .complete(jsonBody(body));

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    paths.add(options.uri.path);
    return gates
        .putIfAbsent(options.uri.path, Completer<ResponseBody>.new)
        .future;
  }

  @override
  void close({bool force = false}) {}
}

/// Служба уведомлений «с воротами» — провайдер принимает её через конструктор.
class _GatedNotificationService implements NotificationService {
  final Completer<Map<String, dynamic>> listGate = Completer();
  final Completer<int> countGate = Completer();

  @override
  Future<Map<String, dynamic>> getNotifications({
    int page = 1,
    int limit = 20,
    bool? isRead,
    String? category,
  }) =>
      listGate.future;

  @override
  Future<int> getUnreadCount() => countGate.future;

  @override
  Future<bool> markAsRead(String notificationId) async => true;

  /// Ворота «прочитать все». `null` — ответ сразу и успешный.
  Completer<bool>? markAllGate;

  @override
  Future<bool> markAllAsRead() => markAllGate?.future ?? Future.value(true);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Map<String, dynamic> _bookingJson(String id, {String status = 'confirmed'}) =>
    <String, dynamic>{
      'id': id,
      'establishment_id': 'est-1',
      'user_id': 'previous-user',
      'booking_date': '2026-10-10',
      'booking_time': '19:00',
      'guest_count': 2,
      'contact_phone': '+375291234567',
      'status': status,
      'expires_at': '2026-10-10T19:00:00.000Z',
      'created_at': '2026-10-01T10:00:00.000Z',
    };

NotificationModel _notification(String id) => NotificationModel(
      id: id,
      userId: 'previous-user',
      type: NotificationType.bookingConfirmed,
      title: 'Бронь подтверждена',
      isRead: false,
      createdAt: DateTime.utc(2026, 10, 1, 10),
    );

void main() {
  late _GatedAdapter adapter;

  setUp(() {
    AccountScope.debugReset();
    // Канал хранилища и восстановление транспорта — как у обычного стенда;
    // поверх него ставятся ворота.
    installWireStand((_) => jsonBody(<String, dynamic>{}), accessToken: 'tok');
    adapter = _GatedAdapter();
    ApiClient().dio.httpClientAdapter = adapter;
  });

  group('BookingProvider', () {
    test('брони прежнего аккаунта, пришедшие после смены, не записываются',
        () async {
      final provider = BookingProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadUserBookings();
      await pumpEventQueue();
      expect(adapter.paths, ['/api/v1/bookings/my']);

      // Смена аккаунта — пока ответ прежнего ещё в пути.
      AccountScope.resetAll();

      adapter.release('/api/v1/bookings/my', <String, dynamic>{
        'success': true,
        'data': [_bookingJson('b-1'), _bookingJson('b-2')],
      });
      await inFlight;

      expect(provider.userBookings, isEmpty,
          reason: 'ответ, отправленный от прежнего аккаунта, отброшен');
      expect(provider.isLoading, isFalse);
      expect(provider.error, isNull);
    });

    test('брони партнёра: тот же приём для списка заведения', () async {
      final provider = BookingProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadPartnerBookings('est-1');
      await pumpEventQueue();
      expect(adapter.paths, ['/api/v1/partner/bookings/est-1']);
      AccountScope.resetAll();
      adapter.release('/api/v1/partner/bookings/est-1', <String, dynamic>{
        'success': true,
        'data': {
          'items': [_bookingJson('b-3')],
        },
      });
      await inFlight;

      expect(provider.confirmedBookings, isEmpty);
      expect(provider.pendingCount, 0);
    });

    test('без смены аккаунта ответ записывается как прежде', () async {
      final provider = BookingProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadUserBookings();
      await pumpEventQueue();
      adapter.release('/api/v1/bookings/my', <String, dynamic>{
        'success': true,
        'data': [_bookingJson('b-1')],
      });
      await inFlight;

      expect(provider.userBookings.map((b) => b.id), ['b-1']);
      expect(provider.isLoading, isFalse);
    });

    test('брони, уже загруженные до выхода, сброс стирает — все четыре списка',
        () async {
      // Тесты выше начинают с пустых списков, поэтому не видят, чистит ли
      // сброс то, что УЖЕ лежит в памяти, — гостей и телефоны прежнего
      // аккаунта. Ради этого сброс и заведён.
      final provider = BookingProvider();
      addTearDown(provider.dispose);

      final partner = provider.loadPartnerBookings('est-1');
      await pumpEventQueue();
      adapter.release('/api/v1/partner/bookings/est-1', <String, dynamic>{
        'success': true,
        'data': {
          'items': [
            _bookingJson('b-new', status: 'pending'),
            _bookingJson('b-confirmed'),
            _bookingJson('b-done', status: 'completed'),
          ],
        },
      });
      await partner;
      final mine = provider.loadUserBookings();
      await pumpEventQueue();
      adapter.release('/api/v1/bookings/my', <String, dynamic>{
        'success': true,
        'data': [_bookingJson('b-mine')],
      });
      await mine;
      expect(
        <int>[
          provider.pendingBookings.length,
          provider.confirmedBookings.length,
          provider.historyBookings.length,
          provider.userBookings.length,
        ],
        <int>[1, 1, 1, 1],
        reason: 'предпосылка: все четыре списка заполнены',
      );

      AccountScope.resetAll();

      expect(provider.pendingBookings, isEmpty);
      expect(provider.confirmedBookings, isEmpty);
      expect(provider.historyBookings, isEmpty);
      expect(provider.userBookings, isEmpty);
    });
  });

  group('NotificationProvider', () {
    test('список и бейдж прежнего аккаунта, пришедшие после выхода, не показываются',
        () async {
      final service = _GatedNotificationService();
      final provider = NotificationProvider(service: service);
      addTearDown(provider.dispose);

      provider.startPolling(); // запускает fetchUnreadCount, ответ — за воротами
      final list = provider.fetchNotifications(refresh: true);
      await pumpEventQueue();

      // Выход из аккаунта: stopPolling — зарегистрированный сброс.
      AccountScope.resetAll();

      service.countGate.complete(7);
      service.listGate.complete(<String, dynamic>{
        'items': <NotificationModel>[_notification('n-1')],
        'pagination': <String, dynamic>{'totalPages': 1},
      });
      await list;
      await pumpEventQueue();

      expect(provider.notifications, isEmpty);
      expect(provider.unreadCount, 0);
      expect(provider.isLoading, isFalse);
    });

    test('без выхода список и бейдж записываются — образец разбирается', () async {
      final service = _GatedNotificationService();
      final provider = NotificationProvider(service: service);
      addTearDown(provider.dispose);

      provider.startPolling();
      final list = provider.fetchNotifications(refresh: true);
      await pumpEventQueue();

      service.countGate.complete(7);
      service.listGate.complete(<String, dynamic>{
        'items': <NotificationModel>[_notification('n-1')],
        'pagination': <String, dynamic>{'totalPages': 1},
      });
      await list;
      await pumpEventQueue();

      expect(provider.notifications.map((n) => n.id), ['n-1']);
      expect(provider.unreadCount, 7);
      expect(provider.isLoading, isFalse);
    });

    test('«прочитать все» прежнего аккаунта, отказавшее после выхода, не '
        'возвращает его уведомления', () async {
      // Тесты выше видят только поздние УСПЕХИ. Поздний отказ опаснее:
      // откат кладёт на место сохранённый список — список прежнего аккаунта.
      final service = _GatedNotificationService()
        ..markAllGate = Completer<bool>();
      final provider = NotificationProvider(service: service);
      addTearDown(provider.dispose);

      provider.startPolling();
      final list = provider.fetchNotifications(refresh: true);
      service.countGate.complete(7);
      service.listGate.complete(<String, dynamic>{
        'items': <NotificationModel>[_notification('n-1')],
        'pagination': <String, dynamic>{'totalPages': 1},
      });
      await list;
      await pumpEventQueue();
      expect(provider.notifications.map((n) => n.id), ['n-1'],
          reason: 'предпосылка: список прежнего аккаунта на экране');
      expect(provider.unreadCount, 7, reason: 'предпосылка');

      final marking = provider.markAllAsRead();
      AccountScope.resetAll(); // выход, пока сервер отвечает
      service.markAllGate!.completeError(Exception('нет сети'));
      await marking;

      expect(provider.notifications, isEmpty);
      expect(provider.unreadCount, 0);
    });
  });

  group('PromotionProvider', () {
    test('акции прежнего партнёра, пришедшие после смены, не записываются',
        () async {
      final provider = PromotionProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.fetchPromotions('est-1');
      await pumpEventQueue();
      AccountScope.resetAll();
      adapter.release(
        '/api/v1/partner/promotions/establishment/est-1',
        <String, dynamic>{
          'success': true,
          'data': [
            <String, dynamic>{
              'id': 'p-1',
              'establishment_id': 'est-1',
              'title': 'Скидка',
              'status': 'active',
              'valid_from': '2026-10-01',
              'created_at': '2026-10-01T10:00:00.000Z',
            },
          ],
        },
      );
      await inFlight;

      expect(provider.promotions, isEmpty);
      expect(provider.isLoading, isFalse);
    });

    test('без смены аккаунта акция записывается — образец разбирается', () async {
      final provider = PromotionProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.fetchPromotions('est-1');
      await pumpEventQueue();
      adapter.release(
        '/api/v1/partner/promotions/establishment/est-1',
        <String, dynamic>{
          'success': true,
          'data': [
            <String, dynamic>{
              'id': 'p-1',
              'establishment_id': 'est-1',
              'title': 'Скидка',
              'status': 'active',
              'valid_from': '2026-10-01',
              'created_at': '2026-10-01T10:00:00.000Z',
            },
          ],
        },
      );
      await inFlight;

      expect(provider.promotions.map((p) => p.id), ['p-1']);
      expect(provider.error, isNull);
    });
  });

  testWidgets('экран броней после смены аккаунта остаётся пустым', (tester) async {
    final provider = BookingProvider();
    addTearDown(provider.dispose);

    await tester.pumpWidget(MaterialApp(
      home: ListenableBuilder(
        listenable: provider,
        builder: (_, __) => Text('Броней: ${provider.userBookings.length}'),
      ),
    ));

    // Запрос идёт через настоящий ApiClient — настоящая асинхронность,
    // поэтому runAsync; смена аккаунта — между запросом и ответом.
    await tester.runAsync(() async {
      final inFlight = provider.loadUserBookings();
      await pumpEventQueue();
      AccountScope.resetAll();
      adapter.release('/api/v1/bookings/my', <String, dynamic>{
        'success': true,
        'data': [_bookingJson('b-1'), _bookingJson('b-2')],
      });
      await inFlight;
    });
    await tester.pump();

    expect(find.text('Броней: 0'), findsOneWidget);
  });
}
