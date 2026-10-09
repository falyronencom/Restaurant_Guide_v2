import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/auth_response.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Вход через Яндекс: ответ браузера уходит на сервер, только когда
/// приложение снова на экране, и не теряется на мгновенном отказе сети.
///
/// Браузер отдаёт ответ Яндекса, пока поверх приложения ещё его вкладка. При
/// включённом энергосбережении Android закрывает сеть приложениям, которых
/// нет на экране, и запрос, отправленный сразу, падал `Failed host lookup`
/// (A72, 08.10.2026, три попытки подряд). Теперь на Android запрос ждёт
/// возврата приложения на экран — с пределом в минуту, чтобы вход не завис,
/// если признак не придёт, — а быстрый отказ соединения повторяет ещё дважды.
/// Не помогло — человек видит, что делать. iPhone не ждёт и не повторяет:
/// там окно входа закрывает система, и вход остаётся прежним.
///
/// Транспорт подставной — на синглтоне `ApiClient`, через который ходит
/// `AuthService`; хранилище — карта в памяти. Время ненастоящее: `pump`
/// двигает часы теста, поэтому минута ожидания проходит мгновенно.
void main() {
  const callback = 'restaurantguide://auth/yandex'
      '#access_token=ya-token&token_type=bearer&expires_in=31536000';

  late StubAdapter adapter;
  late Map<String, String> storage;

  /// Что отвечает «сервер»; по умолчанию — успешный вход.
  late ResponseBody Function(RequestOptions options) respond;

  /// Ответ `POST /api/v1/auth/oauth` — форма `authController.oauthLogin`.
  Map<String, dynamic> oauthOk() => <String, dynamic>{
        'success': true,
        'data': <String, dynamic>{
          'user': <String, dynamic>{
            'id': 'u-ya',
            'email': 'guest@yandex.ru',
            'phone': null,
            'name': 'Гость',
            'role': 'user',
            'authMethod': 'yandex',
          },
          'accessToken': 'access-1',
          'refreshToken': 'refresh-1',
          'tokenType': 'Bearer',
          'expiresIn': 900,
        },
      };

  /// Отказ соединения — как у телефона, которому Android закрыл сеть.
  Never noConnection(RequestOptions options) =>
      throw DioException.connectionError(
        requestOptions: options,
        reason: "Failed host lookup: 'restaurantguidev2-production.up.railway.app'",
      );

  setUp(() {
    respond = (_) => jsonBody(oauthOk());
    adapter = installWireStand((options) => respond(options));
    // После стенда провода: последний мок канала хранилища побеждает.
    storage = installSecureStorageStand();
  });

  /// Токены Яндекса, ушедшие на сервер, по порядку.
  List<String> tokensSent() => adapter.requests
      .where((r) => r.uri.path == '/api/v1/auth/oauth')
      .map((r) => (r.data as Map)['token'] as String)
      .toList();

  /// Перевод приложения в [state]; после теста оно снова на экране — иначе
  /// следующий тест начнётся «в фоне».
  void setLifecycle(WidgetTester tester, AppLifecycleState state) {
    tester.binding.handleAppLifecycleStateChanged(state);
    addTearDown(() => tester.binding
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed));
  }

  /// Итог входа как значение: ответ или ошибка, `null` — ещё не завершён.
  Object? outcome;
  void signIn() {
    outcome = null;
    AuthService().completeYandexSignIn(callback).then<void>(
          (AuthResponse r) => outcome = r,
          onError: (Object e) => outcome = e,
        );
  }

  // Ожидание короче секунды проверяется паузой в секунду, а не нулём: запрос
  // проходит через таймеры транспорта, а часы теста двигает только `pump` с
  // длительностью. До предела ожидания (минута) отсюда далеко — «сразу» от
  // «ждёт» отличается надёжно.
  const instant = Duration(seconds: 1);

  group('Ожидание экрана', () {
    testWidgets(
        'Android: ответ, пришедший, пока приложение не на экране, уходит на '
        'сервер после возврата на экран', (tester) async {
      setLifecycle(tester, AppLifecycleState.paused);

      signIn();
      await tester.pump(const Duration(seconds: 30));

      expect(adapter.requests, isEmpty,
          reason: 'приложение не на экране — при энергосбережении сеть ему '
              'закрыта, запрос упал бы `Failed host lookup`');
      expect(outcome, isNull);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump(instant);

      expect(tokensSent(), ['ya-token'],
          reason: 'после возврата на экран ответ Яндекса уходит ровно один раз');
      expect(outcome, isA<AuthResponse>());
      expect((outcome as AuthResponse).user.id, 'u-ya');
      expect(storage['access_token'], 'access-1');
      expect(storage['refresh_token'], 'refresh-1');
    });

    testWidgets('Android: приложение уже на экране — ответ уходит сразу',
        (tester) async {
      setLifecycle(tester, AppLifecycleState.resumed);

      signIn();
      await tester.pump(instant);

      expect(tokensSent(), ['ya-token'],
          reason: 'ждать нечего: приложение на экране, сеть ему открыта');
      expect(outcome, isA<AuthResponse>());
    });

    testWidgets(
        'Android: признак возврата так и не пришёл — ответ уходит через '
        'минуту, как до правки', (tester) async {
      setLifecycle(tester, AppLifecycleState.paused);

      signIn();
      await tester.pump(const Duration(seconds: 59));
      expect(adapter.requests, isEmpty, reason: 'минута ещё не прошла');

      await tester.pump(const Duration(seconds: 2));
      expect(tokensSent(), ['ya-token'],
          reason: 'ожидание ограничено: без предела вход висел бы вечно');
      expect(outcome, isA<AuthResponse>());
    });

    testWidgets(
        'iPhone: ответ уходит сразу — окно входа Apple закрывается само',
        (tester) async {
      setLifecycle(tester, AppLifecycleState.paused);

      signIn();
      await tester.pump(instant);

      expect(tokensSent(), ['ya-token'],
          reason: 'на iPhone вход прежний: без ожидания экрана');
      expect(outcome, isA<AuthResponse>());
    }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
  });

  group('Тихие повторы при отказе соединения', () {
    testWidgets('Android: сеть открылась не сразу — третья попытка входит',
        (tester) async {
      setLifecycle(tester, AppLifecycleState.resumed);
      var calls = 0;
      respond = (options) =>
          ++calls <= 2 ? noConnection(options) : jsonBody(oauthOk());

      signIn();
      await tester.pump(const Duration(seconds: 5));

      expect(tokensSent(), ['ya-token', 'ya-token', 'ya-token'],
          reason: 'два отказа соединения — два тихих повтора тем же ответом');
      expect(outcome, isA<AuthResponse>(),
          reason: 'человек ошибки не видит: третья попытка вошла');
      expect(storage['access_token'], 'access-1');
    });

    testWidgets(
        'Android: сети нет — три попытки за ~3 с, затем отказ соединения',
        (tester) async {
      setLifecycle(tester, AppLifecycleState.resumed);
      respond = noConnection;

      signIn();
      await tester.pump(const Duration(seconds: 2));
      expect(outcome, isNull, reason: 'повторы ещё идут');

      await tester.pump(const Duration(seconds: 2));
      expect(tokensSent(), hasLength(3),
          reason: 'попытка и два повтора — не больше');
      expect(outcome, isA<DioException>());
      expect((outcome as DioException).type, DioExceptionType.connectionError,
          reason: 'наверх уходит отказ соединения — по нему провайдер '
              'выбирает текст «нет связи»');

      await tester.pump(const Duration(seconds: 30));
      expect(tokensSent(), hasLength(3), reason: 'повторы не продолжаются');
    });

    testWidgets('Android: ответ сервера по существу не повторяется',
        (tester) async {
      setLifecycle(tester, AppLifecycleState.resumed);
      respond = (_) => jsonBody(<String, dynamic>{
            'success': false,
            'error': <String, dynamic>{
              'code': 'INVALID_TOKEN',
              'message': 'Invalid or expired OAuth token',
            },
          }, status: 401);

      signIn();
      await tester.pump(const Duration(seconds: 5));

      expect(tokensSent(), ['ya-token'],
          reason: '401 — отказ по существу, повтор дал бы тот же ответ');
      expect(outcome, isA<DioException>());
      expect((outcome as DioException).response?.statusCode, 401);
    });

    testWidgets(
        'Android: таймаут соединения не повторяется — каждый длится до 30 с',
        (tester) async {
      setLifecycle(tester, AppLifecycleState.resumed);
      respond = (options) => throw DioException.connectionTimeout(
            requestOptions: options,
            timeout: const Duration(seconds: 30),
          );

      signIn();
      await tester.pump(const Duration(seconds: 5));

      expect(tokensSent(), ['ya-token'],
          reason: 'три таймаута подряд — полторы минуты ожидания');
      expect((outcome as DioException).type,
          DioExceptionType.connectionTimeout);
    });

    testWidgets('iPhone: отказ соединения не повторяется — вход прежний',
        (tester) async {
      setLifecycle(tester, AppLifecycleState.resumed);
      respond = noConnection;

      signIn();
      await tester.pump(const Duration(seconds: 5));

      expect(tokensSent(), ['ya-token']);
      expect(outcome, isA<DioException>());
    }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
  });

  group('Текст для человека', () {
    Future<AuthProvider> provider(Object error) async {
      final auth = AuthProvider(authService: _YandexFailing(error));
      addTearDown(auth.dispose);
      await pumpEventQueue();
      return auth;
    }

    test('нет связи — текст говорит, что делать', () async {
      final auth = await provider(DioException(
        requestOptions: RequestOptions(path: '/api/v1/auth/oauth'),
        type: DioExceptionType.connectionError,
        // Так отказ соединения выходит из транспорта (`_enhanceError`).
        error: 'Нет связи. Проверьте подключение к интернету.',
      ));

      expect(await auth.loginWithYandex(), isFalse);
      expect(auth.errorMessage, AuthProvider.yandexNoConnectionMessage,
          reason: 'общая таблица не узнаёт отказ соединения и отвечает '
              '«Произошла ошибка» — человек не понимает, что делать');
    });

    test('сервер не ответил вовремя — тоже «нет связи»', () async {
      final auth = await provider(DioException(
        requestOptions: RequestOptions(path: '/api/v1/auth/oauth'),
        type: DioExceptionType.connectionTimeout,
        error: 'Сервер не отвечает. Проверьте подключение.',
      ));

      expect(await auth.loginWithYandex(), isFalse);
      expect(auth.errorMessage, AuthProvider.yandexNoConnectionMessage);
    });

    test('отказ браузера по существу — прежний текст', () async {
      final auth =
          await provider(Exception('Yandex Sign-In was cancelled'));

      expect(await auth.loginWithYandex(), isFalse);
      expect(auth.errorMessage, 'Вход отменён');
    });

    test('ответ сервера по существу — не «нет связи»', () async {
      // Отказ транспорта с ответом сервера: связь была, сервер отказал.
      // Текст — по общей таблице, как до правки; «проверьте интернет» здесь
      // увёл бы человека искать не ту причину.
      final auth = await provider(DioException(
        requestOptions: RequestOptions(path: '/api/v1/auth/oauth'),
        response: Response<dynamic>(
          requestOptions: RequestOptions(path: '/api/v1/auth/oauth'),
          statusCode: 429,
        ),
        type: DioExceptionType.badResponse,
        error: 'Too many requests',
      ));

      expect(await auth.loginWithYandex(), isFalse);
      expect(auth.errorMessage, isNot(AuthProvider.yandexNoConnectionMessage));
      expect(auth.errorMessage,
          'Слишком много попыток. Подождите немного и попробуйте снова.');
    });
  });
}

/// Сервис, у которого вход через Яндекс заканчивается заданным отказом.
class _YandexFailing implements AuthService {
  _YandexFailing(this.error);

  final Object error;

  @override
  Future<bool> isAuthenticated() async => false;

  @override
  Future<AuthResponse> loginWithYandex() async => throw error;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
