import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Успешная регистрация входит в аккаунт — ответ сервера в его собственной
/// форме.
///
/// До 25.10.2026 успешную регистрацию не исполнял ни один тест: модельный
/// `account_contract_test.dart` кормил разбор ответа ключами `access_token` в
/// snake_case, а сервер отдаёт `accessToken` в camelCase
/// (`backend/src/controllers/authController.js`, ответ `register`, 201).
/// Разбор держит оба написания, но снятие camelCase не покраснило бы ничего —
/// а без него после регистрации токены не ложатся в хранилище и человек
/// остаётся без сеанса на экране подтверждения почты.
///
/// Подменён только провод: `AuthService()` и `ApiClient()` настоящие.
void main() {
  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  Future<void> settled(AuthProvider auth) async {
    for (var i = 0; i < 200 && auth.isLoading; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(auth.isLoading, isFalse, reason: 'провайдер не вышел из загрузки');
  }

  /// Тело ответа `POST /api/v1/auth/register` — литералом по
  /// `backend/src/controllers/authController.js` (функция `register`,
  /// `res.status(201).json(...)`): `user` и токены в camelCase.
  Map<String, dynamic> serverRegistered() => <String, dynamic>{
        'success': true,
        'data': <String, dynamic>{
          'user': <String, dynamic>{
            'id': 'u-new',
            'email': 'new@example.com',
            'phone': null,
            'name': 'Анна',
            'role': 'user',
            'authMethod': 'email',
            'createdAt': '2026-10-25T12:00:00.000Z',
          },
          'accessToken': 'acc-from-register',
          'refreshToken': 'ref-from-register',
          'tokenType': 'Bearer',
          'expiresIn': 900,
        },
      };

  test('201 сервера: токены легли в хранилище, человек вошёл, а не ждёт '
      'подтверждения', () async {
    final adapter = installWireStand((options) {
      if (options.uri.path == '/api/v1/auth/register') {
        return jsonBody(serverRegistered(), status: 201);
      }
      // Профиль при старте — сессии нет.
      return jsonBody(<String, dynamic>{'success': false}, status: 401);
    });
    final storage = installSecureStorageStand();
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    await settled(auth);
    expect(auth.isAuthenticated, isFalse, reason: 'предусловие: гость');

    final ok = await auth.registerWithEmail(
      email: 'new@example.com',
      password: 'Secret123',
      name: 'Анна',
    );

    expect(ok, isTrue);
    expect(
      adapter.requests.where((r) => r.uri.path == '/api/v1/auth/register'),
      hasLength(1),
    );
    expect(storage['access_token'], 'acc-from-register',
        reason: 'токен из camelCase-ответа сервера не сохранён — сеанса нет');
    expect(storage['refresh_token'], 'ref-from-register');
    expect(auth.status, AuthenticationStatus.authenticated,
        reason: 'после регистрации с токенами человек вошёл, а не ждёт '
            'подтверждения почты без сеанса');
    expect(auth.currentUser?.id, 'u-new');
  });
}
