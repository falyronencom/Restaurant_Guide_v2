import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Учётную запись отключили или удалили, пока человек в приложении: он
/// читает слова сервера с адресом поддержки, а не «Сеанс истёк» (решение
/// Координатора 29.10.2026). До правки отказ обновления сеанса с кодом
/// `ACCOUNT_INACTIVE` становился «Сеанс истёк», и причина терялась.
///
/// Настоящие `AuthProvider` и `ApiClient`, подменён только провод.
void main() {
  const serverText = 'Учётная запись отключена или удалена. Если это ошибка — '
      'напишите в поддержку: support@nirivio.by';

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  Future<void> settled(AuthProvider auth) async {
    for (var i = 0; i < 200 && auth.isLoading; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }

  ResponseBody refusal(String code, String message, int status) => jsonBody({
        'success': false,
        'error': {'code': code, 'message': message},
      }, status: status);

  ResponseBody profile() => jsonBody({
        'success': true,
        'data': {
          'user': {'id': 'u-1', 'email': 'guest@example.com', 'name': 'Гость'},
        },
      });

  /// Вошёл; дальше любой запрос, кроме профиля, отвергнут проверкой входа, а
  /// обновление сеанса — отказом [refreshCode].
  Future<AuthProvider> signedInThenRefused(
    String refreshCode,
    String refreshText,
  ) async {
    var meCalls = 0;
    installWireStand((options) {
      final path = options.uri.path;
      if (path.endsWith('/auth/me') && meCalls++ == 0) return profile();
      if (path.endsWith('/auth/refresh')) {
        return refusal(refreshCode, refreshText, 401);
      }
      return refusal('ACCOUNT_INACTIVE', serverText, 401);
    });
    installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    await settled(auth);
    expect(auth.isAuthenticated, isTrue, reason: 'предпосылка: вошёл');
    return auth;
  }

  Future<DioException> refusedRequest() => ApiClient()
      .get('/api/v1/favorites')
      .then<DioException>((_) => fail('запрос не должен пройти'),
          onError: (Object e) => e as DioException);

  test('отключили посреди работы — слова сервера, а не «Сеанс истёк»',
      () async {
    final auth = await signedInThenRefused('ACCOUNT_INACTIVE', serverText);

    final error = await refusedRequest();

    expect(error.error, serverText);
    expect(ApiClient.isSessionEnded(error), isTrue);
    expect(auth.isAuthenticated, isFalse);
    expect(auth.sessionEndedNotice, serverText);
  });

  test('в ответе нет русского текста — те же слова из приложения', () async {
    final auth = await signedInThenRefused('ACCOUNT_INACTIVE', '');

    final error = await refusedRequest();

    expect(error.error, ApiClient.accountInactiveMessage);
    expect(auth.sessionEndedNotice, ApiClient.accountInactiveMessage);
  });

  test('сеанс просто истёк — «Сеанс истёк», без окна', () async {
    final auth = await signedInThenRefused(
        'TOKEN_EXPIRED', 'Сеанс истёк. Войдите заново.');

    final error = await refusedRequest();

    expect(error.error, ApiClient.sessionExpiredMessage);
    expect(ApiClient.isSessionEnded(error), isTrue);
    expect(auth.isAuthenticated, isFalse);
    expect(auth.sessionEndedNotice, isNull);
  });

  test('отключили, пока приложение было закрыто, — причина и при старте',
      () async {
    installWireStand((options) {
      if (options.uri.path.endsWith('/auth/refresh')) {
        return refusal('ACCOUNT_INACTIVE', serverText, 401);
      }
      return refusal('ACCOUNT_INACTIVE', serverText, 401);
    });
    installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    await settled(auth);

    expect(auth.isAuthenticated, isFalse);
    expect(auth.sessionEndedNotice, serverText);
  });

  test('показанная причина снимается, новый вход её не возвращает', () async {
    final auth = await signedInThenRefused('ACCOUNT_INACTIVE', serverText);
    await refusedRequest();

    auth.clearSessionEndedNotice();

    expect(auth.sessionEndedNotice, isNull);
  });
}
