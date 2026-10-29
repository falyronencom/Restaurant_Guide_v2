import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Сторож: запасные фразы приложения на отказы входа — те же слова, что у
/// сервера (решение Координатора 25.10 и 29.10.2026: один словарь отказов
/// входа на сервер, приложение и сайт).
///
/// Сервер пишет отказы по-русски, и приложение показывает его текст первым.
/// Своя фраза нужна, когда текста сервера нет, — и тогда человек должен
/// прочитать то же, что прочитал бы с сервера. Словарь читается из
/// исходника сервера (`backend/src/constants/authRefusals.js`) так, как сервер
/// его пишет: `ключ: '…'` или `` ключ: `…${SUPPORT_EMAIL}…` `` одной строкой.
/// CI вынимает репозиторий целиком, `../backend` рядом есть всегда (так же
/// читает `session_refusal_codes_guard_test.dart`). Зеркало сторожа сайта
/// `web/__tests__/auth-refusals-guard.test.ts`.
void main() {
  late final Map<String, String> server;

  setUpAll(() {
    final source =
        File('../backend/src/constants/authRefusals.js').readAsStringSync();
    final support = RegExp(r"export const SUPPORT_EMAIL = '([^']+)'")
        .firstMatch(source)
        ?.group(1);
    expect(support, isNotNull, reason: 'в словаре нет SUPPORT_EMAIL');
    server = {
      for (final m in RegExp(r"^\s*(\w+):\s*(['`])(.*)\2,\s*$", multiLine: true)
          .allMatches(source))
        m.group(1)!: m.group(3)!.replaceAll(r'${SUPPORT_EMAIL}', support!),
    };
    // Разбор, который ничего не нашёл, сделал бы сверку ниже пустой.
    expect(server.length, greaterThanOrEqualTo(35),
        reason: 'разбор authRefusals.js ослеп');
  });

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  Future<AuthProvider> guest(
    ResponseBody Function(RequestOptions options) respond,
  ) async {
    installWireStand(respond);
    installSecureStorageStand();
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    for (var i = 0; i < 200 && auth.isLoading; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    return auth;
  }

  /// Отказ без текста для человека: так выглядит ответ, чей текст до экрана
  /// не дошёл, — остаётся код, и фразу даёт таблица приложения.
  ResponseBody codeOnly(String code, int status) => jsonBody({
        'success': false,
        'error': {'code': code, 'message': ''},
      }, status: status);

  // Код ответа, его статус на сервере и ключ словаря сервера.
  const cases = <(String, int, String)>[
    ('INVALID_CREDENTIALS', 401, 'invalidCredentials'),
    ('EMAIL_EXISTS', 409, 'emailExists'),
    ('PHONE_EXISTS', 409, 'phoneExists'),
    ('INVALID_CODE', 401, 'codeInvalid'),
    ('INVALID_OR_EXPIRED_CODE', 410, 'codeExpired'),
    ('TOO_MANY_ATTEMPTS', 429, 'codeTooManyAttempts'),
    ('EMAIL_ALREADY_VERIFIED', 409, 'emailAlreadyVerified'),
    ('OAUTH_NO_EMAIL', 400, 'oauthNoEmail'),
    ('OAUTH_EMAIL_NOT_VERIFIED', 403, 'oauthEmailNotVerified'),
    ('ACCOUNT_DEACTIVATED', 403, 'accountDeactivated'),
    ('NO_EMAIL', 400, 'noEmail'),
  ];

  for (final (code, status, key) in cases) {
    test('$code — слова сервера ($key)', () async {
      final auth = await guest((_) => codeOnly(code, status));

      await auth.login(emailOrPhone: 'guest@example.com', password: 'Secret1');

      expect(server[key], isNotNull, reason: 'в словаре сервера нет $key');
      expect(auth.errorMessage, server[key]);
    });
  }

  test('отключённая учётная запись — с адресом поддержки', () async {
    final auth = await guest((_) => codeOnly('ACCOUNT_DEACTIVATED', 403));

    await auth.login(emailOrPhone: 'guest@example.com', password: 'Secret1');

    expect(auth.errorMessage, contains('support@nirivio.by'));
  });

  test('учётную запись отключили посреди работы — слова сервера', () {
    expect(ApiClient.accountInactiveMessage, server['accountInactive']);
  });

  test('русский текст сервера — на экран как есть, поверх таблицы', () async {
    final auth = await guest((_) => jsonBody({
          'success': false,
          'error': {
            'code': 'INVALID_CREDENTIALS',
            'message': server['invalidCredentials'],
          },
        }, status: 401));

    await auth.login(emailOrPhone: 'guest@example.com', password: 'Secret1');

    expect(auth.errorMessage, server['invalidCredentials']);
  });

  test('401 без текста и без кода сеанса — «войдите» словами сервера',
      () async {
    installWireStand((_) => jsonBody({'success': false}, status: 401));

    final error = await ApiClient()
        .get('/api/v1/favorites')
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    expect((error! as DioException).error, server['signInRequired']);
  });
}
