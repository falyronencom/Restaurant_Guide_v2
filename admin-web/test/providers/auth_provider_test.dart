import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/auth_response.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

import '../helpers/wire_stand.dart';

// Провайдер авторизации как источник события смены аккаунта.
//
// Проверяются три пути, на которых состояние прежнего оператора обязано
// исчезнуть из провайдеров: выход, истёкшая сессия (OSB-M I5) и вход под
// другим аккаунтом без выхода между ними. И роль «только просмотр»: входит,
// но действовать не может.

class _FakeAuthService implements AuthService {
  bool storedSession = false;
  User? storedUser;
  User? nextLoginUser;
  Object? loginError;
  int logoutCalls = 0;
  int clearCalls = 0;

  @override
  Future<bool> isAuthenticated() async => storedSession;

  /// Чем ответить на `/auth/me`, если задано вместо [storedUser].
  ///
  /// Нужен, чтобы отличать причины отказа: старт обязан по-разному
  /// распоряжаться хранилищем при «не дошло» и при приговоре сервера.
  Object? currentUserError;

  @override
  Future<User> getCurrentUser() async {
    if (currentUserError != null) throw currentUserError!;
    return storedUser!;
  }

  @override
  Future<AuthResponse> login({
    required String email,
    required String password,
  }) async {
    if (loginError != null) throw loginError!;
    return AuthResponse(
      accessToken: 'access',
      refreshToken: 'refresh',
      user: nextLoginUser!,
    );
  }

  /// Выход, на который сервер не отвечает никогда.
  bool logoutHangs = false;

  @override
  Future<void> logout() async {
    logoutCalls++;
    if (logoutHangs) await Completer<void>().future;
  }

  @override
  Future<void> clearAuthData() async {
    clearCalls++;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _admin = User(id: 'u-admin', email: 'admin@nirivio.by', role: 'admin');
const _viewer = User(id: 'u-viewer', email: 'guest@nirivio.by', role: 'viewer');
const _partner = User(id: 'u-partner', email: 'p@nirivio.by', role: 'partner');

void main() {
  late _FakeAuthService service;
  late int resets;

  setUp(() {
    AccountScope.debugReset();
    SessionEvents.debugReset();
    service = _FakeAuthService();
    resets = 0;
    AccountScope.register(() => resets++);
  });

  tearDown(AccountScope.debugReset);

  Future<AuthProvider> provider() async {
    final auth = AuthProvider(authService: service);
    addTearDown(auth.dispose);
    // `_initialize` асинхронный: даём ему дойти до первого `notifyListeners`.
    await pumpEventQueue();
    return auth;
  }

  group('Выход и смена аккаунта', () {
    test('выход сбрасывает реестр — до уведомления слушателей', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      expect(auth.isAuthenticated, isTrue);

      var resetsAtNotify = -1;
      auth.addListener(() => resetsAtNotify = resets);
      await auth.logout();

      expect(auth.isAuthenticated, isFalse);
      expect(resets, 1);
      // Роутер уводит на вход по уведомлению; к этому моменту провайдеры уже
      // пусты — иначе экран за редиректом на кадр нёс бы чужую очередь.
      expect(resetsAtNotify, 1);
    });

    test('выход панели зовёт выход сервиса — сеанс гаснет и на сервере',
        () async {
      // Что сервис шлёт на сервер, проверяет auth_logout_wire_test; здесь —
      // звено выше: без вызова сервиса токены остались бы в хранилище, и
      // перезагрузка вернула бы «вышедший» сеанс, живой и на сервере.
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      expect(service.logoutCalls, 0, reason: 'предпосылка');

      await auth.logout();

      expect(service.logoutCalls, 1);
    });

    test('вход под другим аккаунтом без выхода сбрасывает реестр', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      expect(resets, 0, reason: 'первый вход за запуск — сбрасывать нечего');

      service.nextLoginUser = _viewer;
      await auth.login(email: 'guest@nirivio.by', password: 'x');

      expect(resets, 1);
      expect(auth.currentUser?.id, 'u-viewer');
    });

    test('повторный вход тем же аккаунтом реестр не трогает', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      await auth.login(email: 'admin@nirivio.by', password: 'x');

      expect(resets, 0);
    });
  });

  group('Истёкшая сессия (OSB-M I5)', () {
    test('событие переводит во «не вошёл», объясняет и сбрасывает реестр',
        () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');

      SessionEvents.reportExpired();

      expect(auth.isAuthenticated, isFalse);
      expect(auth.currentUser, isNull);
      expect(auth.errorMessage, 'Сессия истекла — войдите снова');
      expect(resets, 1);
    });

    test('вне авторизованного состояния событие игнорируется', () async {
      // Неудачный вход тоже проходит через ветку транспорта, которая
      // сообщает об истёкшей сессии; провайдер отличает его по состоянию.
      final auth = await provider();

      SessionEvents.reportExpired();

      expect(auth.isAuthenticated, isFalse);
      expect(auth.errorMessage, isNull);
      expect(resets, 0);
    });

    test('после dispose провайдер событие не слушает', () async {
      final auth = AuthProvider(authService: service);
      await pumpEventQueue();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');

      auth.dispose();

      expect(SessionEvents.reportExpired, returnsNormally);
      expect(resets, 0);
    });
  });

  group('Роль «только просмотр»', () {
    test('входит, но действовать не может', () async {
      final auth = await provider();
      service.nextLoginUser = _viewer;

      final ok = await auth.login(email: 'guest@nirivio.by', password: 'x');

      expect(ok, isTrue);
      expect(auth.isAuthenticated, isTrue);
      expect(auth.canModerate, isFalse);
      expect(auth.isViewer, isTrue);
    });

    test('администратор действует', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;

      await auth.login(email: 'admin@nirivio.by', password: 'x');

      expect(auth.canModerate, isTrue);
      expect(auth.isViewer, isFalse);
    });

    test('сохранённая сессия просмотрщика принимается при старте', () async {
      service.storedSession = true;
      service.storedUser = _viewer;

      final auth = await provider();

      expect(auth.isAuthenticated, isTrue);
      expect(auth.canModerate, isFalse);
      expect(service.clearCalls, 0);
    });

    test('сохранённая сессия чужой роли стирается при старте', () async {
      service.storedSession = true;
      service.storedUser = _partner;

      final auth = await provider();

      expect(auth.isAuthenticated, isFalse);
      expect(service.clearCalls, 1);
    });
  });

  group('Старт: отказ, который НЕ приговор сессии', () {
    // Хоронит сессию тот, кто получил приговор, — транспорт: отвергнутое
    // обновление токена он чистит сам (OSB-M I5). До `catch` в `_initialize`
    // доходит «не дошло», и стирание там выкидывало оператора из ЖИВОЙ
    // сессии на коротком обрыве сети. Разобрать по коду ответа нельзя:
    // ветки 401 пересобирают `DioException` БЕЗ `response` — у обеих
    // заготовок ниже статуса нет, и это не упущение стенда, а свойство
    // транспорта, ради которого правило заменило разбор.
    //
    // Случай «чужая роль» — приговор, вынесенный здесь, и он чистит
    // по-прежнему; проверен выше и повторно не дублируется.

    test('временная недоступность — сессия остаётся в хранилище', () async {
      service.storedSession = true;
      service.currentUserError = DioException(
        requestOptions: RequestOptions(path: '/api/v1/auth/me'),
        type: DioExceptionType.badResponse,
        error: 'Service temporarily unavailable. Please try again.',
      );

      final auth = await provider();

      expect(auth.isAuthenticated, isFalse);
      expect(auth.errorMessage, 'Не удалось проверить сессию — войдите снова',
          reason: 'иначе оператор видит экран входа без объяснения');
      expect(service.clearCalls, 0,
          reason: 'молчание сети не доказывает, что токен мёртв');
    });

    test('обрыв сети — сессия остаётся в хранилище', () async {
      service.storedSession = true;
      service.currentUserError = DioException(
        requestOptions: RequestOptions(path: '/api/v1/auth/me'),
        type: DioExceptionType.connectionError,
        error: 'No internet connection. Please check your network.',
      );

      final auth = await provider();

      expect(auth.isAuthenticated, isFalse);
      expect(service.clearCalls, 0);
    });
  });

  group('Текст отказа во входе — по ответу сервера', () {
    // До 20.10.2026 провайдер искал английские подстроки в `toString()`, а
    // тесты подсовывали готовую строку в `DioException.error` — и зеленели
    // на мёртвом коде: 429, 422 и сбой сервера давали «Ошибку входа»
    // (проход по панели модератора, пункт A3-08). Теперь ответ идёт по
    // проводу: подставной транспорт, настоящие сервис и перехватчики.
    Future<String?> refusal(ResponseBody Function(RequestOptions) respond) async {
      installSecureStorageStand();
      final adapter = StubAdapter(respond);
      final auth = AuthProvider(
          authService: AuthService.withClient(stubClient(adapter)));
      addTearDown(auth.dispose);
      await pumpEventQueue();

      final ok = await auth.login(email: 'probe@example.com', password: 'typo');
      expect(ok, isFalse);
      expect(auth.isAuthenticated, isFalse);
      return auth.errorMessage;
    }

    test('401 неверный пароль → «Неверный email или пароль»', () async {
      expect(
        await refusal((_) => jsonBody(
              rejectedBody('INVALID_CREDENTIALS', 'Invalid email/phone or password'),
              status: 401,
            )),
        'Неверный email или пароль',
      );
    });

    test('403 роль вне панели → «Доступ только для администраторов»', () async {
      expect(
        await refusal((_) => jsonBody(
              rejectedBody('ADMIN_ACCESS_REQUIRED', 'Admin access required'),
              status: 403,
            )),
        'Доступ только для администраторов',
      );
    });

    test('429 лимит входа → фраза со сроком', () async {
      expect(
        await refusal((_) => jsonBody(<String, dynamic>{
              'success': false,
              'message': 'Слишком много запросов. Попробуйте позже.',
              'error': <String, dynamic>{'code': 'RATE_LIMIT_EXCEEDED'},
            }, status: 429)),
        'Слишком много попыток входа. Подождите минуту и попробуйте снова.',
      );
    });

    test('422 кривой email → объяснение, а не «Request validation failed»',
        () async {
      expect(
        await refusal((_) => jsonBody(<String, dynamic>{
              'success': false,
              'message': 'Validation failed',
              'error': <String, dynamic>{
                'code': 'VALIDATION_ERROR',
                'details': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'field': 'email',
                    'message': 'Invalid email format',
                  },
                ],
              },
            }, status: 422)),
        'Email указан неверно — проверьте, как он написан.',
      );
    });

    test('сбой сервера → его русская фраза', () async {
      expect(
        await refusal((_) => jsonBody(<String, dynamic>{
              'success': false,
              'message': 'Сбой на сервере. Попробуйте ещё раз через минуту.',
              'error': <String, dynamic>{'code': 'INTERNAL_ERROR'},
            }, status: 500)),
        'Сбой на сервере. Попробуйте ещё раз через минуту.',
      );
    });

    test('нет связи → «Нет связи с сервером…»', () async {
      expect(
        await refusal((options) => throw DioException(
              requestOptions: options,
              type: DioExceptionType.connectionError,
            )),
        kNoConnectionPhrase,
      );
    });
  });

  group('Ход входа и выхода', () {
    test('вход не поднимает isLoading — роутер не пересоздаёт экран входа',
        () async {
      // `isLoading` — сигнал роутеру увести на кадр инициализации. Вход его
      // поднимал, и экран входа строился заново с пустыми полями (A3-07).
      final auth = await provider();
      service.loginError = DioException(
        requestOptions: RequestOptions(path: '/api/v1/admin/auth/login'),
        type: DioExceptionType.connectionError,
      );
      final seen = <bool>[];
      final statuses = <AuthStatus>[];
      auth.addListener(() {
        seen.add(auth.isLoading);
        statuses.add(auth.status);
      });

      await auth.login(email: 'admin@nirivio.by', password: 'typo');

      expect(seen, isNot(contains(true)));
      expect(statuses.first, AuthStatus.authenticating,
          reason: 'ход входа — статусом: по нему кнопка показывает спиннер');
      expect(auth.status, AuthStatus.unauthenticated);
    });

    testWidgets(
        'выход при молчащем сервере укладывается в потолок и выходит локально',
        (tester) async {
      // Поддельное время `testWidgets`: потолок отсчитывается без настоящих
      // шести секунд ожидания.
      service.logoutHangs = true;
      service.nextLoginUser = _admin;
      final auth = AuthProvider(authService: service);
      addTearDown(auth.dispose);
      await tester.pump();
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      expect(auth.isAuthenticated, isTrue, reason: 'предпосылка');

      var done = false;
      unawaited(auth.logout().then((_) => done = true));
      await tester.pump();
      expect(auth.isLoading, isTrue, reason: 'выход идёт — кадр инициализации');

      await tester.pump(AuthProvider.logoutTimeout - const Duration(seconds: 1));
      expect(done, isFalse);

      await tester.pump(const Duration(seconds: 2));
      expect(done, isTrue,
          reason: 'без потолка кадр инициализации ждал бы таймаутов Dio');
      expect(auth.isLoading, isFalse);
      expect(auth.isAuthenticated, isFalse);
      expect(service.clearCalls, 1,
          reason: 'сервис до стирания не дошёл — хранилище чистит провайдер');
    });
  });
}
