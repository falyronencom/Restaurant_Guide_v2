import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

import '../helpers/wire_stand.dart';

/// Сессия переживает перезагрузку страницы.
///
/// Найдено на хостинге 08.09.2026: после F5 панель показывала форму входа.
/// Бэкенд отдаёт `/api/v1/auth/me` конвертом `{ success, data: { user } }`
/// (закреплено `backend/src/tests/e2e/auth-journey.test.js`), а сервис
/// панели брал `data` целиком: `User.fromJson({user: ...})` давал
/// пользователя без id и с ролью `user` по умолчанию, провайдер считал
/// сессию чужой и стирал хранилище на КАЖДОМ старте. Тест идёт через
/// настоящие `AuthService` и `ApiClient` поверх подставного транспорта —
/// фейк сервиса этот слой спрятал бы.
void main() {
  const meEnvelope = <String, dynamic>{
    'success': true,
    'data': {
      'user': {
        'id': 'u-admin',
        'email': 'admin@nirivio.by',
        'name': 'Всеволод',
        'role': 'admin',
        'is_verified': true,
      },
    },
  };

  setUp(() {
    AccountScope.debugReset();
    SessionEvents.debugReset();
  });

  tearDown(AccountScope.debugReset);

  test('getCurrentUser читает конверт data.user, а не data целиком', () async {
    installSecureStorageStand(initial: {'access_token': 'a1'});
    final adapter = StubAdapter((_) => jsonBody(meEnvelope));
    final service = AuthService.withClient(stubClient(adapter));

    final user = await service.getCurrentUser();

    expect(user.id, 'u-admin');
    expect(user.role, 'admin');
    expect(adapter.requests.single.uri.path, '/api/v1/auth/me');
    expect(adapter.requests.single.headers['Authorization'], 'Bearer a1');
  });

  test('вход: конверт data разбирается, токены ложатся в хранилище', () async {
    // Без этого шага сессии, которую переживает перезагрузка, не было бы
    // вовсе: тесты ниже кладут токены в хранилище руками. Ответ — как его
    // отдаёт adminController.adminLogin: `{ success, data: { user,
    // accessToken, refreshToken, tokenType, expiresIn } }`.
    final storage = installSecureStorageStand(initial: {});
    final adapter = StubAdapter((_) => jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'user': <String, dynamic>{
              'id': 'u-admin',
              'email': 'admin@nirivio.by',
              'phone': null,
              'name': 'Всеволод',
              'role': 'admin',
              'authMethod': 'email',
              'lastLoginAt': '2026-10-18T09:00:00.000Z',
            },
            'accessToken': 'access-from-login',
            'refreshToken': 'refresh-from-login-0123456789abcdef',
            'tokenType': 'Bearer',
            'expiresIn': 14400,
          },
        }));
    final service = AuthService.withClient(stubClient(adapter));

    final result =
        await service.login(email: 'admin@nirivio.by', password: 'secret');

    expect(adapter.requests.single.uri.path, '/api/v1/admin/auth/login');
    expect(result.user.id, 'u-admin');
    expect(result.user.role, 'admin');
    expect(storage['access_token'], 'access-from-login');
    expect(storage['refresh_token'], 'refresh-from-login-0123456789abcdef');
  });

  test('старт с сохранённой сессией администратора: вошёл, хранилище цело',
      () async {
    final storage = installSecureStorageStand(
      initial: {'access_token': 'a1', 'refresh_token': 'r1'},
    );
    final adapter = StubAdapter((_) => jsonBody(meEnvelope));
    final auth = AuthProvider(
      authService: AuthService.withClient(stubClient(adapter)),
    );
    addTearDown(auth.dispose);

    await pumpEventQueue();

    expect(auth.isLoading, isFalse);
    expect(auth.isAuthenticated, isTrue,
        reason: 'сессия из хранилища должна быть принята, а не стёрта');
    expect(auth.currentUser?.id, 'u-admin');
    expect(auth.canModerate, isTrue);
    expect(storage['access_token'], 'a1', reason: 'clearAuthData не звался');
    expect(storage['refresh_token'], 'r1');
  });

  test('старт с сохранённой сессией просмотрщика принимается тем же путём',
      () async {
    final storage = installSecureStorageStand(initial: {'access_token': 'a1'});
    final viewerEnvelope = <String, dynamic>{
      'success': true,
      'data': {
        'user': {'id': 'u-viewer', 'email': 'guest@nirivio.by', 'role': 'viewer'},
      },
    };
    final auth = AuthProvider(
      authService: AuthService.withClient(
        stubClient(StubAdapter((_) => jsonBody(viewerEnvelope))),
      ),
    );
    addTearDown(auth.dispose);

    await pumpEventQueue();

    expect(auth.isAuthenticated, isTrue);
    expect(auth.canModerate, isFalse);
    expect(storage['access_token'], 'a1', reason: 'хранилище просмотрщика цело');
  });

  test('старт с сессией чужой роли по-прежнему стирает хранилище', () async {
    final storage = installSecureStorageStand(initial: {'access_token': 'a1'});
    final partnerEnvelope = <String, dynamic>{
      'success': true,
      'data': {
        'user': {'id': 'u-partner', 'email': 'p@nirivio.by', 'role': 'partner'},
      },
    };
    final auth = AuthProvider(
      authService: AuthService.withClient(
        stubClient(StubAdapter((_) => jsonBody(partnerEnvelope))),
      ),
    );
    addTearDown(auth.dispose);

    await pumpEventQueue();

    expect(auth.isAuthenticated, isFalse);
    expect(storage.containsKey('access_token'), isFalse);
  });
}
