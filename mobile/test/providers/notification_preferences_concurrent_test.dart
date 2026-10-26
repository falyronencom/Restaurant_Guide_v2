import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/notification_preferences_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Настройки уведомлений: экран показывает то, что хранит сервер, при любых
/// сочетаниях удачных и неудачных переключений (сверка «Честность тестов
/// клиентов», 25.10.2026, Q-DP2).
///
/// Было: каждое переключение снимало все четыре флага и при отказе
/// возвращало все четыре. Гость выключал «Отзывы» и сразу «Акции»; запрос по
/// «Отзывам» срывался, по «Акциям» проходил — и откат «Отзывов» возвращал
/// «Акции» во «вкл.» из своего снимка. Сервер «Акции» выключил, push о них
/// больше не приходили, а экран показывал «вкл.» до перезапуска.
///
/// «Сервер» стенда хранит строку и пишет по полям, как
/// `backend/src/models/notificationPreferencesModel.js` (`COALESCE($n,
/// текущее)` по каждой колонке): неприсланные поля не трогаются. Ответы
/// управляемые — порядок их прихода задаёт тест.
const _reviews = 'reviews_push_enabled';
const _promotions = 'promotions_push_enabled';

void main() {
  setUp(AccountScope.debugReset);

  Map<String, bool> shown(NotificationPreferencesProvider p) => {
        'booking_push_enabled': p.bookingPushEnabled,
        _reviews: p.reviewsPushEnabled,
        _promotions: p.promotionsPushEnabled,
        'menu_push_enabled': p.menuPushEnabled,
      };

  Future<(NotificationPreferencesProvider, _GatedServer)> loaded() async {
    final server = _GatedServer();
    final provider = NotificationPreferencesProvider(apiClient: server);
    addTearDown(provider.dispose);
    await provider.fetchPreferences();
    return (provider, server);
  }

  group('два разных переключателя: A отказал, B прошёл', () {
    for (final bFirst in [false, true]) {
      final order = bFirst ? 'ответ B первым' : 'ответ A первым';
      test(order, () async {
        final (provider, server) = await loaded();

        final a = provider.updatePreferences(reviews: false);
        final b = provider.updatePreferences(promotions: false);
        if (bFirst) {
          server.succeed(_promotions);
          await b;
          server.fail(_reviews);
          await a;
        } else {
          server.fail(_reviews);
          await a;
          server.succeed(_promotions);
          await b;
        }

        expect(server.stored[_promotions], isFalse,
            reason: 'стенд: запрос B дошёл');
        expect(server.stored[_reviews], isTrue, reason: 'стенд: A не дошёл');
        expect(shown(provider), server.stored,
            reason: 'экран разошёлся с сервером: откат A вернул соседний B');
      });
    }
  });

  test('оба отказали, ответ A первым — экран как на сервере', () async {
    final (provider, server) = await loaded();

    final a = provider.updatePreferences(reviews: false);
    final b = provider.updatePreferences(promotions: false);
    server.fail(_reviews);
    await a;
    server.fail(_promotions);
    await b;

    expect(shown(provider), server.stored,
        reason: 'откат B вернул «Отзывы» к оптимистичному «выкл.» из своего '
            'снимка, хотя сервер их не менял');
  });

  test('A прошёл, B отказал — откатывается только B', () async {
    final (provider, server) = await loaded();

    final a = provider.updatePreferences(reviews: false);
    final b = provider.updatePreferences(promotions: false);
    server.fail(_promotions);
    await b;
    server.succeed(_reviews);
    await a;

    expect(server.stored[_reviews], isFalse);
    expect(shown(provider), server.stored);
  });

  test('отказ возвращает значение, прочитанное с сервера, а не умолчание',
      () async {
    final server = _GatedServer()..stored[_reviews] = false;
    final provider = NotificationPreferencesProvider(apiClient: server);
    addTearDown(provider.dispose);
    await provider.fetchPreferences();
    expect(provider.reviewsPushEnabled, isFalse, reason: 'предусловие');

    final on = provider.updatePreferences(reviews: true);
    server.fail(_reviews);
    await on;

    expect(shown(provider), server.stored,
        reason: 'откат вернул «вкл.» по умолчанию, а сервер хранит «выкл.»');
  });

  group('аккаунт сменился, пока запись в пути', () {
    // Переключатели прежнего аккаунта не должны ни вернуться откатом, ни
    // встать по его ответу на экран следующего (ревью Phase 3.5, Sonnet).
    for (final stored in [true, false]) {
      test(stored ? 'запись прошла' : 'запись отказала', () async {
        final (provider, server) = await loaded();

        final write = provider.updatePreferences(reviews: false);
        provider.resetAccountScope();
        var notified = 0;
        provider.addListener(() => notified++);
        if (stored) {
          server.succeed(_reviews);
        } else {
          server.fail(_reviews);
        }
        await write;

        expect(provider.reviewsPushEnabled, isTrue,
            reason: 'ответ прежнего аккаунта лёг на экран нового');
        expect(notified, 0);
      });
    }
  });

  group('один переключатель дважды подряд (выкл., затем вкл.)', () {
    test('первый отказал, второй прошёл — «вкл.», как на сервере', () async {
      final (provider, server) = await loaded();

      final off = provider.updatePreferences(reviews: false);
      final on = provider.updatePreferences(reviews: true);
      server.fail(_reviews);
      await off;
      expect(provider.reviewsPushEnabled, isTrue,
          reason: 'откат устаревшего запроса перебил более новое нажатие');
      server.succeed(_reviews);
      await on;

      expect(shown(provider), server.stored);
    });

    test('второй отказал раньше, чем пришёл успех первого — «выкл.», как на '
        'сервере', () async {
      // Найдено ревью Phase 3.5: откат второго ставил «вкл.», а поздний
      // успех первого уже никто не показывал — сервер хранил «выкл.».
      final (provider, server) = await loaded();

      final off = provider.updatePreferences(reviews: false);
      final on = provider.updatePreferences(reviews: true);
      server.fail(_reviews, newest: true);
      await on;
      server.succeed(_reviews);
      await off;

      expect(server.stored[_reviews], isFalse);
      expect(shown(provider), server.stored,
          reason: 'успех первого нажатия не дошёл до экрана');
    });

    test('первый прошёл, второй отказал — «выкл.», как на сервере', () async {
      final (provider, server) = await loaded();

      final off = provider.updatePreferences(reviews: false);
      final on = provider.updatePreferences(reviews: true);
      server.succeed(_reviews);
      await off;
      expect(provider.reviewsPushEnabled, isTrue,
          reason: 'ответ устаревшего запроса перебил более новое нажатие, '
              'которое ещё в пути');
      server.fail(_reviews);
      await on;

      expect(server.stored[_reviews], isFalse);
      expect(shown(provider), server.stored,
          reason: 'откат вернул значение, которое сервер уже переписал');
    });
  });

  group('экран', () {
    for (final bFirst in [false, true]) {
      final order = bFirst ? 'ответ «Акций» первым' : 'ответ «Отзывов» первым';
      testWidgets('«Отзывы» отказали, «Акции» прошли ($order) — переключатели '
          'как на сервере', (tester) async {
        final server = _GatedServer();
        final provider = NotificationPreferencesProvider(apiClient: server);
        addTearDown(provider.dispose);
        await tester.pumpWidget(
          ChangeNotifierProvider<NotificationPreferencesProvider>.value(
            value: provider,
            child: const MaterialApp(home: NotificationPreferencesScreen()),
          ),
        );
        await tester.pump();
        await tester.pump();

        Finder row(String title) => find.widgetWithText(SwitchListTile, title);
        bool on(String title) => tester.widget<SwitchListTile>(row(title)).value;

        await tester.tap(row('Отзывы и заведения'));
        await tester.pump();
        await tester.tap(row('Акции из избранного'));
        await tester.pump();
        expect(server.sentBodies, [
          {_reviews: false},
          {_promotions: false},
        ]);

        if (bFirst) {
          server.succeed(_promotions);
          await tester.pump();
          server.fail(_reviews);
        } else {
          server.fail(_reviews);
          await tester.pump();
          server.succeed(_promotions);
        }
        await tester.pumpAndSettle();

        expect(
          {
            'booking_push_enabled': on('Бронирование'),
            _reviews: on('Отзывы и заведения'),
            _promotions: on('Акции из избранного'),
            'menu_push_enabled': on('Меню'),
          },
          server.stored,
          reason: 'на сервере «Акции» выключены, на экране — нет',
        );
      });
    }
  });
}

/// «Сервер» настроек: хранит строку, на GET отдаёт её, каждый PUT держит до
/// решения теста и на успехе пишет присланные поля (по полям, как модель
/// сервера), отвечая всей строкой — `RETURNING *` контроллера.
class _GatedServer implements ApiClient {
  final Map<String, bool> stored = {
    'booking_push_enabled': true,
    _reviews: true,
    _promotions: true,
    'menu_push_enabled': true,
  };
  final List<Map<String, dynamic>> sentBodies = [];
  final List<(Map<String, dynamic>, Completer<bool>)> _pending = [];

  @override
  Future<Response> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async =>
      Response(
        requestOptions: RequestOptions(path: path),
        statusCode: 200,
        data: <String, dynamic>{'success': true, 'data': {...stored}},
      );

  @override
  Future<Response> put(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    final body = Map<String, dynamic>.from(data as Map);
    sentBodies.add(body);
    final gate = Completer<bool>();
    _pending.add((body, gate));
    if (!await gate.future) {
      throw DioException.connectionError(
        requestOptions: RequestOptions(path: path),
        reason: 'обрыв связи (стенд)',
      );
    }
    body.forEach((key, value) => stored[key] = value as bool);
    return Response(
      requestOptions: RequestOptions(path: path),
      statusCode: 200,
      data: <String, dynamic>{'success': true, 'data': {...stored}},
    );
  }

  /// Ещё не решённый запрос по полю [key]: самый ранний или, при
  /// [newest], самый поздний — сеть вправе ответить на него первым.
  Completer<bool> _gateFor(String key, bool newest) {
    final index = newest
        ? _pending.lastIndexWhere((p) => p.$1.containsKey(key))
        : _pending.indexWhere((p) => p.$1.containsKey(key));
    return _pending.removeAt(index).$2;
  }

  void succeed(String key, {bool newest = false}) =>
      _gateFor(key, newest).complete(true);
  void fail(String key, {bool newest = false}) =>
      _gateFor(key, newest).complete(false);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
