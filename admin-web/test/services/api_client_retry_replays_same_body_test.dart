import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

/// Повтор при 5xx: чтение повторяется тем же запросом, действие — нет.
///
/// Клиент панели повторял любой запрос, на который сервер ответил 5xx (окно
/// деплоя Railway, 502 от edge). Для действия модератора это было безопасно
/// лишь наполовину: «скрыть отзыв» несёт явное `is_visible: false` (пакет 1
/// находок критиков, пункт 2 — Codex C-10), но 502 приходит и тогда, когда
/// сервер действие уже выполнил, — повтор получал «уже сделано», и панель
/// показывала сбой по сработавшему действию. С 20.10.2026 (проход по панели
/// модератора, пункты A1-16 и A3-28) действия не повторяются вовсе; чтение
/// повторяется тем же путём и той же строкой запроса.
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

  test('502 на действии: запрос уходит один раз, модератор получает отказ',
      () async {
    // Сервер мог уже выполнить действие: повтор получил бы «уже скрыт» и
    // показал бы сбой по сработавшему действию.
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

    final error = await api
        .post(
          '/api/v1/admin/reviews/r1/visibility',
          data: <String, dynamic>{'is_visible': false},
        )
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(adapter.requests, hasLength(1),
        reason: 'действие при 5xx не повторяется автоматически');
    expect(error, isA<DioException>());
    expect((error as DioException).response?.statusCode, 502);
    expect(error.error, kServerFailurePhrase,
        reason: 'отказ доходит с русской фразой для модератора');
  });

  for (final method in <String>['PATCH', 'PUT', 'DELETE']) {
    test('502 на $method: без повтора', () async {
      final adapter = _StubAdapter((options, attempt) =>
          _json({'success': false, 'error': {'code': 'BAD_GATEWAY'}}, 502));
      final api = client(adapter);

      final request = switch (method) {
        'PATCH' => api.patch('/api/v1/admin/x', data: <String, dynamic>{}),
        'PUT' => api.put('/api/v1/admin/x', data: <String, dynamic>{}),
        _ => api.delete('/api/v1/admin/x'),
      };
      await request.then<Object?>((_) => null, onError: (Object e) => e);

      expect(adapter.requests, hasLength(1));
      expect(adapter.requests.single.method, method);
    });
  }

  test('упорный 502 на чтении: отказ последнего повтора — с русской фразой',
      () async {
    // До 20.10 после повторов отдавался ИСХОДНЫЙ отказ — без фразы, и
    // провайдер печатал общую «Произошла ошибка».
    final adapter = _StubAdapter((options, attempt) => _json({
          'success': false,
          'message': 'Сбой на сервере. Попробуйте ещё раз через минуту.',
          'error': {'code': 'INTERNAL_ERROR'},
        }, 503));
    final api = client(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .timeout(const Duration(seconds: 20))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(adapter.requests, hasLength(4));
    expect((error as DioException).error,
        'Сбой на сервере. Попробуйте ещё раз через минуту.');
  });

  test('502, затем 200: повтор чтения уносит ту же строку запроса', () async {
    // «Тот же запрос» — и у чтения: фильтры и страница живут в строке
    // запроса, и повтор без неё вернул бы первую страницу без отбора — молча.
    final adapter = _StubAdapter((options, attempt) {
      if (attempt == 1) {
        return _json({'success': false, 'error': {'code': 'BAD_GATEWAY'}}, 502);
      }
      return _json({'success': true, 'data': <dynamic>[]}, 200);
    });
    final api = client(adapter);

    final response = await api.get(
      '/api/v1/admin/reviews',
      queryParameters: <String, dynamic>{'page': 3, 'status': 'hidden'},
    );

    expect(response.statusCode, 200);
    expect(adapter.requests, hasLength(2));
    for (final request in adapter.requests) {
      expect(request.method, 'GET');
      expect(request.uri.path, '/api/v1/admin/reviews');
      expect(request.uri.queryParameters,
          <String, String>{'page': '3', 'status': 'hidden'},
          reason: 'повтор потерял фильтры и страницу');
    }
  });
}
