import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

import '../helpers/wire_stand.dart';

/// Выход из панели гасит сеанс и на сервере.
///
/// Тот же дефект, что найден 09.10.2026 в mobile: сервис слал токен под
/// ключом `refresh_token`, бэкенд (`validateLogout`) ждёт `refreshToken` и
/// отвечал 422. Отказ выхода сервис глотает намеренно, хранилище
/// стиралось, и администратор выглядел вышедшим, а refresh-токен на сервере
/// жил до своего срока.
///
/// Вторая половина — выход с истёкшим access-токеном: транспорт обновляет
/// пару по 401 и повторяет выход со старым телом, а старый токен ротация
/// уже погасила. Гасить надо тот, что сессия держит сейчас — как делает
/// сайт (`web/src/lib/auth/actions.ts`, `logoutAction`).
void main() {
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

  setUp(SessionEvents.debugReset);

  test('выход шлёт refreshToken — ключ, который принимает сервер', () async {
    final storage = installSecureStorageStand(initial: {
      'access_token': 'a1',
      'refresh_token': 'r1',
    });
    final adapter = StubAdapter(logoutResponse);

    await AuthService.withClient(stubClient(adapter)).logout();

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
    final storage = installSecureStorageStand(initial: {
      'access_token': 'stale',
      'refresh_token': 'r1',
    });
    final adapter = StubAdapter((options) {
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

    await AuthService.withClient(stubClient(adapter)).logout();

    final sent = adapter.requests.where(isLogout).toList();
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
    final storage = installSecureStorageStand(initial: {
      'access_token': 'stale',
      'refresh_token': 'r1',
    });
    final adapter = StubAdapter((options) {
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

    await AuthService.withClient(stubClient(adapter)).logout();

    final last = adapter.requests.where(isLogout).last;
    expect(last.headers['Authorization'], 'Bearer a2');
    expect(last.data, {'refreshToken': 'r2'});
    expect(storage, isEmpty);
  });

  test('сессия уже мертва: обновление отвергнуто — второго выхода нет',
      () async {
    final storage = installSecureStorageStand(initial: {
      'access_token': 'stale',
      'refresh_token': 'r1',
    });
    final adapter = StubAdapter((options) {
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

    await AuthService.withClient(stubClient(adapter)).logout();

    expect(adapter.requests.where(isLogout), hasLength(1),
        reason: 'гасить больше нечего — токены стёр транспорт');
    expect(storage, isEmpty);
  });
}
