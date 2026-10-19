import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/providers/admin_users_provider.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

// Сервис «Пользователей» ниже своей границы: что уходит на сервер и как
// разбирается конверт — на настоящем ApiClient поверх подставного транспорта
// (стенд admin-web, test/services/service_injection_test.dart).
//
// Главное здесь — путь отказа: сервер кладёт русский текст в `message`
// конверта (backend/src/middleware/errorHandler.js), ApiClient переносит его в
// DioException.error, провайдер показывает модератору как есть. Если любое
// звено перестанет передавать текст, модератор увидит «Произошла ошибка»
// вместо «У этого партнёра есть карточки заведений…» — тест это ловит.

class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Map<String, dynamic> body, {int status = 200}) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const storageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, (call) async => null);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, null);
  });

  AdminUserService serviceOver(_StubAdapter adapter) {
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    return AdminUserService.withClient(ApiClient.withDio(dio));
  }

  test('список: поиск и фильтр уходят в запрос, страницы — из meta', () async {
    final adapter = _StubAdapter((_) => _json(<String, dynamic>{
          'success': true,
          'data': <dynamic>[
            <String, dynamic>{
              'id': 'u1',
              'name': 'Иван',
              'role': 'user',
              'is_active': false,
              'review_count': 2,
              'hidden_review_count': 2,
              'establishment_count': 0,
            },
          ],
          'meta': <String, dynamic>{'total': 41, 'page': 2, 'pages': 3},
        }));

    final result = await serviceOver(adapter)
        .getUsers(page: 2, search: '+375 29', status: 'blocked');

    final query = adapter.requests.single.queryParameters;
    expect(adapter.requests.single.path, '/api/v1/admin/users');
    expect(query['search'], '+375 29');
    expect(query['status'], 'blocked');
    expect(query['page'], 2);
    expect(result.total, 41);
    expect(result.pages, 3);
    expect(result.users.single.isActive, isFalse);
  });

  test('карточка человека: свой адрес с id, конверт разобран', () async {
    // Слой сервиса для ссылки «к автору»: экран людей в своих тестах получает
    // карточку от подставного сервиса, и адрес запроса не видит никто.
    // Конверт — adminUserController.getUser: `{ success, data: user }`.
    final adapter = _StubAdapter((_) => _json(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'id': 'author-9',
            'name': 'Автор Отзыва',
            'role': 'user',
            'is_active': true,
            'review_count': 1,
            'hidden_review_count': 0,
            'establishment_count': 0,
          },
        }));

    final user = await serviceOver(adapter).getUser('author-9');

    expect(adapter.requests.single.method, 'GET');
    expect(adapter.requests.single.path, '/api/v1/admin/users/author-9');
    expect(user.id, 'author-9');
    expect(user.name, 'Автор Отзыва');
  });

  test('блокировка: причина в теле, флаг changed разобран', () async {
    var changed = true;
    final adapter = _StubAdapter((_) => _json(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'id': 'u1',
            'is_active': false,
            'changed': changed,
            'hidden_reviews': 3,
          },
        }));
    final service = serviceOver(adapter);

    expect(await service.block('u1', reason: 'мат'), isTrue);
    final request = adapter.requests.single;
    expect(request.method, 'POST');
    expect(request.path, '/api/v1/admin/users/u1/block');
    expect(request.data, <String, dynamic>{'reason': 'мат'});

    changed = false;
    expect(await service.block('u1', reason: 'мат'), isFalse);
  });

  test('сброс имени и разблокировка — свои адреса', () async {
    final adapter = _StubAdapter((_) => _json(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'changed': true},
        }));
    final service = serviceOver(adapter);

    await service.unblock('u1', reason: 'извинился');
    await service.unblock('u1', reason: 'простили', restoreReviews: false);
    await service.resetName('u1', reason: 'мат в имени');

    expect(adapter.requests.map((r) => r.path), <String>[
      '/api/v1/admin/users/u1/unblock',
      '/api/v1/admin/users/u1/unblock',
      '/api/v1/admin/users/u1/reset-name',
    ]);
    expect(adapter.requests[0].data,
        <String, dynamic>{'reason': 'извинился', 'restore_reviews': true});
    expect(adapter.requests[1].data,
        <String, dynamic>{'reason': 'простили', 'restore_reviews': false});
    expect(adapter.requests[2].data, <String, dynamic>{'reason': 'мат в имени'});
  });

  test('отказ сервера доходит до модератора его словами', () async {
    const refusal = 'У этого партнёра есть карточки заведений. Его блокировка '
        'решает и их судьбу — это отдельное решение, этой кнопкой его не '
        'заблокировать';
    // Конверт ровно в той форме, в какой его пишет errorHandler сервера.
    final adapter = _StubAdapter((_) => _json(<String, dynamic>{
          'success': false,
          'message': refusal,
          'error': <String, dynamic>{'code': 'PARTNER_WITH_ESTABLISHMENTS'},
          'timestamp': '2026-10-17T12:00:00.000Z',
        }, status: 409));

    Object? caught;
    try {
      await serviceOver(adapter).block('u1', reason: 'мусор');
    } catch (e) {
      caught = e;
    }

    expect(caught, isA<DioException>());
    expect(describeUserActionError(caught!), refusal);
  });
}
