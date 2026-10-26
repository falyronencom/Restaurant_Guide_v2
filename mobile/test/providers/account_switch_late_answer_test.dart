import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
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

  // У этих двух провайдеров приём поколения стоит, но не проверялся ничем.
  // Каждой паре — образец «без смены записывается»: иначе «не записалось»
  // нельзя отличить от «не разобралось».
  group('BookingSettingsProvider', () {
    const path = '/api/v1/partner/booking-settings/est-1';
    final settings = <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'id': 'bs-1',
        'establishment_id': 'est-1',
        'is_enabled': true,
        'max_guests_per_booking': 12,
        'confirmation_timeout_hours': 6,
        'max_days_ahead': 14,
        'min_hours_before': 3,
        'created_at': '2026-04-01T09:00:00.000Z',
        'updated_at': '2026-04-01T09:00:00.000Z',
      },
    };

    test('настройки брони прежнего партнёра, пришедшие после смены, не '
        'записываются', () async {
      final provider = BookingSettingsProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadSettings('est-1');
      await pumpEventQueue();
      expect(adapter.paths, [path]);
      AccountScope.resetAll();
      adapter.release(path, settings);
      await inFlight;

      expect(provider.settings, isNull);
    });

    test('без смены аккаунта настройки записываются — образец разбирается',
        () async {
      final provider = BookingSettingsProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadSettings('est-1');
      await pumpEventQueue();
      adapter.release(path, settings);
      await inFlight;

      expect(provider.settings?.maxGuestsPerBooking, 12);
    });

    test('настройки, загруженные до выхода, сброс стирает', () async {
      final provider = BookingSettingsProvider();
      addTearDown(provider.dispose);
      adapter.release(path, settings);
      await provider.loadSettings('est-1');
      expect(provider.settings?.maxGuestsPerBooking, 12,
          reason: 'предусловие: настройки прежнего партнёра загружены');

      AccountScope.resetAll();

      expect(provider.settings, isNull,
          reason: 'настройки брони прежнего партнёра пережили выход');
    });

  });

  group('PartnerDashboardProvider', () {
    const path = '/api/v1/partner/establishments';
    final establishments = <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'establishments': [
          <String, dynamic>{'id': 'est-prev', 'name': 'Кухмістр', 'status': 'active'},
        ],
      },
    };

    test('заведения прежнего партнёра, пришедшие после смены, не записываются',
        () async {
      final provider = PartnerDashboardProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadEstablishments();
      await pumpEventQueue();
      expect(adapter.paths, [path]);
      AccountScope.resetAll();
      adapter.release(path, establishments);
      await inFlight;

      expect(provider.establishments, isEmpty);
      expect(provider.isInitialized, isFalse,
          reason: 'кабинет нового партнёра обязан загрузиться заново');
    });

    test('без смены аккаунта заведения записываются — образец разбирается',
        () async {
      final provider = PartnerDashboardProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadEstablishments();
      await pumpEventQueue();
      adapter.release(path, establishments);
      await inFlight;

      expect(provider.establishments.map((e) => e.id), ['est-prev']);
    });

    // Ответы карточки и статистики — литералами по форме, которую читает
    // `PartnerService` (`data.establishment`, `data.establishments[]`,
    // `data.*_trend`); числа обзора, тренда и карточки разные — по ним
    // видно, чей ответ лёг. Звонков «всего» — 0, как всегда отдаёт сервер
    // (`backend/src/services/partnerAnalyticsService.js`).
    const estId = 'est-prev';
    const detailsPath = '/api/v1/partner/establishments/$estId';
    const overviewPath = '/api/v1/partner/analytics/overview';
    const trendsPath = '/api/v1/partner/analytics/trends';
    final details = <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'establishment': <String, dynamic>{
          'id': estId,
          'name': 'Кухмістр',
          'status': 'active',
          'city': 'Минск',
          'address': 'пр. Независимости, 43',
          'view_count': 512,
        },
      },
    };
    final overview = <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'establishments': [
          <String, dynamic>{
            'establishment_id': estId,
            'establishment_name': 'Кухмістр',
            'period': <String, dynamic>{'aggregation': 'day'},
            'views': <String, dynamic>{'total': 410, 'in_period': 37},
            'favorites': <String, dynamic>{'total': 12, 'in_period': 3},
            'calls': <String, dynamic>{'total': 0, 'in_period': 2},
            'reviews': <String, dynamic>{
              'total': 5,
              'in_period': 1,
              'average_rating': 4.4,
            },
          },
        ],
      },
    };
    final trends = <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'views_trend': [
          <String, dynamic>{'date': '2026-10-10', 'count': 21},
        ],
        'favorites_trend': <dynamic>[],
        'calls_trend': <dynamic>[],
        'reviews_trend': <dynamic>[],
        'aggregation': 'day',
      },
    };

    test('кабинет, загруженный до выхода, сброс стирает целиком: заведения, '
        'открытая карточка, статистика', () async {
      // Сквозная проверка реестра (`account_scope_guard_test`) доводит сброс
      // до состояния одного провайдера — избранного. Здесь — кабинет
      // партнёра: следующий вошедший не видит ни его карточек со статусами
      // модерации, ни открытой карточки, ни цифр статистики.
      final provider = PartnerDashboardProvider();
      addTearDown(provider.dispose);
      adapter.release(path, establishments);
      adapter.release(detailsPath, details);
      adapter.release(overviewPath, overview);
      adapter.release(trendsPath, trends);

      await provider.loadEstablishments();
      await provider.loadEstablishmentDetails(estId);
      await provider.fetchAnalytics(estId, '30d');

      // Страж фикстуры: до сброса всё заполнено, а период — не умолчание,
      // иначе проверка ниже ничего не докажет.
      expect(provider.establishments.map((e) => e.id), [estId]);
      expect(provider.selectedEstablishment?.id, estId);
      expect(provider.analyticsOverview?.views.inPeriod, 37);
      expect(provider.analyticsTrends?.viewsTrend.single.count, 21);
      expect(provider.analyticsPeriod, '30d');

      AccountScope.resetAll();

      expect(provider.establishments, isEmpty,
          reason: 'карточки прежнего партнёра пережили выход');
      expect(provider.selectedEstablishment, isNull,
          reason: 'открытая карточка прежнего партнёра пережила выход');
      expect(provider.analyticsOverview, isNull,
          reason: 'цифры статистики прежнего партнёра пережили выход');
      expect(provider.analyticsTrends, isNull);
      expect(provider.analyticsPeriod, '7d',
          reason: 'новый партнёр открывает статистику с периода по умолчанию');
      expect(provider.isInitialized, isFalse);
    });

    test('статистика прежнего партнёра, пришедшая после смены, не '
        'записывается', () async {
      final provider = PartnerDashboardProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.fetchAnalytics(estId, '30d');
      await pumpEventQueue();
      expect(adapter.paths, [overviewPath]);
      AccountScope.resetAll();
      // Отпускаются оба ответа: и обзор, и тренды — иначе код, не
      // отбросивший обзор, повис бы на трендах, и тест висел бы вместо того,
      // чтобы покраснеть.
      adapter.release(overviewPath, overview);
      adapter.release(trendsPath, trends);
      await inFlight;

      expect(provider.analyticsOverview, isNull,
          reason: 'обзор, запрошенный прежним партнёром, отброшен');
      expect(provider.analyticsTrends, isNull);
    });

    test('тренды прежнего партнёра, пришедшие после смены, не записываются',
        () async {
      // Вторая половина статистики: обзор пришёл ещё до выхода, смена —
      // пока идёт запрос трендов. У этого ответа своя проверка поколения.
      final provider = PartnerDashboardProvider();
      addTearDown(provider.dispose);
      adapter.release(overviewPath, overview);

      final inFlight = provider.fetchAnalytics(estId, '30d');
      await pumpEventQueue();
      expect(adapter.paths, [overviewPath, trendsPath],
          reason: 'предусловие: обзор принят, тренды в пути');
      AccountScope.resetAll();
      adapter.release(trendsPath, trends);
      await inFlight;

      expect(provider.analyticsTrends, isNull,
          reason: 'тренды, запрошенные прежним партнёром, отброшены');
    });

    test('без смены аккаунта статистика записывается — образец разбирается',
        () async {
      final provider = PartnerDashboardProvider();
      addTearDown(provider.dispose);
      adapter.release(overviewPath, overview);
      adapter.release(trendsPath, trends);

      await provider.fetchAnalytics(estId, '30d');

      expect(provider.analyticsOverview?.views.inPeriod, 37);
      expect(provider.analyticsTrends?.viewsTrend.single.count, 21);
    });

    test('карточка прежнего партнёра, пришедшая после смены, не записывается',
        () async {
      final provider = PartnerDashboardProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.loadEstablishmentDetails(estId);
      await pumpEventQueue();
      expect(adapter.paths, [detailsPath]);
      AccountScope.resetAll();
      adapter.release(detailsPath, details);
      await inFlight;

      expect(provider.selectedEstablishment, isNull);
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

    test('акции, загруженные до выхода, сброс стирает', () async {
      final provider = PromotionProvider();
      addTearDown(provider.dispose);
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
      await provider.fetchPromotions('est-1');
      expect(provider.promotions.map((p) => p.id), ['p-1'],
          reason: 'предусловие: акции прежнего партнёра загружены');

      AccountScope.resetAll();

      expect(provider.promotions, isEmpty,
          reason: 'акции прежнего партнёра пережили выход');
    });
  });

  group('NotificationPreferencesProvider', () {
    const path = '/api/v1/notifications/preferences';

    /// Переключатели прежнего аккаунта: все четыре выключены — умолчание
    /// сервера и провайдера «включено», так что запись видна по каждому.
    final previousAccountPrefs = <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'booking_push_enabled': false,
        'reviews_push_enabled': false,
        'promotions_push_enabled': false,
        'menu_push_enabled': false,
      },
    };

    List<bool> toggles(NotificationPreferencesProvider p) => [
          p.bookingPushEnabled,
          p.reviewsPushEnabled,
          p.promotionsPushEnabled,
          p.menuPushEnabled,
        ];

    test('переключатели прежнего аккаунта, пришедшие после смены, не '
        'записываются, и новый аккаунт перечитывает свои', () async {
      final provider = NotificationPreferencesProvider();
      addTearDown(provider.dispose);

      final inFlight = provider.fetchPreferences();
      await pumpEventQueue();
      expect(adapter.paths, [path]);

      AccountScope.resetAll();
      adapter.release(path, previousAccountPrefs);
      await inFlight;

      expect(toggles(provider), [true, true, true, true],
          reason: 'ответ, отправленный от прежнего аккаунта, отброшен');

      // Поздний ответ не отметил настройки загруженными: экран нового
      // аккаунта запрашивает их заново.
      await provider.ensureLoaded();
      expect(adapter.paths, [path, path],
          reason: 'новый аккаунт не перечитал свои переключатели');
    });

    test('без смены аккаунта переключатели записываются — образец '
        'разбирается', () async {
      final provider = NotificationPreferencesProvider();
      addTearDown(provider.dispose);
      adapter.release(path, previousAccountPrefs);

      await provider.fetchPreferences();

      expect(toggles(provider), [false, false, false, false]);
    });

    test('загруженные до выхода переключатели сброс возвращает к умолчанию — '
        'все четыре', () async {
      final provider = NotificationPreferencesProvider();
      addTearDown(provider.dispose);
      adapter.release(path, previousAccountPrefs);
      await provider.fetchPreferences();
      expect(toggles(provider), [false, false, false, false],
          reason: 'предусловие: загружены значения прежнего аккаунта');

      AccountScope.resetAll();

      expect(toggles(provider), [true, true, true, true]);
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
