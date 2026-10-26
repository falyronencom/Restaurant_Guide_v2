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

    // Вкладки «Заведения» и «Отзывы» тестируются на фейке сервиса: адрес
    // запроса и разбор ответа не видел никто. Форма ответа — как её собирает
    // бэкенд: `analyticsService.js` (getEstablishmentsAnalytics,
    // getReviewsAnalytics, periodBounds) и `analyticsModel.js` (поля строк
    // распределений). Числа разные — перестановка ключей не прошла бы.
    test('getEstablishmentsAnalytics: свой адрес и ответ в форме сервера',
        () async {
      final adapter = _StubAdapter(
        (_) => _json({
          'success': true,
          'data': {
            'creation_timeline': <dynamic>[
              {'date': '2026-08-08', 'count': 3},
              {'date': '2026-08-09', 'count': 5},
            ],
            'status_distribution': <dynamic>[
              {'status': 'active', 'count': 365},
              {'status': 'pending', 'count': 7},
            ],
            'city_distribution': <dynamic>[
              {'city': 'Минск', 'count': 214},
            ],
            'category_distribution': <dynamic>[
              {'category': 'Ресторан', 'count': 96},
            ],
            'total': 412,
            'active': 360,
            'pending': 9,
            'new_in_period': 11,
            'change_percent': 22.2,
            'aggregation': 'week',
            'period': {
              'start': '2026-07-12T00:00:00.000Z',
              'end': '2026-08-11T00:00:00.000Z',
            },
          },
        }),
      );

      final service = AnalyticsService.withClient(stubClient(adapter));
      final data = await service.getEstablishmentsAnalytics(period: '90d');

      final sent = adapter.requests.single;
      expect(sent.path, '/api/v1/admin/analytics/establishments');
      expect(sent.queryParameters, <String, dynamic>{'period': '90d'});

      expect(data.creationTimeline.map((p) => '${p.date}:${p.count}').toList(),
          <String>['2026-08-08:3', '2026-08-09:5']);
      expect(data.statusDistribution.map((d) => '${d.label}:${d.count}').toList(),
          <String>['active:365', 'pending:7']);
      expect(data.cityDistribution.single.label, 'Минск');
      expect(data.cityDistribution.single.count, 214);
      expect(data.categoryDistribution.single.label, 'Ресторан');
      expect(data.categoryDistribution.single.count, 96);
      expect(data.total, 412);
      expect(data.active, 360);
      expect(data.pending, 9);
      expect(data.newInPeriod, 11);
      expect(data.changePercent, 22.2);
      expect(data.aggregation, 'week');
      expect(data.period?.start, DateTime.utc(2026, 7, 12));
      expect(data.period?.endExclusive, DateTime.utc(2026, 8, 11));
    });

    test('getReviewsAnalytics: свой адрес и ответ в форме сервера', () async {
      final adapter = _StubAdapter(
        (_) => _json({
          'success': true,
          'data': {
            // Окно больше 90 суток — столбец месячный (`getAggregationType`).
            'review_timeline': <dynamic>[
              {'date': '2026-07-01', 'count': 12, 'average_rating': 4.4},
              {'date': '2026-08-01', 'count': 7, 'average_rating': 3.9},
            ],
            'rating_distribution': <dynamic>[
              {'rating': 1, 'count': 20, 'percentage': 2.0},
              {'rating': 5, 'count': 980, 'percentage': 98.0},
            ],
            'response_stats': {
              'total_reviews': 1240,
              'total_with_response': 287,
              // Доля, а не проценты: `ROUND(… / COUNT(*), 4)` в
              // `analyticsModel.js` (getResponseStats).
              'response_rate': 0.2315,
              'avg_response_time_hours': 5.5,
            },
            'total': 1250,
            'new_in_period': 74,
            'change_percent': -4.0,
            'average_rating': 4.6,
            'aggregation': 'month',
            'period': {
              'start': '2026-05-01T00:00:00.000Z',
              'end': '2026-08-20T00:00:00.000Z',
            },
          },
        }),
      );

      final service = AnalyticsService.withClient(stubClient(adapter));
      final data = await service.getReviewsAnalytics(
          from: '2026-05-01', to: '2026-08-19');

      final sent = adapter.requests.single;
      expect(sent.path, '/api/v1/admin/analytics/reviews');
      expect(sent.queryParameters,
          <String, dynamic>{'from': '2026-05-01', 'to': '2026-08-19'});

      expect(
          data.reviewTimeline
              .map((p) => '${p.date}:${p.count}:${p.averageRating}')
              .toList(),
          <String>['2026-07-01:12:4.4', '2026-08-01:7:3.9']);
      expect(
          data.ratingDistribution
              .map((r) => '${r.rating}:${r.count}:${r.percentage}')
              .toList(),
          <String>['1:20:2.0', '5:980:98.0']);
      expect(data.responseStats.totalReviews, 1240);
      expect(data.responseStats.totalWithResponse, 287);
      expect(data.responseStats.responseRate, 0.2315);
      expect(data.responseStats.avgResponseTimeHours, 5.5);
      expect(data.total, 1250);
      expect(data.newInPeriod, 74);
      expect(data.changePercent, -4.0);
      expect(data.averageRating, 4.6);
      expect(data.aggregation, 'month');
      expect(data.period?.start, DateTime.utc(2026, 5, 1));
      expect(data.period?.endExclusive, DateTime.utc(2026, 8, 20));
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
