import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/services/quality_health_service.dart';

/// Подставной транспорт: Dio отдаёт заготовленный ответ вместо сети.
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;
  final List<RequestOptions> requests = [];

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

  // Перехватчик запросов читает access_token из защищённого хранилища, а его
  // канал в тестах не зарегистрирован. Пустой ответ = токена нет.
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

  ApiClient stubClient(_StubAdapter adapter) {
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    return ApiClient.withDio(dio);
  }

  group('Фабрика и конструктор разведены', () {
    test('ApiClient() — синглтон, ApiClient.withDio — отдельный экземпляр', () {
      expect(identical(ApiClient(), ApiClient()), isTrue);
      expect(identical(ApiClient.withDio(Dio()), ApiClient()), isFalse);
    });

    test('сервисы: фабрика синглтонная, withClient — новый экземпляр', () {
      final client = ApiClient.withDio(Dio());

      expect(identical(AuthService(), AuthService()), isTrue);
      expect(identical(AnalyticsService(), AnalyticsService()), isTrue);

      // Ради этого всё и делалось: экземпляр сервиса можно получить не только
      // из синглтона, а значит — собрать его поверх подставного транспорта.
      expect(identical(AuthService.withClient(client), AuthService()), isFalse);
      expect(
        identical(AnalyticsService.withClient(client), AnalyticsService()),
        isFalse,
      );
      expect(
        identical(ModerationService.withClient(client), ModerationService()),
        isFalse,
      );
      expect(
        identical(
          AdminReviewService.withClient(client),
          AdminReviewService(),
        ),
        isFalse,
      );
      expect(
        identical(
          AdminMenuItemService.withClient(client),
          AdminMenuItemService(),
        ),
        isFalse,
      );
      expect(
        identical(AuditLogService.withClient(client), AuditLogService()),
        isFalse,
      );
      expect(
        identical(
          QualityHealthService.withClient(client),
          QualityHealthService(),
        ),
        isFalse,
      );
    });
  });

  group('Сервис поверх подставного транспорта', () {
    test('getOverview разбирает конверт data и шлёт period в запрос',
        () async {
      final adapter = _StubAdapter(
        (_) => _json({
          'success': true,
          'data': {
            'users': {'total': 742, 'new_in_period': 96, 'change_percent': 12.4},
            'establishments': {
              'total': 140,
              'active': 128,
              'pending': 3,
              'suspended': 9,
              'new_in_period': 11,
            },
            'reviews': {
              'total': 906,
              'new_in_period': 74,
              'average_rating': 4.4,
            },
            'moderation': {'pending_count': 5, 'actions_in_period': 23},
          },
        }),
      );

      final service = AnalyticsService.withClient(stubClient(adapter));
      final overview = await service.getOverview(period: '7d');

      expect(overview.users.total, 742);
      expect(overview.users.changePercent, 12.4);
      expect(overview.establishments.pending, 3);
      expect(overview.reviews.averageRating, 4.4);
      expect(overview.moderation.pendingCount, 5);

      final sent = adapter.requests.single;
      expect(sent.path, '/api/v1/admin/analytics/overview');
      expect(sent.queryParameters['period'], '7d');
      // Диапазон и период взаимоисключающи: раз период задан, дат быть не
      // должно.
      expect(sent.queryParameters.containsKey('from'), isFalse);
      expect(sent.queryParameters.containsKey('to'), isFalse);
    });

    test('явный диапазон вытесняет период', () async {
      final adapter = _StubAdapter(
        (_) => _json({
          'data': {
            'registration_timeline': <dynamic>[],
            'role_distribution': <dynamic>[],
            'total': 0,
            'new_in_period': 0,
            'aggregation': 'week',
          },
        }),
      );

      final service = AnalyticsService.withClient(stubClient(adapter));
      await service.getUsersAnalytics(from: '2026-08-01', to: '2026-08-19');

      final sent = adapter.requests.single;
      expect(sent.queryParameters['from'], '2026-08-01');
      expect(sent.queryParameters['to'], '2026-08-19');
      expect(sent.queryParameters.containsKey('period'), isFalse);
    });

    test('ошибка сервера доходит до вызывающего человеческим текстом',
        () async {
      final adapter = _StubAdapter(
        (_) => _json(
          {
            'error': {'message': 'Доступ запрещён'},
          },
          status: 403,
        ),
      );

      final service = AnalyticsService.withClient(stubClient(adapter));

      await expectLater(
        service.getOverview(),
        throwsA(
          isA<DioException>().having(
            (e) => e.error,
            'error',
            'Доступ запрещён',
          ),
        ),
      );
    });
  });
}
