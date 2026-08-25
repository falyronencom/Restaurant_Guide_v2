import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';

// Что именно уходит в `GET /api/v1/admin/audit-log`.
//
// Границы периода — не косметика: `created_at` в `audit_log` объявлена
// `timestamp without time zone`, и хранится там стенное время UTC. Отправив
// местное время без указания зоны, клиент сравнил бы минское стенное с
// UTC-стенным и сдвинул окно на три часа — молча и одинаково в проде и
// локально, потому что сдвиг задаёт часовой пояс БРАУЗЕРА модератора.

class _StubAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'data': <dynamic>[],
        'meta': <String, dynamic>{'total': 0, 'page': 1, 'pages': 1},
      }),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // Перехватчик читает access_token из защищённого хранилища, а его канал в
  // тестах не зарегистрирован. Пустой ответ = токена нет.
  const storageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  late _StubAdapter adapter;
  late AuditLogService service;

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, (call) async => null);

    adapter = _StubAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    service = AuditLogService.withClient(ApiClient.withDio(dio));
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, null);
  });

  Map<String, dynamic> lastQuery() => adapter.requests.last.queryParameters;

  test('границы периода уходят в UTC, а не в местном времени', () async {
    // Полдень по Минску — это 09:00 UTC. Именно 09:00 и должно уехать.
    final localNoon = DateTime(2026, 7, 14, 12).toUtc().toLocal();

    await service.getAuditLog(from: localNoon, to: localNoon);

    final from = lastQuery()['from'] as String;
    expect(from, endsWith('Z'), reason: 'без Z Postgres возьмёт строку как есть');
    expect(DateTime.parse(from).isUtc, isTrue);
    expect(DateTime.parse(from), localNoon.toUtc());
    expect(DateTime.parse(lastQuery()['to'] as String), localNoon.toUtc());
  });

  test('тип объекта уходит как entity_type', () async {
    await service.getAuditLog(entityType: 'review');
    expect(lastQuery()['entity_type'], 'review');
  });

  test('пустые фильтры в запрос не попадают', () async {
    await service.getAuditLog(action: '', entityType: '');

    expect(lastQuery().containsKey('action'), isFalse);
    expect(lastQuery().containsKey('entity_type'), isFalse);
    expect(lastQuery().containsKey('from'), isFalse);
    expect(lastQuery()['page'], 1);
  });
}
