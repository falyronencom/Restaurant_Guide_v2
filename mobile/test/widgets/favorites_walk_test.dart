// Прогулка над картой «Избранного» (этап 4, макет `3b`): чип «Пешком» по
// состоянию разрешения, шторка минут, круг и шторка «ближайшие», «Открыто
// сейчас», мини-карточка → превью поверх шторки, «Выключить прогулку».
//
// Нативная карта в тестах не рождается (канал platform_views заглушен), но
// виджет YandexMap строится — его объекты читаются из дерева. Позиция —
// подставной источник: тест решает, когда она придёт. Вид круга, точки «я
// здесь» и камера — телефон.
//
// Модель кадров: позиция приходит микрозадачей. Пустой pump() гоняет
// микрозадачи до кадра, только когда кадр уже запланирован (пока шторка
// ищет позицию, крутится полоса ожидания — запланирован; потом — нет).
// Поэтому после каждого события источника — pump(1 мс): микрозадачи, затем
// кадр с их setState.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/services/position_tracker.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:restaurant_guide_mobile/utils/route_links.dart';
import 'package:restaurant_guide_mobile/widgets/action_sheet.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_map.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';
import 'package:restaurant_guide_mobile/widgets/map/walk_controls.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

import '../support/fake_position_source.dart';

const GeoPoint _me = (latitude: 53.9000, longitude: 27.5600);

const _days = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/// Место в [meters] от человека к северу; без [meters] — без координат.
/// Часы «всегда открыто» / «всегда закрыто»: открытость не зависит от часов
/// машины.
Establishment _place(String id, {double? meters, bool open = true}) {
  final at = meters == null ? null : pointAtDistance(_me, meters, 0);
  return Establishment(
    id: id,
    name: 'Место $id',
    category: 'Кафе',
    address: 'ул. Ленина, 1',
    city: 'Минск',
    status: 'active',
    latitude: at?.latitude,
    longitude: at?.longitude,
    workingHours: {
      for (final d in _days) d: open ? '00:00-00:00' : {'is_open': false},
    },
    createdAt: DateTime(2026, 10, 17),
    updatedAt: DateTime(2026, 10, 17),
  );
}

/// В круге 15 минут (923 м): a — 300 м, закрытое — 500 м, b — 700 м.
/// Снаружи — 3 км, и одно без координат.
final _a = _place('a', meters: 300);
final _closed = _place('закрытое', meters: 500, open: false);
final _b = _place('b', meters: 700);
final _far = _place('далёкое', meters: 3000);
final _noCoords = _place('без координат');

final _walkChip = find.widgetWithText(MapFilterChip, 'Пешком');
final _openChip = find.widgetWithText(MapFilterChip, 'Открыто сейчас');
final _sheet = find.byType(WalkReachSheet);
final _preview = find.byType(EstablishmentMapPreview);

Finder _chipWith(String label) => find.widgetWithText(MapFilterChip, label);

/// Строка в открытой шторке минут.
Finder _option(String label) =>
    find.descendant(of: find.byType(BottomSheet), matching: find.text(label));

void main() {
  setUp(() {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, (_) async => null);
    addTearDown(() => messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, null));
  });

  late FakePositionSource source;
  late List<FavoritesWalk?> reported;
  late List<WalkChoice?> choices;

  setUp(() {
    source = FakePositionSource();
    reported = [];
    choices = [];
  });

  Future<void> pumpMap(WidgetTester tester, List<Establishment> places,
      {WalkChoice? initialWalk}) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: FavoritesMap(
          establishments: places,
          onDetails: (_) {},
          positionSource: source,
          onWalkChanged: reported.add,
          initialWalk: initialWalk,
          onWalkChoiceChanged: choices.add,
        ),
      ),
    ));
    // Ответ проверки доступа.
    await tester.pump();
  }

  YandexMap mapWidget(WidgetTester tester) =>
      tester.widget<YandexMap>(find.byType(YandexMap));

  MapObjectCollection collection(WidgetTester tester, String id) =>
      mapWidget(tester)
          .mapObjects
          .whereType<MapObjectCollection>()
          .singleWhere((c) => c.mapId.value == id);

  List<MapObject> walkObjects(WidgetTester tester) =>
      collection(tester, 'walk_layer').mapObjects;

  List<PlacemarkMapObject> pins(WidgetTester tester) =>
      collection(tester, 'favorite_pins').mapObjects.cast<PlacemarkMapObject>();

  List<String> cardIds(WidgetTester tester) => [
        for (final card
            in tester.widgetList<WalkPlaceCard>(find.byType(WalkPlaceCard)))
          card.place.establishment.id,
      ];

  /// Событие источника позиции дошло и нарисовано (см. модель кадров).
  Future<void> deliver(WidgetTester tester) =>
      tester.pump(const Duration(milliseconds: 1));

  bool chipActive(WidgetTester tester, Finder chip) =>
      tester.widget<MapFilterChip>(chip).active;

  bool sheetVisible(WidgetTester tester) => tester
      .widget<Visibility>(
          find.ancestor(of: _sheet, matching: find.byType(Visibility)))
      .visible;

  /// Выбор в шторке минут: она закрывается, прогулка включается.
  Future<void> choose(WidgetTester tester, String minutes) async {
    await tester.tap(_option(minutes));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
  }

  Future<void> startWalk(WidgetTester tester,
      {String minutes = '15 минут'}) async {
    await tester.tap(_walkChip);
    await tester.pumpAndSettle();
    await choose(tester, minutes);
  }

  /// Прогулка 15 минут, свежая позиция пришла.
  Future<void> walkHere(WidgetTester tester, List<Establishment> places,
      {GeoPoint at = _me}) async {
    await pumpMap(tester, places);
    await startWalk(tester);
    source.completeFresh(at);
    await deliver(tester);
  }

  group('чип «Пешком» по разрешению', () {
    testWidgets(
        'разрешение дано — чип есть, системного запроса нет; «Открыто '
        'сейчас» — только в прогулке', (tester) async {
      await pumpMap(tester, [_a, _b]);
      expect(_walkChip, findsOneWidget);
      expect(chipActive(tester, _walkChip), isFalse);
      expect(_openChip, findsNothing);
      expect(_sheet, findsNothing);
      expect(walkObjects(tester), isEmpty);
      expect(source.requestCalls, 0);
      expect(source.freshCalls, 0, reason: 'геолокация не тронута');
    });

    testWidgets(
        'ещё не спрашивали — чип есть, при входе на карту не спрашиваем',
        (tester) async {
      source.accessValue = LocationAccess.askable;
      await pumpMap(tester, [_a]);
      expect(_walkChip, findsOneWidget);
      expect(source.accessCalls, 1);
      expect(source.requestCalls, 0);
    });

    for (final access in [LocationAccess.denied, LocationAccess.off]) {
      testWidgets(
          '${access == LocationAccess.denied ? 'запрещено' : 'геолокация '
              'выключена'} — над картой чипов нет вовсе', (tester) async {
        source.accessValue = access;
        await pumpMap(tester, [_a]);
        expect(find.byType(MapFilterChip), findsNothing);
      });
    }

    testWidgets(
        'шторка минут — поверх всего приложения: в навигаторе вкладки её нет',
        (tester) async {
      // Во вкладке карта живёт во вложенном навигаторе. Шторка в нём
      // оставила бы нижнее меню доступным: ушли на другую вкладку — карта
      // снята, а шторка ждёт выбора.
      final tab = GlobalKey<NavigatorState>();
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Navigator(
            key: tab,
            onGenerateRoute: (_) => MaterialPageRoute<void>(
              builder: (_) => Scaffold(
                body: FavoritesMap(
                  establishments: [_a],
                  onDetails: (_) {},
                  positionSource: source,
                ),
              ),
            ),
          ),
        ),
      ));
      await tester.pump();
      await tester.tap(_walkChip);
      await tester.pumpAndSettle();

      expect(find.byType(BottomSheet), findsOneWidget);
      expect(
          find.descendant(
              of: find.byKey(tab), matching: find.byType(BottomSheet)),
          findsNothing);
    });

    testWidgets('доступ ещё проверяется — чипов нет', (tester) async {
      source.accessValue = null;
      await pumpMap(tester, [_a]);
      expect(find.byType(MapFilterChip), findsNothing);
    });

    testWidgets(
        'не спрашивали: нажатие — системный запрос; разрешили — шторка минут',
        (tester) async {
      source.accessValue = LocationAccess.askable;
      await pumpMap(tester, [_a]);
      await tester.tap(_walkChip);
      await tester.pumpAndSettle();

      expect(source.requestCalls, 1);
      for (final label in ['5 минут', '10 минут', '15 минут', '30 минут']) {
        expect(_option(label), findsOneWidget, reason: label);
      }
      expect(_option('Выключить прогулку'), findsNothing,
          reason: 'прогулка ещё не включена');
    });

    testWidgets('отказали в запросе — чипов нет, шторки минут нет',
        (tester) async {
      source
        ..accessValue = LocationAccess.askable
        ..afterRequest = LocationAccess.askable;
      await pumpMap(tester, [_a]);
      await tester.tap(_walkChip);
      await tester.pumpAndSettle();

      expect(source.requestCalls, 1);
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.byType(MapFilterChip), findsNothing);
      expect(source.freshCalls, 0);
    });

    testWidgets(
        'видимый верх чипа — 44 от верха карты, слева 12; зона нажатия 44',
        (tester) async {
      await pumpMap(tester, [_a]);
      final map = tester.getRect(find.byType(FavoritesMap));
      final plate = tester.getRect(find
          .descendant(of: _walkChip, matching: find.byType(Container))
          .first);
      expect(plate.top - map.top, 44);
      expect(plate.left - map.left, 12);
      expect(plate.height, 34);
      final tap = tester.getRect(find
          .descendant(of: _walkChip, matching: find.byType(GestureDetector))
          .first);
      expect(tap.height, 44);
    });
  });

  testWidgets(
      'знак Яндекса — слева сверху: низ карты занят шторкой; пины '
      'над кругом', (tester) async {
    await walkHere(tester, [_a]);
    expect(
        mapWidget(tester).logoAlignment,
        const MapAlignment(
          horizontal: HorizontalAlignment.left,
          vertical: VerticalAlignment.top,
        ));
    expect(collection(tester, 'favorite_pins').zIndex,
        greaterThan(collection(tester, 'walk_layer').zIndex));
  });

  group('прогулка включена', () {
    testWidgets(
        'выбрали 15 минут — чип оранжевый «15 минут», рядом «Открыто сейчас»; '
        'свежая позиция и поток 50 м', (tester) async {
      await pumpMap(tester, [_a, _b]);
      await startWalk(tester);

      expect(_walkChip, findsNothing);
      expect(chipActive(tester, _chipWith('15 минут')), isTrue);
      expect(chipActive(tester, _openChip), isFalse);
      expect(source.freshCalls, 1);
      expect(source.streamFilters, [50]);
      expect(source.listening, isTrue);
      expect(find.text('Ищем, где вы…'), findsOneWidget);
      expect(walkObjects(tester), isEmpty, reason: 'позиции ещё нет');
      expect(reported, everyElement(isNull),
          reason: 'без позиции хозяину нечего считать');
    });

    testWidgets(
        'позиция пришла — круг 923 м вокруг человека, шторка по минутам, '
        'подпись хозяину', (tester) async {
      await walkHere(tester, [_b, _far, _closed, _noCoords, _a]);

      final objects = walkObjects(tester);
      final fill = objects.whereType<PolygonMapObject>().single;
      final ring = objects.whereType<PolylineMapObject>().single;
      expect(fill.fillColor, const Color(0x0D3F63B8));
      expect(ring.strokeColor, const Color(0x593F63B8));
      expect(ring.strokeWidth, 2);
      expect(ring.dashLength, greaterThan(0), reason: 'пунктир');
      for (final p in ring.polyline.points) {
        expect(
            metersBetween(_me, (latitude: p.latitude, longitude: p.longitude)),
            closeTo(923.0769, 0.001));
      }

      expect(find.text('3 места в 15 минутах'), findsOneWidget);
      expect(find.text('из избранного'), findsOneWidget);
      expect(cardIds(tester), ['a', 'закрытое', 'b']);
      expect(find.text('≈ 5 мин · 300 м'), findsOneWidget);
      expect(find.text('≈ 9 мин · 500 м'), findsOneWidget);
      expect(find.text('≈ 12 мин · 700 м'), findsOneWidget);
      expect(find.text('Закрыто'), findsOneWidget);
      expect(find.textContaining('Открыто · до'), findsNWidgets(2));

      final walk = reported.last!;
      expect(walk.position, _me);
      expect(walk.minutes, 15);
      expect(walk.openNowOnly, isFalse);
      expect(walk.isLive, isTrue);
    });

    testWidgets(
        '«Открыто сейчас» — закрытые уходят из шторки и из N, серый пин '
        'остаётся', (tester) async {
      await walkHere(tester, [_a, _closed, _b, _far]);
      final pinIds = [for (final p in pins(tester)) p.mapId.value];

      await tester.tap(_openChip);
      await tester.pump();
      expect(chipActive(tester, _openChip), isTrue);
      expect(find.descendant(of: _openChip, matching: find.byIcon(Icons.check)),
          findsOneWidget);
      expect(find.text('2 места в 15 минутах'), findsOneWidget);
      expect(cardIds(tester), ['a', 'b']);
      expect([for (final p in pins(tester)) p.mapId.value], pinIds,
          reason: 'закрытые с карты не убираются');
      expect(reported.last!.openNowOnly, isTrue);

      await tester.tap(_openChip);
      await tester.pump();
      expect(find.text('3 места в 15 минутах'), findsOneWidget);
    });

    testWidgets(
        'в круге ничего — «В 15 минутах ничего из избранного» и предложение '
        'больше минут; на 30 предлагать нечего', (tester) async {
      await walkHere(tester, [_far, _noCoords]);
      expect(find.text('В 15 минутах ничего из избранного'), findsOneWidget);
      expect(find.byType(WalkPlaceCard), findsNothing);

      await tester.tap(find.text('Выбрать больше минут'));
      await tester.pumpAndSettle();
      expect(_option('30 минут'), findsOneWidget);
      expect(_option('Выключить прогулку'), findsOneWidget);

      await choose(tester, '30 минут');
      expect(find.text('В 30 минутах ничего из избранного'), findsOneWidget);
      expect(find.text('Выбрать больше минут'), findsNothing);
      expect(source.freshCalls, 1, reason: 'смена минут позицию не сбрасывает');
    });

    testWidgets('«Открыто сейчас», а в круге всё закрыто — своими словами',
        (tester) async {
      await walkHere(tester, [_closed, _far]);
      await tester.tap(_openChip);
      await tester.pump();
      expect(find.text('В 15 минутах всё из избранного сейчас закрыто'),
          findsOneWidget);
      expect(find.text('Выбрать больше минут'), findsOneWidget);
    });

    testWidgets(
        'мини-карточка — превью поверх шторки, пин жёлтый, маршрут пешком; '
        'закрыли — шторка вернулась, прокрутка та же', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await walkHere(tester, [_a, _closed, _b]);

      final row =
          find.descendant(of: _sheet, matching: find.byType(Scrollable));
      await tester.drag(find.byType(WalkPlaceCard).first, const Offset(-60, 0));
      await tester.pumpAndSettle();
      final offset = tester.state<ScrollableState>(row).position.pixels;
      expect(offset, greaterThan(0), reason: 'предпосылка: ряд прокручен');

      await tester.tap(find.widgetWithText(WalkPlaceCard, 'Место закрытое'));
      await tester.pump();

      expect(_preview, findsOneWidget);
      expect(
          find.descendant(of: _preview, matching: find.text('Место закрытое')),
          findsOneWidget);
      expect(pins(tester).last.mapId.value, 'marker_закрытое');
      expect(pins(tester).last.zIndex, 1.0);
      expect(_sheet, findsOneWidget,
          reason: 'под превью шторка остаётся в дереве — помнит прокрутку');
      expect(sheetVisible(tester), isFalse);
      expect(tester.widget<RouteButton>(find.byType(RouteButton)).mode,
          RouteMode.walking);

      await tester.tap(
          find.descendant(of: _preview, matching: find.byIcon(Icons.close)));
      await tester.pump();
      expect(_preview, findsNothing);
      expect(sheetVisible(tester), isTrue);
      expect(tester.state<ScrollableState>(row).position.pixels, offset);
    });

    testWidgets('пин без прогулки — маршрут на машине, в прогулке — пешком',
        (tester) async {
      Future<void> tapPin(String id) async {
        final pin =
            pins(tester).singleWhere((p) => p.mapId.value == 'marker_$id');
        pin.onTap!(pin, pin.point);
        await tester.pump();
      }

      await pumpMap(tester, [_a, _b]);
      await tapPin('a');
      expect(tester.widget<RouteButton>(find.byType(RouteButton)).mode,
          RouteMode.driving);
      await tester.tap(
          find.descendant(of: _preview, matching: find.byIcon(Icons.close)));
      await tester.pump();

      await startWalk(tester);
      source.completeFresh(_me);
      await deliver(tester);
      await tapPin('a');
      expect(tester.widget<RouteButton>(find.byType(RouteButton)).mode,
          RouteMode.walking);
    });

    testWidgets(
        '«Выключить прогулку» — геолокация выключена, круга и шторки нет, '
        'чип снова «Пешком»', (tester) async {
      await walkHere(tester, [_a, _b]);
      await tester.tap(_chipWith('15 минут'));
      await tester.pumpAndSettle();
      await choose(tester, 'Выключить прогулку');

      expect(source.listening, isFalse);
      expect(source.cancels, 1);
      expect(chipActive(tester, _walkChip), isFalse);
      expect(_openChip, findsNothing);
      expect(_sheet, findsNothing);
      expect(walkObjects(tester), isEmpty);
      expect(reported.last, isNull);
    });

    testWidgets(
        'посреди прогулки выключили геолокацию — прогулка выключена, чипов '
        'нет', (tester) async {
      await walkHere(tester, [_a]);
      source.accessValue = LocationAccess.off;
      source.breakStream();
      await deliver(tester);
      await deliver(tester);

      expect(source.accessCalls, 2, reason: 'доступ перепроверен');
      expect(find.byType(MapFilterChip), findsNothing);
      expect(_sheet, findsNothing);
      expect(walkObjects(tester), isEmpty);
      expect(source.listening, isFalse);
      expect(reported.last, isNull);
    });

    testWidgets(
        'посреди прогулки отозвали разрешение — прогулка выключена, чип '
        '«Пешком» спросит снова', (tester) async {
      await walkHere(tester, [_a]);
      source.accessValue = LocationAccess.askable;
      source.breakStream();
      await deliver(tester);
      await deliver(tester);

      expect(chipActive(tester, _walkChip), isFalse);
      expect(_sheet, findsNothing);
      expect(source.listening, isFalse);
    });

    testWidgets('карту сняли — геолокация выключена', (tester) async {
      await walkHere(tester, [_a]);
      expect(source.listening, isTrue);

      await tester.pumpWidget(const SizedBox());
      expect(source.listening, isFalse);
      expect(source.cancels, 1);
    });

    testWidgets(
        'на ходу круг и минуты следуют за человеком; та же позиция карту не '
        'пересоздаёт', (tester) async {
      await walkHere(tester, [_a]);
      final before = mapWidget(tester);

      source.move(_me);
      await deliver(tester);
      expect(identical(mapWidget(tester), before), isTrue,
          reason: 'круг тот же — карта та же');

      final moved = pointAtDistance(_me, 60, 0);
      source.move(moved);
      await deliver(tester);
      expect(identical(mapWidget(tester), before), isFalse);
      final ring =
          walkObjects(tester).whereType<PolylineMapObject>().single.polyline;
      expect(
          metersBetween(moved, (
            latitude: ring.points.first.latitude,
            longitude: ring.points.first.longitude,
          )),
          closeTo(923.0769, 0.001));
      expect(find.text('≈ 4 мин · 240 м'), findsOneWidget);
      expect(reported.last!.position, moved);
    });

    testWidgets(
        'позицию узнать не удалось — «Повторить» заводит заново; поток '
        'оборвался — круг снят', (tester) async {
      await pumpMap(tester, [_a]);
      await startWalk(tester);
      source.failFresh();
      await deliver(tester);
      expect(find.text('Не удалось точно определить, где вы'), findsOneWidget);

      await tester.tap(find.text('Повторить'));
      await tester.pump();
      expect(source.freshCalls, 2);
      expect(source.streamFilters, [50, 50]);
      expect(find.text('Ищем, где вы…'), findsOneWidget);

      source.completeFresh(_me);
      await deliver(tester);
      expect(walkObjects(tester), isNotEmpty);

      source.breakStream();
      await deliver(tester);
      expect(walkObjects(tester), isEmpty,
          reason: 'старая позиция лгала бы о том, кто в круге');
      expect(find.text('Не удалось точно определить, где вы'), findsOneWidget);
      expect(reported.last, isNull);
    });
  });

  // Карта под карточкой заведения снята, а новая после «назад» начинает с
  // прежнего выбора (хвост 2, 17.10.2026): хозяин хранит выбор, карта — нет.
  group('прежний выбор прогулки', () {
    testWidgets(
        'выбор сообщается хозяину: включили, «Открыто сейчас», сменили '
        'минуты, выключили', (tester) async {
      await walkHere(tester, [_a]);
      await tester.tap(_openChip);
      await tester.pump();
      await tester.tap(_chipWith('15 минут'));
      await tester.pumpAndSettle();
      await choose(tester, '30 минут');
      await tester.tap(_chipWith('30 минут'));
      await tester.pumpAndSettle();
      await choose(tester, 'Выключить прогулку');

      expect(choices, [
        (minutes: 15, openNowOnly: false),
        (minutes: 15, openNowOnly: true),
        (minutes: 30, openNowOnly: true),
        null,
      ]);
    });

    testWidgets(
        'новая карта с прежним выбором: 10 минут и «Открыто сейчас» '
        'включены, свежая позиция и поток, без системного вопроса',
        (tester) async {
      await pumpMap(tester, [_a, _b],
          initialWalk: (minutes: 10, openNowOnly: true));

      expect(chipActive(tester, _chipWith('10 минут')), isTrue);
      expect(chipActive(tester, _openChip), isTrue);
      expect(source.freshCalls, 1, reason: 'свежая позиция, как при включении');
      expect(source.streamFilters, [50]);
      expect(source.requestCalls, 0);
      expect(find.text('Ищем, где вы…'), findsOneWidget);

      source.completeFresh(_me);
      await deliver(tester);
      expect(reported.last?.minutes, 10);
      expect(reported.last?.openNowOnly, isTrue);
      expect(walkObjects(tester), isNotEmpty);
    });

    for (final access in [
      LocationAccess.askable,
      LocationAccess.denied,
      LocationAccess.off,
    ]) {
      testWidgets(
          'новая карта с прежним выбором, доступа нет (${access.name}) — '
          'прогулка не включается, выбор забыт, вопроса нет', (tester) async {
        source.accessValue = access;
        await pumpMap(tester, [_a],
            initialWalk: (minutes: 15, openNowOnly: false));

        expect(_openChip, findsNothing);
        expect(_sheet, findsNothing);
        expect(source.freshCalls, 0);
        expect(source.requestCalls, 0);
        expect(source.listening, isFalse);
        expect(choices, [null]);
      });
    }
  });

  group('крупный шрифт', () {
    testWidgets(
        'шторка минут на низком экране ×1,2 — все строки видны без '
        'прокрутки, и «Выключить прогулку» тоже', (tester) async {
      // Шесть строк выше 9/16 экрана, которые шторке даются по умолчанию:
      // без роста по содержимому нижние ушли бы за её край.
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      tester.platformDispatcher.textScaleFactorTestValue = 1.2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      await walkHere(tester, [_a]);
      await tester.tap(_chipWith('15 минут'));
      await tester.pumpAndSettle();

      final sheet = tester.getRect(find.byType(BottomSheet));
      expect(sheet.height, greaterThan(568 * 9 / 16),
          reason: 'предпосылка: строкам мало 9/16 экрана');
      for (final label in [
        '5 минут',
        '10 минут',
        '15 минут',
        '30 минут',
        'Выключить прогулку',
      ]) {
        expect(tester.getRect(_option(label)).bottom,
            lessThanOrEqualTo(sheet.bottom),
            reason: label);
      }
      expect(tester.takeException(), isNull);
    });

    for (final scale in [1.2, 2.0]) {
      testWidgets(
          '×$scale на 320: чипы в карте, шторка и карточки без '
          'переполнения', (tester) async {
        tester.view.physicalSize = const Size(320, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

        final long = _place('long', meters: 200)
            .copyWith(name: 'Очень длинное название кофейни на углу проспекта');
        await walkHere(tester, [long, _closed, _b]);
        await tester.tap(_openChip);
        await tester.pump();
        await tester.tap(_openChip);
        await tester.pump();

        expect(tester.takeException(), isNull);
        final chip = tester.getRect(find
            .descendant(of: _openChip, matching: find.byType(Container))
            .first);
        expect(chip.right, lessThanOrEqualTo(320 - 12));
        final title = tester.getRect(find.text('3 места в 15 минутах'));
        final caption = tester.getRect(find.text('из избранного'));
        expect(title.right, lessThanOrEqualTo(caption.left));
        expect(caption.right, lessThanOrEqualTo(320 - 16));

        // Шрифт чипов и шторки — не крупнее ×1,2, как у карточки списка:
        // масштаб берётся у нарисованного текста. При ×1,2 предел ничего не
        // меняет — проверяет его прогон ×2.
        if (scale > 1.2) {
          double drawnScale(String text) =>
              tester
                  .renderObject<RenderParagraph>(find.text(text))
                  .textScaler
                  .scale(10) /
              10;
          expect(drawnScale('Открыто сейчас'), closeTo(1.2, 1e-9));
          expect(drawnScale('из избранного'), closeTo(1.2, 1e-9));
        }
      });
    }
  });
}
