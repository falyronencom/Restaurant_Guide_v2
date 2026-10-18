import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Старт вошедшего человека без сети.
///
/// Находка 18.10.2026 на телефоне Координатора: холодный старт в авиарежиме
/// у вошедшего открывал гостевой экран «Регистрация / Пропустить», как будто
/// он не входил. Провайдер на отказ сети при сверке сессии ставил «не вошёл»,
/// заставка уводила гостем.
///
/// Должно быть (бриф 18.10): без сети человек остаётся вошедшим; когда сеть
/// вернётся, всё работает без нового входа; гостевой экран — только если
/// сессии нет или сервер её отверг. «Нет сети» нельзя путать с «сеанс
/// отозван»: отозванный сеанс по-прежнему выводит из аккаунта.
///
/// Все тесты — поверх настоящих `AuthService()` и `ApiClient()`: подменены
/// только транспорт и защищённое хранилище. Решение «сессия мертва или сервер
/// молчит» принимается на границе транспорта и провайдера, и фейк сервиса,
/// бросающий готовую строку, эту границу бы спрятал. Отказы сети — ровно те,
/// что отдаёт адаптер dio 5.9 на телефоне: `SocketException` при соединении
/// (авиарежим) становится `DioException.connectionError`, а сбой TLS и обрыв
/// после соединения выходят из адаптера как есть и становятся
/// `DioExceptionType.unknown`.
///
/// Access-токены — той же формы, что выдаёт сервер (`backend/src/utils/jwt.js`:
/// `userId`, `iat`, `iatMs`); подпись приложение не проверяет и тест не
/// подделывает — она здесь заглушка.

const _profile = {'id': 'u-1', 'email': 'anna@example.com', 'name': 'Анна'};
const _profileB = {'id': 'u-b', 'email': 'boris@example.com', 'name': 'Борис'};

/// Профиль, как его пишет в хранилище эта сборка: JSON.
String _storedProfileJson([Map<String, dynamic> profile = _profile]) =>
    jsonEncode(profile);

/// Access-токен пользователя [userId], выданный в [issuedAt] (по умолчанию —
/// сейчас).
String _jwt({String userId = 'u-1', DateTime? issuedAt}) {
  String part(Map<String, dynamic> json) =>
      base64Url.encode(utf8.encode(jsonEncode(json))).replaceAll('=', '');
  final at = issuedAt ?? DateTime.now();
  return [
    part({'alg': 'HS256', 'typ': 'JWT'}),
    part({
      'userId': userId,
      'type': 'access',
      'iat': at.millisecondsSinceEpoch ~/ 1000,
      'iatMs': at.millisecondsSinceEpoch,
    }),
    'signature',
  ].join('.');
}

Never _noNetwork(RequestOptions options) => throw DioException.connectionError(
      requestOptions: options,
      reason: 'Failed host lookup: restaurantguidev2-production.up.railway.app',
      error: const SocketException('Failed host lookup'),
    );

ResponseBody _profileResponse(
        {Map<String, dynamic> profile = _profile, String? name}) =>
    jsonBody({
      'success': true,
      'data': {
        'user': {...profile, if (name != null) 'name': name},
      },
    });

ResponseBody _revoked() => jsonBody({
      'success': false,
      'message': 'Access token has been revoked. Please log in again.',
      'error': {'code': 'TOKEN_REVOKED'},
    }, status: 401);

ResponseBody _refreshRejected() => jsonBody({
      'success': false,
      'message': 'Refresh token has been revoked',
      'error': {'code': 'TOKEN_REVOKED'},
    }, status: 401);

/// Транспорт, чей ответ тест может придержать: сервер «молчит», пока тест
/// не отпустит [Completer].
class _HeldAdapter implements HttpClientAdapter {
  _HeldAdapter(this.respond);

  final Future<ResponseBody> Function(RequestOptions options) respond;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) =>
      respond(options);

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  var expired = 0;
  late StreamSubscription<void> expiredSub;

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
    expired = 0;
    expiredSub = SessionEvents.expired.listen((_) => expired++);
  });

  tearDown(() => expiredSub.cancel());

  /// Ждёт конца инициализации; предел — против зависания.
  Future<void> settled(AuthProvider auth) {
    if (!auth.isLoading) return Future.value();
    final done = Completer<void>();
    void listener() {
      if (!auth.isLoading && !done.isCompleted) done.complete();
    }

    auth.addListener(listener);
    return done.future
        .timeout(const Duration(seconds: 10),
            onTimeout: () => throw StateError('инициализация зависла'))
        .whenComplete(() => auth.removeListener(listener));
  }

  /// Ждёт условия, прокручивая очередь событий: обработчик возврата на экран
  /// ничего не возвращает. Предел оборотов заменяет таймаут.
  Future<void> until(bool Function() done, String what) async {
    for (var i = 0; i < 200; i++) {
      if (done()) return;
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    fail('не дождались: $what');
  }

  Future<AuthProvider> start() async {
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    await settled(auth);
    return auth;
  }

  group('Старт без сети (авиарежим)', () {
    test('вошедший остаётся вошедшим, со своим профилем; хранилище цело',
        () async {
      installWireStand(_noNetwork);
      final access = _jwt();
      final storage = installSecureStorageStand({
        'access_token': access,
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.authenticated,
          reason: 'нет сети — не повод делать вошедшего гостем');
      expect(auth.currentUser?.id, 'u-1');
      expect(auth.currentUser?.name, 'Анна',
          reason: 'профиль — последний, что подтверждал сервер');
      expect(storage['access_token'], access);
      expect(storage['refresh_token'], 'refresh-1');
      expect(expired, 0, reason: 'сессию никто не хоронил');
    });

    test('профиль записан прежней сборкой (не JSON): вошедший без имени',
        () async {
      // До 18.10.2026 профиль писался `Map.toString()`: «{id: u-1, …}».
      installWireStand(_noNetwork);
      final access = _jwt();
      final storage = installSecureStorageStand({
        'access_token': access,
        'refresh_token': 'refresh-1',
        'user_data': '{id: u-1, email: anna@example.com, name: Анна}',
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.authenticated);
      expect(auth.currentUser, isNull,
          reason: 'старую запись разобрать нельзя — профиль придёт со сверкой');
      expect(storage['access_token'], access);
    });

    test('сеть вернулась: возврат на экран сверяет сессию, профиль свежий, '
        'без нового входа', () async {
      var online = false;
      final wire = installWireStand((options) {
        if (!online) _noNetwork(options);
        if (options.uri.path == '/api/v1/auth/me') {
          return _profileResponse(name: 'Анна П.');
        }
        return jsonBody({'success': false}, status: 404);
      });
      final storage = installSecureStorageStand({
        'access_token': _jwt(),
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });
      final auth = await start();
      expect(auth.isAuthenticated, isTrue, reason: 'предпосылка: вошёл без сети');

      online = true;
      auth.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await until(() => auth.currentUser?.name == 'Анна П.',
          'профиль с сервера после возврата сети');

      expect(auth.status, AuthenticationStatus.authenticated);
      expect(
          jsonDecode(storage['user_data']!), containsPair('name', 'Анна П.'),
          reason: 'в хранилище — свежий профиль, в JSON');

      // Сверка состоялась — следующий возврат на экран сервер не тревожит.
      final before = wire.requests.length;
      auth.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(wire.requests.length, before);
    });

    test('сеть вернулась, а сеанс отозван: выход, хранилище пусто', () async {
      var online = false;
      installWireStand((options) {
        if (!online) _noNetwork(options);
        return options.uri.path.endsWith('/auth/refresh')
            ? _refreshRejected()
            : _revoked();
      });
      final storage = installSecureStorageStand({
        'access_token': _jwt(),
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });
      var accountResets = 0;
      AccountScope.register(() => accountResets++);
      final auth = await start();
      expect(auth.isAuthenticated, isTrue, reason: 'предпосылка: вошёл без сети');

      online = true;
      auth.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await until(() => !auth.isAuthenticated, 'выход по отказу сервера');

      expect(auth.status, AuthenticationStatus.unauthenticated);
      expect(auth.currentUser, isNull);
      expect(storage, isEmpty,
          reason: 'токены стёр транспорт, профиль — провайдер');
      expect(expired, 1);
      expect(accountResets, greaterThanOrEqualTo(1),
          reason: 'кэши аккаунта сброшены — следующий вход их не увидит');
    });
  });

  group('Сервер не ответил о сессии — сессия жива', () {
    test('503 окна деплоя на профиль: вошёл, токены целы', () async {
      installWireStand((options) => jsonBody({
            'success': false,
            'message': 'Service Unavailable',
          }, status: 503));
      final storage = installSecureStorageStand({
        'access_token': _jwt(),
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.authenticated);
      expect(auth.currentUser?.id, 'u-1');
      expect(storage['refresh_token'], 'refresh-1');
      expect(expired, 0);
    });

    test('обновление токена не дошло до сервера (502 на обновлении): вошёл, '
        'токены целы', () async {
      // Access-токен просрочен, сервер на месте, а обновление упирается в
      // 502 edge. Транспорт отдаёт отказ «Сервер временно недоступен» без
      // ответа — это не вердикт о сессии.
      installWireStand((options) => options.uri.path.endsWith('/auth/refresh')
          ? jsonBody({'success': false}, status: 502)
          : jsonBody({
              'success': false,
              'message': 'Access token has expired',
              'error': {'code': 'TOKEN_EXPIRED'},
            }, status: 401));
      final storage = installSecureStorageStand({
        'access_token': _jwt(),
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.authenticated);
      expect(auth.currentUser?.name, 'Анна');
      expect(storage['refresh_token'], 'refresh-1');
      expect(expired, 0);
    });

    // Сбой TLS (сеть с окном входа, неверное время на телефоне) и обрыв уже
    // после соединения dio выпускает из адаптера как есть — тип `unknown`.
    // До ревью 18.10.2026 такой старт по-прежнему вёл на «Регистрацию».
    for (final (what, error) in <(String, Object)>[
      ('обрыв после соединения',
          const HttpException('Connection closed before full header was '
              'received')),
      ('сбой TLS', const HandshakeException('Handshake error in client')),
    ]) {
      test('$what (dio: unknown): вошёл, токены целы', () async {
        installWireStand((options) => throw error);
        final access = _jwt();
        final storage = installSecureStorageStand({
          'access_token': access,
          'refresh_token': 'refresh-1',
          'user_data': _storedProfileJson(),
        });

        final auth = await start();

        expect(auth.status, AuthenticationStatus.authenticated);
        expect(auth.currentUser?.name, 'Анна');
        expect(storage['access_token'], access);
        expect(expired, 0);
      });
    }
  });

  group('Ответ сервера, который не «нет сети», — как прежде', () {
    test('404 на профиль: не вошёл, токены целы (возврат на экран проверит '
        'снова)', () async {
      // Граница: «сервер не ответил» — это отказ без ответа, 429 и 5xx.
      // Ответ 4xx — ответ по существу, и прежнее поведение для него не
      // меняется.
      installWireStand(
          (options) => jsonBody({'success': false}, status: 404));
      final access = _jwt();
      final storage = installSecureStorageStand({
        'access_token': access,
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.unauthenticated);
      expect(storage['access_token'], access);
      expect(storage['refresh_token'], 'refresh-1');
    });
  });

  group('Сессия старше срока refresh-токена (30 дней от выдачи пары)', () {
    test('31 день без сети: не вошёл, профиль не показан, токены целы',
        () async {
      // Сервер такую сессию уже не продлит (`authService.js`: 30 дней).
      // Токены не стираются: при неверных часах телефона это стоило бы
      // человеку входа — слово за сервером, когда появится связь.
      installWireStand(_noNetwork);
      final access =
          _jwt(issuedAt: DateTime.now().subtract(const Duration(days: 31)));
      final storage = installSecureStorageStand({
        'access_token': access,
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.unauthenticated);
      expect(auth.currentUser, isNull,
          reason: 'профиль мёртвой сессии без сети не показывается');
      expect(storage['access_token'], access);
      expect(storage['refresh_token'], 'refresh-1');
    });

    test('29 дней без сети: вошёл, как и со свежей', () async {
      installWireStand(_noNetwork);
      installSecureStorageStand({
        'access_token':
            _jwt(issuedAt: DateTime.now().subtract(const Duration(days: 29))),
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.authenticated);
      expect(auth.currentUser?.name, 'Анна');
    });
  });

  group('Профиль — только своей сессии', () {
    test('вход пишет профиль в JSON — его прочтёт старт без сети', () async {
      installWireStand((options) => options.uri.path == '/api/v1/auth/login'
          ? jsonBody({
              'success': true,
              'data': {
                'accessToken': _jwt(),
                'refreshToken': 'refresh-1',
                'user': _profile,
              },
            })
          : jsonBody({'success': false}, status: 404));
      final storage = installSecureStorageStand();
      final auth = await start();
      expect(auth.isAuthenticated, isFalse, reason: 'предпосылка: гость');

      expect(
          await auth.login(emailOrPhone: 'anna@example.com', password: 'x'),
          isTrue);

      expect(jsonDecode(storage['user_data']!), containsPair('id', 'u-1'),
          reason: 'до 18.10.2026 сюда писался Map.toString() — не JSON');
    });

    test('профиль, пришедший без сессии (ответ после выхода), не пишется',
        () async {
      installWireStand((options) => _profileResponse());
      final storage = installSecureStorageStand();

      final auth = await start();
      expect(auth.isAuthenticated, isFalse, reason: 'предпосылка: гость');
      // Ответ профиля, долетевший уже после выхода: токенов в хранилище нет.
      await auth.checkVerificationStatus();

      expect(storage.containsKey('user_data'), isFalse,
          reason: 'профиль вышедшего не должен оставаться на телефоне');
    });

    test('ответ профиля прежнего аккаунта при сессии другого не пишется',
        () async {
      // Сервер ответил на запрос, ушедший с токеном A, а в хранилище уже
      // сессия B: человек вышел и вошёл другим аккаунтом, пока ответ шёл.
      installWireStand((options) => _profileResponse());
      final storage = installSecureStorageStand({
        'access_token': _jwt(userId: 'u-b'),
        'refresh_token': 'refresh-b',
        'user_data': _storedProfileJson(_profileB),
      });

      await AuthService().getCurrentUser();

      expect(jsonDecode(storage['user_data']!), containsPair('id', 'u-b'));
    });

    test('чужой профиль в хранилище при старте без сети не подставляется',
        () async {
      // Сессия B, а в хранилище остался профиль A (запись, проскочившая
      // смену аккаунта): имя, почта и телефон A не должны показаться B.
      installWireStand(_noNetwork);
      installSecureStorageStand({
        'access_token': _jwt(userId: 'u-b'),
        'refresh_token': 'refresh-b',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.authenticated);
      expect(auth.currentUser, isNull,
          reason: 'профиль A к сессии B не привязывается');
    });

    test('вход другим аккаунтом, пока сервер молчит о прежнем: поздний ответ '
        'прежнего не подменяет вошедшего', () async {
      // Плохая связь: заставка уже увела на главный экран, сверка сессии A
      // ещё ждёт ответа, человек входит как B. Ответ про A приходит позже.
      final heldProfile = Completer<ResponseBody>();
      installWireStand((options) => jsonBody({'success': false}, status: 404));
      ApiClient().dio.httpClientAdapter = _HeldAdapter((options) {
        switch (options.uri.path) {
          case '/api/v1/auth/me':
            return heldProfile.future;
          case '/api/v1/auth/login':
            return Future.value(jsonBody({
              'success': true,
              'data': {
                'accessToken': _jwt(userId: 'u-b'),
                'refreshToken': 'refresh-b',
                'user': _profileB,
              },
            }));
        }
        return Future.value(jsonBody({'success': false}, status: 404));
      });
      final storage = installSecureStorageStand({
        'access_token': _jwt(),
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });
      final auth = AuthProvider();
      addTearDown(auth.dispose);
      await until(() => auth.isRestoringSession, 'сверка сессии A началась');

      expect(
          await auth.login(emailOrPhone: 'boris@example.com', password: 'x'),
          isTrue);
      expect(auth.currentUser?.id, 'u-b', reason: 'предпосылка: вошёл B');

      heldProfile.complete(_profileResponse()); // поздний ответ про A
      await until(() => !auth.isRestoringSession, 'сверка A закончилась');

      expect(auth.status, AuthenticationStatus.authenticated);
      expect(auth.currentUser?.id, 'u-b',
          reason: 'профиль A не должен подменить вошедшего B');
      expect(jsonDecode(storage['user_data']!), containsPair('id', 'u-b'),
          reason: 'и в хранилище — профиль B');
    });
  });

  group('Сервер отверг сессию — гость, как прежде', () {
    test('сеанс отозван при старте со связью: не вошёл, хранилище пусто',
        () async {
      installWireStand((options) => options.uri.path.endsWith('/auth/refresh')
          ? _refreshRejected()
          : _revoked());
      final storage = installSecureStorageStand({
        'access_token': _jwt(),
        'refresh_token': 'refresh-1',
        'user_data': _storedProfileJson(),
      });

      final auth = await start();

      expect(auth.status, AuthenticationStatus.unauthenticated);
      expect(auth.currentUser, isNull,
          reason: 'профиль из хранилища не подставляется вместо отказа');
      expect(storage, isEmpty);
    });
  });
}
