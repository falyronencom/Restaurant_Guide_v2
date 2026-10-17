// Прогулка на экране «Избранного» (этап 4): подпись обложки «рядом · N из
// M», прогулка не запоминается между заходами (Р5), но переживает карточку
// заведения поверх (хвост 2, 17.10.2026), и не ходит в сеть.
//
// Экран целиком: места приходят через стенд сети, как с сервера; позиция —
// подставной источник. Модель кадров та же, что в favorites_walk_test.dart:
// после события источника — pump(1 мс).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/favorites/favorites_screen.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_map.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_view_mode.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';
import 'package:restaurant_guide_mobile/widgets/map/walk_controls.dart';
import 'package:restaurant_guide_mobile/widgets/selected_tab_scope.dart';

import '../support/fake_position_source.dart';
import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Вход задаётся подменой одного признака, как в favorites_screen_test.
class _Auth extends AuthProvider {
  @override
  bool get isAuthenticated => true;
}

const GeoPoint _me = (latitude: 53.9000, longitude: 27.5600);

/// Платформа Geolocator, которая на любой вопрос отвечает «вот позиция».
/// Ею пользуется LocationService — путь `fetchUserLocation` провайдера.
class _AlwaysHereGeolocator extends GeolocatorPlatform {
  static final _here = Position(
    latitude: 53.95,
    longitude: 27.6,
    timestamp: DateTime(2026, 10, 17),
    accuracy: 5,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
  );

  @override
  Future<bool> isLocationServiceEnabled() async => true;

  @override
  Future<LocationPermission> checkPermission() async =>
      LocationPermission.whileInUse;

  @override
  Future<Position?> getLastKnownPosition(
          {bool forceLocationManager = false}) async =>
      _here;

  @override
  Future<Position> getCurrentPosition(
          {LocationSettings? locationSettings}) async =>
      _here;
}

/// Строка избранного в [meters] к северу от человека; без [meters] — без
/// координат. Без фото: плейсхолдер CachedNetworkImage крутится вечно.
Map<String, dynamic> _row(String id, {double? meters}) {
  final row = favoriteRow(id: id, name: 'Место $id');
  final at = meters == null ? null : pointAtDistance(_me, meters, 0);
  row['establishment_latitude'] = at?.latitude;
  row['establishment_longitude'] = at?.longitude;
  row['establishment_primary_image'] = null;
  return row;
}

/// Три места в круге 15 минут, одно в 5 км, одно без координат: N = 3,
/// M = 5.
final _rows = [
  _row('id-1', meters: 200),
  _row('id-2', meters: 400),
  _row('id-3', meters: 600),
  _row('id-4', meters: 5000),
  _row('id-5'),
];

final _walkChip = find.widgetWithText(MapFilterChip, 'Пешком');

Finder _option(String label) =>
    find.descendant(of: find.byType(BottomSheet), matching: find.text(label));

void main() {
  late StubAdapter wire;
  late FakePositionSource source;

  setUp(() {
    wire =
        installWireStand((_) => jsonBody(favoritesEnvelope(favorites: _rows)));
    SharedPreferences.setMockInitialValues({FavoritesViewModeStore.key: 'map'});
    source = FakePositionSource();
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, (_) async => null);
    addTearDown(() => messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, null));
  });

  /// [tab] — выбрана ли вкладка «Избранное». Оба признака — как их ставит
  /// главная (main_navigation): выбрана ли вкладка и TickerMode.
  Future<void> pump(WidgetTester tester, {ValueNotifier<bool>? tab}) async {
    final selected = tab ?? ValueNotifier(true);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>(create: (_) => _Auth()),
        ChangeNotifierProvider(create: (_) => EstablishmentsProvider()),
      ],
      child: MaterialApp(
        home: ValueListenableBuilder<bool>(
          valueListenable: selected,
          builder: (context, enabled, child) => SelectedTabScope(
            selected: enabled,
            child: TickerMode(enabled: enabled, child: child!),
          ),
          child: FavoritesScreen(positionSource: source),
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  /// Карточка заведения поверх — так её открывает «Подробнее»: корневой
  /// навигатор, непрозрачный экран.
  Future<NavigatorState> openCard(WidgetTester tester) async {
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    navigator.push(MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: Text('Карточка заведения'))));
    await tester.pumpAndSettle();
    return navigator;
  }

  Future<void> choose(WidgetTester tester, String label) async {
    await tester.tap(_option(label));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
  }

  /// Прогулка 15 минут, позиция пришла.
  Future<void> walk(WidgetTester tester) async {
    await tester.tap(_walkChip);
    await tester.pumpAndSettle();
    await choose(tester, '15 минут');
    source.completeFresh(_me);
    await tester.pump(const Duration(milliseconds: 1));
  }

  testWidgets(
      'подпись обложки: без позиции — обычная, с позицией — «рядом · N из '
      'M», M — и без координат; выключили — обычная', (tester) async {
    await pump(tester);
    expect(find.text('5 мест · Минск'), findsOneWidget);

    await tester.tap(_walkChip);
    await tester.pumpAndSettle();
    await choose(tester, '15 минут');
    expect(find.text('5 мест · Минск'), findsOneWidget,
        reason: 'позиции ещё нет — считать не от чего');

    source.completeFresh(_me);
    await tester.pump(const Duration(milliseconds: 1));
    expect(find.text('рядом · 3 из 5'), findsOneWidget);
    expect(find.text('3 места в 15 минутах'), findsOneWidget,
        reason: 'шторка и обложка считают одно');

    await tester.tap(find.widgetWithText(MapFilterChip, '15 минут'));
    await tester.pumpAndSettle();
    await choose(tester, 'Выключить прогулку');
    expect(find.text('5 мест · Минск'), findsOneWidget);
    expect(find.textContaining('рядом'), findsNothing);
  });

  testWidgets(
      'прогулка не запоминается: другая вкладка — геолокация выключена; '
      'вернулись — чип «Пешком», подпись обычная', (tester) async {
    final tab = ValueNotifier(true);
    await pump(tester, tab: tab);
    await walk(tester);
    expect(find.text('рядом · 3 из 5'), findsOneWidget);
    expect(source.listening, isTrue);

    tab.value = false;
    await tester.pump();
    expect(find.byType(FavoritesMap), findsNothing);
    expect(source.listening, isFalse);

    tab.value = true;
    await tester.pump();
    await tester.pump();
    expect(_walkChip, findsOneWidget);
    expect(tester.widget<MapFilterChip>(_walkChip).active, isFalse);
    expect(find.text('5 мест · Минск'), findsOneWidget);
    expect(find.textContaining('рядом'), findsNothing);
    expect(find.byType(WalkReachSheet), findsNothing);
    expect(source.freshCalls, 1, reason: 'новая карта сама не включает');
    expect(source.accessCalls, 2, reason: 'новая карта спрашивает доступ');
  });

  testWidgets(
      '«Подробнее» → «назад»: под карточкой геолокация выключена; после — '
      'те же минуты и «Открыто сейчас», свежая позиция', (tester) async {
    await pump(tester);
    await walk(tester);
    await tester.tap(find.widgetWithText(MapFilterChip, 'Открыто сейчас'));
    await tester.pump();
    expect(source.listening, isTrue);
    expect(source.freshCalls, 1, reason: 'предпосылка');

    final navigator = await openCard(tester);
    expect(find.byType(FavoritesMap), findsNothing,
        reason: 'геолокацию держит только видимая карта');
    expect(source.listening, isFalse);

    navigator.pop();
    // Не pumpAndSettle: пока ищем позицию, полоса ожидания крутится.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(
        tester
            .widget<MapFilterChip>(
                find.widgetWithText(MapFilterChip, '15 минут'))
            .active,
        isTrue);
    expect(
        tester
            .widget<MapFilterChip>(
                find.widgetWithText(MapFilterChip, 'Открыто сейчас'))
            .active,
        isTrue);
    expect(source.freshCalls, 2, reason: 'вернулись — свежая позиция заново');
    expect(source.listening, isTrue, reason: 'и поток заново');
    expect(source.requestCalls, 0, reason: 'без системного вопроса');
    expect(find.text('5 мест · Минск'), findsOneWidget,
        reason: 'до свежей позиции считать не от чего');

    // Человек отошёл, пока смотрел карточку: круг — от новой позиции.
    source.completeFresh(pointAtDistance(_me, 5000, 0));
    await tester.pump(const Duration(milliseconds: 1));
    expect(find.text('рядом · 1 из 5'), findsOneWidget);
  });

  testWidgets(
      'под карточкой ушли на другую вкладку — прогулка выключена',
      (tester) async {
    final tab = ValueNotifier(true);
    await pump(tester, tab: tab);
    await walk(tester);

    final navigator = await openCard(tester);
    // Вкладку под карточкой меняет нажатие на push (switchToTab).
    tab.value = false;
    await tester.pump();
    navigator.pop();
    await tester.pumpAndSettle();
    tab.value = true;
    await tester.pumpAndSettle();

    expect(tester.widget<MapFilterChip>(_walkChip).active, isFalse);
    expect(find.text('5 мест · Минск'), findsOneWidget);
    expect(source.freshCalls, 1, reason: 'новая карта сама не включает');
  });

  testWidgets('«Списком» и обратно «На карте» — прогулки нет', (tester) async {
    await pump(tester);
    await walk(tester);

    await tester.tap(find.text('Списком'));
    await tester.pumpAndSettle();
    expect(source.listening, isFalse);
    await tester.tap(find.text('На карте'));
    await tester.pumpAndSettle();
    expect(tester.widget<MapFilterChip>(_walkChip).active, isFalse);
    expect(find.text('5 мест · Минск'), findsOneWidget);
  });

  testWidgets(
      'позиция прогулки не уходит в поиск: fetchUserLocation не зовётся — '
      'позиция и сортировка поиска прежние', (tester) async {
    // Позови прогулка fetchUserLocation — LocationService спросил бы эту
    // платформу, получил позицию, и провайдер запомнил бы её, а сортировку
    // поиска перевёл «по расстоянию».
    final previous = GeolocatorPlatform.instance;
    GeolocatorPlatform.instance = _AlwaysHereGeolocator();
    addTearDown(() => GeolocatorPlatform.instance = previous);

    await pump(tester);
    final provider = Provider.of<EstablishmentsProvider>(
        tester.element(find.byType(FavoritesScreen)),
        listen: false);
    final sort = provider.currentSort;
    expect(provider.hasRealLocation, isFalse, reason: 'предпосылка');

    await walk(tester);
    source.move(pointAtDistance(_me, 80, 90));
    await tester.pump(const Duration(milliseconds: 1));
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('рядом · 3 из 5'), findsOneWidget);
    expect(provider.hasRealLocation, isFalse);
    expect(provider.currentSort, sort);
  });

  testWidgets('стенд сети: вся прогулка — ни одного запроса', (tester) async {
    await pump(tester);
    final before = wire.requests.length;
    expect(before, greaterThan(0),
        reason: 'предпосылка: избранное пришло через этот стенд');

    await walk(tester);
    source.move(pointAtDistance(_me, 80, 90));
    await tester.pump(const Duration(milliseconds: 1));
    await tester.tap(find.widgetWithText(MapFilterChip, 'Открыто сейчас'));
    await tester.pump();
    await tester.tap(find.byType(WalkPlaceCard).first);
    await tester.pump();
    expect(find.byType(EstablishmentMapPreview), findsOneWidget);
    await tester.tap(find.descendant(
        of: find.byType(EstablishmentMapPreview),
        matching: find.byIcon(Icons.close)));
    await tester.pump();
    await tester.tap(find.widgetWithText(MapFilterChip, '15 минут'));
    await tester.pumpAndSettle();
    await choose(tester, '30 минут');
    await tester.tap(find.widgetWithText(MapFilterChip, '30 минут'));
    await tester.pumpAndSettle();
    await choose(tester, 'Выключить прогулку');

    expect(wire.requests.length, before,
        reason: wire.requests.skip(before).map((r) => r.path).join(', '));
  });
}
