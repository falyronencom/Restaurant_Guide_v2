import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Выход из профиля гасит сеанс и на сервере.
///
/// Найдено 09.10.2026 по журналу телефона: «Выйти» в профиле давал
/// `POST /api/v1/auth/logout` → 422. Сервис слал токен под ключом
/// `refresh_token`, а бэкенд (`validateLogout`) ждёт `refreshToken` — как и
/// у `/auth/refresh`, и у сайта. Ошибку выхода сервис глотает намеренно,
/// локальные токены стирались, и человек выглядел вышедшим, хотя
/// refresh-токен на сервере жил до своего срока.
///
/// Вторая половина — выход с истёкшим access-токеном (четыре часа без
/// запросов, приложение в фоне). Сервер отвечает 401, транспорт обновляет
/// пару и повторяет выход с ТЕМ ЖЕ телом — со старым токеном, который
/// ротация уже погасила. Сервер отвечает 200, но гасить ему нечего, а
/// преемник остаётся живым. Сайт перечитывает токен после обновления
/// (`web/src/lib/auth/actions.ts`, `logoutAction`); сервис обязан
/// погасить тот токен, который сессия держит сейчас.
///
/// Стенд провода заменяет транспорт синглтона `ApiClient`, хранилище —
/// карта в памяти: перехватчики пишут в неё новую пару после обновления, и
/// тест видит ровно то, что ушло на провод.
void main() {
  late Map<String, String> storage;

  /// Ответ `validateLogout`: без строки `refreshToken` в теле — 422.
  ResponseBody logoutResponse(RequestOptions options) {
    final body = options.data;
    if (body is Map && body['refreshToken'] is String) {
      return jsonBody({
        'success': true,
        'data': {'message': 'Logged out successfully'},
      });
    }
    return jsonBody({
      'success': false,
      'error': {
        'code': 'VALIDATION_ERROR',
        'message': 'Validation failed',
        'details': {'refreshToken': 'Refresh token is required'},
      },
    }, status: 422);
  }

  /// Отказ middleware `authenticate` на истёкший access-токен.
  ResponseBody expiredAccess() => jsonBody({
        'success': false,
        'message': 'Access token has expired',
        'error': {'code': 'TOKEN_EXPIRED'},
      }, status: 401);

  bool isLogout(RequestOptions o) => o.uri.path == '/api/v1/auth/logout';
  bool isRefresh(RequestOptions o) => o.uri.path == '/api/v1/auth/refresh';

  List<RequestOptions> logouts(StubAdapter adapter) =>
      adapter.requests.where(isLogout).toList();

  setUp(() {
    SessionEvents.debugReset();
  });

  test('выход шлёт refreshToken — ключ, который принимает сервер', () async {
    final adapter = installWireStand(logoutResponse);
    storage = installSecureStorageStand({
      'access_token': 'a1',
      'refresh_token': 'r1',
      'user_data': '{}',
    });

    await AuthService().logout();

    final sent = adapter.requests.single;
    expect(sent.uri.path, '/api/v1/auth/logout');
    expect(sent.method, 'POST');
    expect(sent.headers['Authorization'], 'Bearer a1');
    expect(sent.data, {'refreshToken': 'r1'});
    expect(storage, isEmpty, reason: 'локальная сессия стёрта');
  });

  test(
      'истёкший access: после обновления гасится преемник, а не погашенный '
      'ротацией токен', () async {
    final adapter = installWireStand((options) {
      if (isRefresh(options)) {
        return jsonBody({
          'success': true,
          'data': {'accessToken': 'a2', 'refreshToken': 'r2'},
        });
      }
      if (options.headers['Authorization'] == 'Bearer stale') {
        return expiredAccess();
      }
      return logoutResponse(options);
    });
    storage = installSecureStorageStand({
      'access_token': 'stale',
      'refresh_token': 'r1',
    });

    await AuthService().logout();

    final sent = logouts(adapter);
    expect(sent, hasLength(3), reason: 'отказ 401, повтор транспорта, второй '
        'выход — и ни одного сверх');
    expect(sent[1].data, {'refreshToken': 'r1'},
        reason: 'повтор транспорта несёт старое тело — ради этого и второй выход');
    final last = sent.last;
    expect(last.headers['Authorization'], 'Bearer a2');
    expect(last.data, {'refreshToken': 'r2'},
        reason: 'r1 погасила ротация; живой — r2, его и гасит выход');
    expect(adapter.requests.where(isRefresh).single.data,
        {'refreshToken': 'r1'});
    expect(storage, isEmpty);
  });

  test('повтор выхода после обновления оборвался — преемник всё равно гасится',
      () async {
    final adapter = installWireStand((options) {
      if (isRefresh(options)) {
        return jsonBody({
          'success': true,
          'data': {'accessToken': 'a2', 'refreshToken': 'r2'},
        });
      }
      if (options.headers['Authorization'] == 'Bearer stale') {
        return expiredAccess();
      }
      final body = options.data;
      if (body is Map && body['refreshToken'] == 'r1') {
        throw DioException.connectionError(
          requestOptions: options,
          reason: 'соединение оборвалось',
        );
      }
      return logoutResponse(options);
    });
    storage = installSecureStorageStand({
      'access_token': 'stale',
      'refresh_token': 'r1',
    });

    await AuthService().logout();

    final last = logouts(adapter).last;
    expect(last.headers['Authorization'], 'Bearer a2');
    expect(last.data, {'refreshToken': 'r2'});
    expect(storage, isEmpty);
  });

  /// Выход над мёртвой сессией: обновление отвергнуто, транспорт стёр токены,
  /// запрос выхода отказал. Сервис обязан проглотить отказ и всё равно
  /// стереть остаток (`user_data`), не пытаясь выходить второй раз.
  test('сессия уже мертва: выход завершается, остаток стёрт, запрос один',
      () async {
    final adapter = installWireStand((options) {
      if (isRefresh(options)) {
        return jsonBody({
          'success': false,
          'error': {
            'code': 'TOKEN_EXPIRED',
            'message': 'Refresh token has expired. Please log in again.',
          },
        }, status: 401);
      }
      return expiredAccess();
    });
    storage = installSecureStorageStand({
      'access_token': 'stale',
      'refresh_token': 'r1',
      'user_data': '{}',
    });

    await AuthService().logout();

    expect(logouts(adapter), hasLength(1),
        reason: 'гасить больше нечего — токены стёр транспорт');
    expect(storage, isEmpty, reason: 'user_data стирает сам сервис');
  });
}
