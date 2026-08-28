import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

// Что уходит в `GET /api/v1/admin/menu-items/flagged` и что разбирается из
// ответа.
//
// Тест нужен именно на этом уровне: провайдер и экран работают с уже собранным
// `FlaggedMenuItemsResponse`, поэтому разбор `meta` не исполняется НИ ОДНИМ из
// их тестов. Переименуй `counts` в `count` — и подпись «в очереди ещё 12»
// замолчит, а тридцать тестов останутся зелёными.

class _StubAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = <RequestOptions>[];
  Map<String, dynamic> payload = <String, dynamic>{};

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      jsonEncode(payload),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Строка ответа в том виде, в каком её отдаёт `menuItemModel.getFlaggedItems`:
/// NUMERIC приезжает СТРОКОЙ, массивы — списками, метка времени с `Z`.
Map<String, dynamic> _row({
  String id = 'item-1',
  bool hidden = false,
}) {
  return <String, dynamic>{
    'id': id,
    'establishment_id': 'est-1',
    'media_id': 'media-1',
    'item_name': 'Драники з мачанкай',
    'price_byn': '1450.00',
    'category_raw': 'Гарачыя стравы',
    'confidence': '0.87',
    'sanity_flag': <String, dynamic>{
      'reason': 'price_above_threshold',
      'details': <String, dynamic>{'price': 1450, 'threshold': 1000},
    },
    'is_hidden_by_admin': hidden,
    'hidden_reason': hidden ? 'цена проверена' : null,
    'created_at': '2026-07-14T09:41:00.000Z',
    'establishment_name': 'Кухмістр',
    'establishment_city': 'Минск',
    'establishment_status': 'suspended',
    'establishment_categories': <String>['Ресторан'],
    'establishment_cuisines': <String>['Народная'],
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // Перехватчик читает access_token из защищённого хранилища, а его канал в
  // тестах не зарегистрирован. Пустой ответ = токена нет.
  const MethodChannel storageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  late _StubAdapter adapter;
  late AdminMenuItemService service;

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, (call) async => null);

    adapter = _StubAdapter();
    final Dio dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    service = AdminMenuItemService.withClient(ApiClient.withDio(dio));
  });

  group('запрос', () {
    test('фильтры уходят параметрами, пустые не уходят вовсе', () async {
      adapter.payload = <String, dynamic>{
        'data': <dynamic>[],
        'meta': <String, dynamic>{'total': 0, 'page': 1, 'pages': 1},
      };

      await service.getFlaggedItems(
        page: 2,
        perPage: 20,
        reason: 'low_confidence',
        visibility: 'visible',
        city: 'Гродно',
        search: '  драники  ',
      );

      final Map<String, dynamic> query = adapter.requests.single.queryParameters;
      expect(query['page'], 2);
      expect(query['per_page'], 20);
      expect(query['reason'], 'low_confidence');
      expect(query['visibility'], 'visible');
      expect(query['city'], 'Гродно');
      // Обрезка на клиенте — не косметика: сервер отвергает повторённый
      // параметр, но пробельный принял бы как значение.
      expect(query['search'], 'драники');
    });

    test('пустые фильтры не превращаются в пустые параметры', () async {
      adapter.payload = <String, dynamic>{
        'data': <dynamic>[],
        'meta': <String, dynamic>{'total': 0, 'page': 1, 'pages': 1},
      };

      await service.getFlaggedItems(reason: '', city: '', search: '   ');

      final Map<String, dynamic> query = adapter.requests.single.queryParameters;
      expect(query.containsKey('reason'), isFalse);
      expect(query.containsKey('city'), isFalse);
      expect(query.containsKey('search'), isFalse);
    });
  });

  group('разбор ответа', () {
    test('мета разбирается целиком, включая обе половины счётчиков', () async {
      adapter.payload = <String, dynamic>{
        'data': <dynamic>[_row()],
        'meta': <String, dynamic>{
          'total': 12,
          'counts': <String, dynamic>{'visible': 12, 'hidden': 8},
          'page': 2,
          'per_page': 20,
          'pages': 3,
          'cities': <String>['Гродно', 'Минск'],
          'reasons': <String>['price_below_threshold', 'price_above_threshold'],
        },
      };

      final response = await service.getFlaggedItems();

      expect(response.total, 12);
      expect(response.visibleCount, 12);
      expect(response.hiddenCount, 8);
      expect(response.page, 2);
      expect(response.pages, 3);
      expect(response.perPage, 20);
      expect(response.cities, <String>['Гродно', 'Минск']);
      expect(response.reasons,
          <String>['price_below_threshold', 'price_above_threshold']);
    });

    test('строка разбирается со всеми полями проекции', () async {
      adapter.payload = <String, dynamic>{
        'data': <dynamic>[_row()],
        'meta': <String, dynamic>{'total': 1, 'page': 1, 'pages': 1},
      };

      final item = (await service.getFlaggedItems()).items.single;

      // NUMERIC приходит строкой — без разбора цена и уверенность стали бы null,
      // и факт-грид написал бы «не распозналась» у распознанного блюда.
      expect(item.priceByn, 1450.0);
      expect(item.confidence, 0.87);
      expect(item.itemName, 'Драники з мачанкай');
      expect(item.establishmentStatus, 'suspended');
      // Категории и кухни нужны иконке карточки.
      expect(item.establishmentCategories, <String>['Ресторан']);
      expect(item.establishmentCuisines, <String>['Народная']);
      expect(item.sanityReason, 'price_above_threshold');
      expect(item.createdAt.toUtc(), DateTime.utc(2026, 7, 14, 9, 41));
    });

    test('отсутствующие counts оставляют счётчики пустыми, а не нулями',
        () async {
      adapter.payload = <String, dynamic>{
        'data': <dynamic>[_row()],
        'meta': <String, dynamic>{'total': 1, 'page': 1, 'pages': 1},
      };

      final response = await service.getFlaggedItems();

      // Ноль означал бы «скрытых нет» — утверждение, которого сервер не делал.
      // Подпись экрана на null просто промолчит про вторую половину.
      expect(response.visibleCount, isNull);
      expect(response.hiddenCount, isNull);
    });

    test('пустые массивы и null в необязательных полях не роняют разбор',
        () async {
      final Map<String, dynamic> row = _row()
        ..['establishment_categories'] = null
        ..['establishment_cuisines'] = null
        ..['establishment_city'] = null
        ..['price_byn'] = null
        ..['sanity_flag'] = null;

      adapter.payload = <String, dynamic>{
        'data': <dynamic>[row],
        'meta': <String, dynamic>{'total': 1, 'page': 1, 'pages': 1},
      };

      final item = (await service.getFlaggedItems()).items.single;

      expect(item.establishmentCategories, isEmpty);
      expect(item.establishmentCuisines, isEmpty);
      expect(item.establishmentCity, isNull);
      expect(item.priceByn, isNull);
      expect(item.sanityReason, isNull);
    });
  });
}
