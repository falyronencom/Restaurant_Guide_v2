import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Карточка заведения и геолокация (хвост 1 «Избранного», 17.10.2026).
///
/// **Что было.** Карточка при каждом открытии звала `fetchUserLocation()`:
/// тот без разрешения показывал системный вопрос (пока человек дважды не
/// откажет — дальше Android считает отказ окончательным, и прогулка прячет
/// чип «Пешком»), а с разрешением переводил сортировку поиска с «по
/// рейтингу» на «по расстоянию» — даже выбранную человеком.
///
/// **Как проверяется.** Подставная платформа Geolocator записывает, что у
/// неё спросили; карточка — настоящая, данные — со стенда сети.
class _FakeGeolocator extends GeolocatorPlatform {
  _FakeGeolocator({required this.permission, this.serviceEnabled = true});

  final LocationPermission permission;
  final bool serviceEnabled;
  final List<String> calls = [];

  /// В двух сотых градуса к северу от места: ≈ 2,0 км.
  static final _here = Position(
    latitude: 53.9023 + 0.018,
    longitude: 27.5619,
    timestamp: DateTime(2026, 10, 17),
    accuracy: 10,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
  );

  @override
  Future<bool> isLocationServiceEnabled() async {
    calls.add('service');
    return serviceEnabled;
  }

  @override
  Future<LocationPermission> checkPermission() async {
    calls.add('check');
    return permission;
  }

  @override
  Future<LocationPermission> requestPermission() async {
    calls.add('request');
    return LocationPermission.whileInUse;
  }

  @override
  Future<Position?> getLastKnownPosition(
      {bool forceLocationManager = false}) async {
    calls.add('last');
    return _here;
  }

  @override
  Future<Position> getCurrentPosition(
      {LocationSettings? locationSettings}) async {
    calls.add('current');
    return _here;
  }
}

void main() {
  const id = '11111111-1111-4111-8111-111111111111';

  setUp(() {
    installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/search/establishments/$id') {
        // Без фото: сетевая картинка в тесте не работает. Координаты есть —
        // от них карточка считает расстояние, сервер его не прислал.
        final row = establishmentRow(id: id)..['primary_image_url'] = null;
        return jsonBody({'success': true, 'data': row});
      }
      if (path == '/api/v1/establishments/$id/reviews') {
        return jsonBody(reviewsEnvelope(reviews: []));
      }
      return jsonBody({'success': false}, status: 404);
    });
    // С координатами карточка строит мини-карту — платформенный вид.
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, (_) async => null);
    addTearDown(() => messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, null));
  });

  _FakeGeolocator installGeolocator(_FakeGeolocator platform) {
    final previous = GeolocatorPlatform.instance;
    GeolocatorPlatform.instance = platform;
    addTearDown(() => GeolocatorPlatform.instance = previous);
    return platform;
  }

  /// Карточка открыта; поиск до неё — «по рейтингу», выбранный человеком.
  Future<EstablishmentsProvider> openCard(WidgetTester tester) async {
    final establishments = EstablishmentsProvider()
      ..setSort(SortOption.rating);
    expect(establishments.currentSort, SortOption.rating,
        reason: 'предпосылка');
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
        ChangeNotifierProvider<EstablishmentsProvider>.value(
            value: establishments),
        ChangeNotifierProvider<BookingProvider>(
            create: (_) => BookingProvider()),
      ],
      child: const MaterialApp(
        home: EstablishmentDetailScreen(establishmentId: id),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Васильки'), findsWidgets,
        reason: 'карточка не загрузилась');
    return establishments;
  }

  testWidgets(
      'разрешения нет: системного вопроса нет, сортировка та же, '
      'расстояния нет', (tester) async {
    final platform = installGeolocator(
        _FakeGeolocator(permission: LocationPermission.denied));

    final establishments = await openCard(tester);

    expect(platform.calls, isNot(contains('request')),
        reason: 'карточка не спрашивает разрешение сама');
    expect(establishments.currentSort, SortOption.rating);
    expect(establishments.hasRealLocation, isFalse);
    expect(find.textContaining('от вас'), findsNothing);
  });

  // «Дано» — оба ответа системы: «при использовании» и «всегда» (iPhone, у
  // кого разрешено фоновое определение).
  for (final granted in const [
    LocationPermission.whileInUse,
    LocationPermission.always,
  ]) {
    testWidgets(
        'разрешение дано (${granted.name}): позиция без вопроса, «2,0 км от '
        'вас»; сортировка «по рейтингу» остаётся', (tester) async {
      final platform = installGeolocator(_FakeGeolocator(permission: granted));

      final establishments = await openCard(tester);

      expect(platform.calls, isNot(contains('request')));
      expect(establishments.hasRealLocation, isTrue);
      expect(find.text('2,0 км от вас'), findsOneWidget);
      expect(establishments.currentSort, SortOption.rating,
          reason: 'открыть карточку — не выбрать сортировку «по расстоянию»');
    });
  }

  testWidgets(
      'геолокация выключена: позицию не спрашивают, расстояния нет',
      (tester) async {
    final platform = installGeolocator(_FakeGeolocator(
        permission: LocationPermission.whileInUse, serviceEnabled: false));

    final establishments = await openCard(tester);

    expect(platform.calls, isNot(anyOf(contains('last'), contains('current'))));
    expect(platform.calls, isNot(contains('request')));
    expect(establishments.hasRealLocation, isFalse);
    expect(find.textContaining('от вас'), findsNothing);
  });
}
