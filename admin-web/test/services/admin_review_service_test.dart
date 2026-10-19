import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

// Сервис «Отзывов» ниже своей границы: как разбирается конверт списка. Экран
// отзывов в своих тестах получает готовый AdminReviewListResponse от
// подставного сервиса, поэтому подпись «… · 12 скрыто · средний 4,3»
// проверена там на числах, собранных тестом, а разбор `meta` сервера не видел
// никто: выпавший ключ молча убрал бы «скрыто» и «средний» из подписи.
//
// Конверт — adminReviewController.getReviews (`{ success, data, meta }`),
// `meta` — adminReviewService.getReviews.

class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.body);

  final Map<String, dynamic> body;
  final List<RequestOptions> requests = <RequestOptions>[];

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

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, (call) async => null);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, null);
  });

  test('список: счётчик, скрытые и средняя — из meta сервера', () async {
    final adapter = _StubAdapter(<String, dynamic>{
      'success': true,
      'data': <dynamic>[],
      'meta': <String, dynamic>{
        'total': 180,
        'hidden': 3,
        'average_rating': 1.6,
        'page': 1,
        'per_page': 20,
        'pages': 9,
      },
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    final service = AdminReviewService.withClient(ApiClient.withDio(dio));

    final page = await service.getReviews(rating: 2);

    expect(adapter.requests.single.path, '/api/v1/admin/reviews');
    expect(page.total, 180);
    expect(page.hidden, 3);
    expect(page.averageRating, 1.6);
    expect(page.pages, 9);
  });
}
