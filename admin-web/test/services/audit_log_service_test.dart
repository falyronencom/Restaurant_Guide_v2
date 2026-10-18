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

  /// Ответ сервера; по умолчанию — пустая страница.
  Map<String, dynamic> body = <String, dynamic>{
    'data': <dynamic>[],
    'meta': <String, dynamic>{'total': 0, 'page': 1, 'pages': 1},
  };

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      jsonEncode(body),
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

  test('строка журнала разбирается по ключам сервера', () async {
    // Экран журнала тестируется на записях, собранных конструктором, — разбор
    // ответа там не исполняется, и выпавший ключ вернул бы «исполнитель не
    // указан» и машинный тип объекта молча. Строки — как их отдаёт
    // auditLogModel.getAuditLogEntries (администратору — с именем и почтой
    // исполнителя; просмотрщику — без них, с ролью), конверт —
    // auditLogController. Данные приостановки — как их пишет adminService.
    Map<String, dynamic> row({
      required String id,
      String? adminName,
      String? adminEmail,
    }) =>
        <String, dynamic>{
          'id': id,
          'action': 'suspend',
          'entity_type': 'establishment',
          'entity_id': '1a2b3c4d-0000-4000-8000-000000000000',
          'old_data': <String, dynamic>{'status': 'active'},
          'new_data': <String, dynamic>{
            'status': 'suspended',
            'reason': 'Жалобы посетителей',
          },
          'created_at': '2026-10-17T12:00:00.000Z',
          'admin_name': adminName,
          'admin_email': adminEmail,
          'actor_role': 'admin',
          'summary': 'Приостановлено заведение',
          'entity_context': <String, dynamic>{
            'name': 'Васильки',
            'city': 'Минск',
          },
        };
    adapter.body = <String, dynamic>{
      'success': true,
      'data': <dynamic>[
        row(
          id: '5d1c2b3a-0000-4000-8000-000000000001',
          adminName: 'Всеволод',
          adminEmail: 'vsevolod@nirivio.by',
        ),
        row(id: '5d1c2b3a-0000-4000-8000-000000000002'),
      ],
      'meta': <String, dynamic>{'total': 2, 'page': 1, 'pages': 1},
    };

    final page = await service.getAuditLog();
    final [admin, viewer] = page.entries;

    expect(admin.action, 'suspend');
    expect(admin.summary, 'Приостановлено заведение');
    expect(admin.entityType, 'establishment');
    expect(admin.entityId, '1a2b3c4d-0000-4000-8000-000000000000');
    expect(admin.adminName, 'Всеволод');
    expect(admin.adminEmail, 'vsevolod@nirivio.by');
    expect(admin.actorRole, 'admin');
    expect(admin.entityContext,
        <String, dynamic>{'name': 'Васильки', 'city': 'Минск'});
    expect(admin.oldData, <String, dynamic>{'status': 'active'});
    expect(admin.newData, <String, dynamic>{
      'status': 'suspended',
      'reason': 'Жалобы посетителей',
    });
    expect(admin.createdAt, DateTime.utc(2026, 10, 17, 12));
    // Просмотрщику — роль вместо имени.
    expect(viewer.adminName, isNull);
    expect(viewer.adminEmail, isNull);
    expect(viewer.actorRole, 'admin');
    expect(page.total, 2);
  });

  test('пустые фильтры в запрос не попадают', () async {
    await service.getAuditLog(action: '', entityType: '');

    expect(lastQuery().containsKey('action'), isFalse);
    expect(lastQuery().containsKey('entity_type'), isFalse);
    expect(lastQuery().containsKey('from'), isFalse);
    expect(lastQuery()['page'], 1);
  });
}
