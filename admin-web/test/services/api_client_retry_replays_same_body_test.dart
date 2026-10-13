import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

/// Повтор при 5xx предъявляет тот же запрос — тот же путь и то же тело.
///
/// Клиент панели повторяет любой запрос, на который сервер ответил 5xx
/// (окно деплоя Railway, 502 от edge). Для действия модератора это безопасно
/// только если запрос означает одно и то же при повторе: «скрыть отзыв» с
/// явным `is_visible: false`, а не переключение (пакет 1 находок критиков,
/// пункт 2 — Codex C-10; серверная половина — явное состояние в
/// POST /admin/reviews/:id/visibility). Здесь закреплена клиентская половина:
/// повтор уносит то же тело, и ответ второго запроса возвращается вызывающему.
///
/// Транспорт подставной; хранилище — карта в памяти за каналом плагина.
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.respond);

  final ResponseBody Function(RequestOptions options, int attempt) respond;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (requests.length > 8) {
      throw StateError('транспорт зациклился: ${requests.length} запросов');
    }
    return respond(options, requests.length);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Map<String, dynamic> body, int status) =>
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
  final storage = <String, String>{'access_token': 'access-0001'};

  setUp(() {
    SessionEvents.debugReset();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, (call) async {
      final args = call.arguments as Map?;
      switch (call.method) {
        case 'read':
          return storage[args!['key'] as String];
        case 'write':
          storage[args!['key'] as String] = args['value'] as String;
          return null;
        case 'delete':
          storage.remove(args!['key'] as String);
          return null;
        case 'containsKey':
          return storage.containsKey(args!['key'] as String);
        case 'readAll':
          return Map<String, String>.of(storage);
        case 'deleteAll':
          storage.clear();
          return null;
      }
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, null);
  });

  ApiClient client(_StubAdapter adapter) {
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    return ApiClient.withDio(dio);
  }

  test('502, затем 200: оба запроса — тот же путь и то же тело {is_visible: false}',
      () async {
    final adapter = _StubAdapter((options, attempt) {
      if (attempt == 1) {
        return _json({'success': false, 'error': {'code': 'BAD_GATEWAY'}}, 502);
      }
      return _json({
        'success': true,
        'data': {'id': 'r1', 'is_visible': false, 'changed': true},
      }, 200);
    });
    final api = client(adapter);

    final response = await api.post(
      '/api/v1/admin/reviews/r1/visibility',
      data: <String, dynamic>{'is_visible': false},
    );

    expect(response.statusCode, 200);
    expect(adapter.requests, hasLength(2));
    for (final request in adapter.requests) {
      expect(request.method, 'POST');
      expect(request.uri.path, '/api/v1/admin/reviews/r1/visibility');
      expect(request.headers['Authorization'], 'Bearer access-0001');
      expect(request.data, <String, dynamic>{'is_visible': false},
          reason: 'повтор обязан просить то же состояние — иначе повтор '
              'переключателя возвращал бы решение модератора назад');
    }
  });
}
