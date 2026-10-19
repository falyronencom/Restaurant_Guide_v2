import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/api_log.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Журнал запросов (`API_LOG`, сборка `ENV=development`) без секретов — Н7,
/// 19.10.2026.
///
/// До правки стандартный `LogInterceptor` dio печатал в журнал телефона
/// заголовок `Authorization: Bearer <токен доступа>`, refresh-токен из тела
/// `/auth/refresh`, пару токенов из ответов, пароль входа и код из письма.
/// Проверка идёт через клиент целиком: журнал стоит после перехватчика,
/// который ставит `Authorization`, и видит запрос таким, каким он уходит.
///
/// Значения секретов — заметные литералы: тест ищет именно их в журнале.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const oldAccess = 'ACCESS-OLD-a1b2c3';
  const oldRefresh = 'REFRESH-OLD-d4e5f6';
  const newAccess = 'ACCESS-NEW-g7h8i9';
  const newRefresh = 'REFRESH-NEW-j0k1l2';
  const password = 'Pa55-secret-word';
  const emailCode = '482913';

  late List<String> log;
  late DebugPrintCallback savedDebugPrint;

  setUp(() {
    installSecureStorageStand({
      'access_token': oldAccess,
      'refresh_token': oldRefresh,
    });
    SessionEvents.debugReset();
    log = [];
    savedDebugPrint = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) log.add(message);
    };
  });

  tearDown(() => debugPrint = savedDebugPrint);

  ApiClient client(StubAdapter adapter) {
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    return ApiClient.withDio(dio, apiLogging: true);
  }

  String journal() => log.join('\n');

  /// Журнал не пуст и знает путь — иначе «секрета нет» доказывало бы только
  /// то, что журнал молчит.
  void expectJournalOf(String path) {
    expect(journal(), contains(path), reason: 'журнал не записал запрос');
    expect(journal(), contains('[API]'));
  }

  test('защищённый запрос: заголовок Authorization замаскирован', () async {
    final adapter = StubAdapter((o) {
      // Предпосылка: на провод токен ушёл — маскируется только журнал.
      expect(o.headers['Authorization'], 'Bearer $oldAccess');
      return jsonBody({'success': true, 'data': <String, dynamic>{}});
    });
    await client(adapter).get('/api/v1/favorites');

    expectJournalOf('/api/v1/favorites');
    expect(journal(), isNot(contains(oldAccess)));
    expect(journal(), contains('Authorization: $redactedMark'));
  });

  test('вход: пароль в теле и пара токенов в ответе замаскированы', () async {
    final adapter = StubAdapter((o) => jsonBody({
          'success': true,
          'data': {
            'user': {'id': 'u1', 'email': 'guest@example.com'},
            'accessToken': newAccess,
            'refreshToken': newRefresh,
          },
        }));
    await client(adapter).post('/api/v1/auth/login', data: {
      'email': 'guest@example.com',
      'password': password,
    });

    expectJournalOf('/api/v1/auth/login');
    for (final secret in [password, newAccess, newRefresh]) {
      expect(journal(), isNot(contains(secret)), reason: secret);
    }
    // Остальное на месте — журнал по-прежнему полезен.
    expect(journal(), contains('guest@example.com'));
  });

  test('обновление токена: refresh-токен в теле и новая пара не в журнале',
      () async {
    var favorites = 0;
    final adapter = StubAdapter((o) {
      if (o.uri.path == '/api/v1/auth/refresh') {
        return jsonBody({
          'success': true,
          'data': {'accessToken': newAccess, 'refreshToken': newRefresh},
        });
      }
      favorites++;
      return favorites == 1
          ? jsonBody({
              'success': false,
              'error': {'code': 'TOKEN_EXPIRED', 'message': 'Token expired'},
            }, status: 401)
          : jsonBody({'success': true, 'data': <String, dynamic>{}});
    }, maxRequests: 5);
    await client(adapter).get('/api/v1/favorites');

    // Предпосылка: обновление было.
    expect(adapter.requests.map((r) => r.uri.path),
        contains('/api/v1/auth/refresh'));
    expectJournalOf('/api/v1/auth/refresh');
    for (final secret in [oldAccess, oldRefresh, newAccess, newRefresh]) {
      expect(journal(), isNot(contains(secret)), reason: secret);
    }
    // Код отказа сервера — не секрет, он нужен для разбора.
    expect(journal(), contains('TOKEN_EXPIRED'));
  });

  test('код из письма в теле запроса замаскирован', () async {
    final adapter = StubAdapter((o) => jsonBody({
          'success': false,
          'error': {'code': 'INVALID_CODE', 'message': 'Неверный код'},
        }, status: 400));
    await expectLater(
      client(adapter)
          .post('/api/v1/auth/verify-email-code', data: {'code': emailCode}),
      throwsA(isA<DioException>()),
    );

    expectJournalOf('/api/v1/auth/verify-email-code');
    expect(journal(), isNot(contains(emailCode)));
    expect(journal(), contains('INVALID_CODE'));
  });

  group('redactForLog', () {
    test('ключи токенов и паролей в любом написании и на любой глубине', () {
      final out = redactForLog({
        'refresh_token': 'a',
        'items': [
          {'fcm_token': 'b', 'name': 'ok'},
        ],
        'Current-Password': 'c',
        'nested': {'idToken': 'd', 'secret': 'e'},
      }, request: true);
      expect(out.toString(), isNot(matches(RegExp(r'\b[a-e]\b'))));
      expect(out.toString(), contains('ok'));
    });

    test('тело-строка JSON разбирается и чистится; другая строка — длиной',
        () {
      expect(
        redactForLog('{"refreshToken":"$oldRefresh"}', request: true)
            .toString(),
        isNot(contains(oldRefresh)),
      );
      expect(redactForLog('Bearer $oldAccess').toString(),
          isNot(contains(oldAccess)));
    });

    test('code — секрет только в запросе', () {
      expect(redactForLog({'code': '1'}, request: true), {'code': redactedMark});
      expect(redactForLog({'code': 'X'}), {'code': 'X'});
    });

    test('секрет в строке запроса адреса', () {
      final uri = Uri.parse('https://h/api/v1/auth/verify?token=$oldAccess&a=1');
      final out = redactUriForLog(uri);
      expect(out, isNot(contains(oldAccess)));
      expect(out, contains('a=1'));
    });
  });
}
