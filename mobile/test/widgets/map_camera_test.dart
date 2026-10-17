// Камера и пины — общие для вкладки «Карта» и карты «Избранного» (этап 3).
//
// Нативная карта в тестах не рождается, поэтому проверяется то, что ей
// передают: охват точек (значения — литералами), центр города, состав и
// порядок пинов, и порядок двух установок камеры по часам теста.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_pins.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_camera.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_preview_dock.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

Establishment _place(String id, {double? lat, double? lng}) => Establishment(
      id: id,
      name: 'Место $id',
      category: 'Ресторан',
      address: 'пр. Независимости, 43',
      city: 'Минск',
      status: 'active',
      latitude: lat,
      longitude: lng,
      createdAt: DateTime(2026, 10, 17),
      updatedAt: DateTime(2026, 10, 17),
    );

void main() {
  group('кто становится пином', () {
    final table = <(String, Establishment, bool)>[
      ('обе координаты', _place('a', lat: 53.9, lng: 27.5), true),
      ('нет широты', _place('b', lng: 27.5), false),
      ('нет долготы', _place('c', lat: 53.9), false),
      ('нет обеих', _place('d'), false),
    ];
    for (final (name, place, pinned) in table) {
      test(name, () {
        expect(pinnableEstablishments([place]).isNotEmpty, pinned);
        expect(establishmentPoints([place]).isNotEmpty, pinned,
            reason: 'точки камеры — те же места');
      });
    }

    test('порядок мест сохраняется', () {
      final places = [
        _place('x', lat: 1, lng: 1),
        _place('y'),
        _place('z', lat: 2, lng: 2),
      ];
      expect(pinnableEstablishments(places).map((e) => e.id), ['x', 'z']);
    });
  });

  group('охват точек', () {
    test('ни одной — охвата нет', () {
      expect(framePoints(const []), isNull);
    });

    test('одна — в центр, крупный план 15', () {
      final framing =
          framePoints(const [Point(latitude: 53.91, longitude: 27.55)]);
      expect(framing, isA<CameraOnPoint>());
      framing as CameraOnPoint;
      expect(framing.target, const Point(latitude: 53.91, longitude: 27.55));
      expect(framing.zoom, 15.0);
    });

    test('несколько — рамка вокруг всех плюс 30 % пролёта с каждой стороны',
        () {
      final framing = framePoints(const [
        Point(latitude: 53.90, longitude: 27.50),
        Point(latitude: 53.92, longitude: 27.56),
      ]);
      expect(framing, isA<CameraOnBox>());
      final box = (framing as CameraOnBox).box;
      // Пролёт широты 0.02 × 1.6 = 0.032 около 53.91; долготы 0.06 × 1.6 =
      // 0.096 около 27.53.
      expect(box.southWest.latitude, closeTo(53.894, 1e-9));
      expect(box.northEast.latitude, closeTo(53.926, 1e-9));
      expect(box.southWest.longitude, closeTo(27.482, 1e-9));
      expect(box.northEast.longitude, closeTo(27.578, 1e-9));
    });

    test('мест с координатами нет — весь выбранный город', () {
      final grodno = frameOrCity(const [], 'Гродно') as CameraOnPoint;
      expect(grodno.target, const Point(latitude: 53.6650, longitude: 23.8500));
      expect(grodno.zoom, 13.0);

      final none = frameOrCity(const [], null) as CameraOnPoint;
      expect(none.target, const Point(latitude: 53.9006, longitude: 27.5590),
          reason: 'без города — Минск, как на вкладке «Карта»');
      expect(none.zoom, 13.0);
    });

    test('места есть — город не важен', () {
      final framing = frameOrCity(
          const [Point(latitude: 53.91, longitude: 27.55)], 'Гродно');
      expect((framing as CameraOnPoint).target,
          const Point(latitude: 53.91, longitude: 27.55));
    });
  });

  group('первая установка камеры: сразу, через 600 мс, ещё 250 мс', () {
    testWidgets('две установки, затем готово', (tester) async {
      var moves = 0;
      bool? ready;
      settleInitialCamera(() async => moves++, isMounted: () => true)
          .then((value) => ready = value);

      await tester.pump();
      expect(moves, 1, reason: 'первая — сразу');
      await tester.pump(const Duration(milliseconds: 599));
      expect(moves, 1, reason: 'вторая — не раньше 600 мс');
      await tester.pump(const Duration(milliseconds: 1));
      expect(moves, 2, reason: 'вторая — на 600 мс');
      await tester.pump(const Duration(milliseconds: 249));
      expect(ready, isNull, reason: 'события камеры — не раньше 850 мс');
      await tester.pump(const Duration(milliseconds: 1));
      expect(ready, isTrue);
      expect(moves, 2);
    });

    testWidgets('экран ушёл после первой — второй установки нет',
        (tester) async {
      var moves = 0;
      var mounted = true;
      bool? ready;
      settleInitialCamera(() async => moves++, isMounted: () => mounted)
          .then((value) => ready = value);

      await tester.pump();
      mounted = false;
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump(const Duration(milliseconds: 250));
      expect(moves, 1);
      expect(ready, isFalse);
    });

    testWidgets('экран ушёл после второй — не готово', (tester) async {
      var moves = 0;
      var mounted = true;
      bool? ready;
      settleInitialCamera(() async => moves++, isMounted: () => mounted)
          .then((value) => ready = value);

      await tester.pump(const Duration(milliseconds: 600));
      expect(moves, 2);
      mounted = false;
      await tester.pump(const Duration(milliseconds: 250));
      expect(ready, isFalse);
    });
  });

  group('пины', () {
    final places = [
      _place('a', lat: 53.90, lng: 27.50),
      _place('b', lat: 53.91, lng: 27.51),
      _place('без координат'),
      _place('c', lat: 53.92, lng: 27.52),
    ];

    test('выбранный — последним и выше; остальные в прежнем порядке', () {
      final pins = buildEstablishmentPins(
        places,
        selectedId: 'a',
        markers: MapMarkerGenerator(),
        onTap: (_) {},
      );
      expect(pins.map((p) => p.mapId.value),
          ['marker_b', 'marker_c', 'marker_a']);
      expect(pins.map((p) => p.zIndex), [0.0, 0.0, 1.0]);
      expect(pins.last.point, const Point(latitude: 53.90, longitude: 27.50));
    });

    test('без выбора — все на одном уровне, в порядке мест', () {
      final pins = buildEstablishmentPins(
        places,
        selectedId: null,
        markers: MapMarkerGenerator(),
        onTap: (_) {},
      );
      expect(pins.map((p) => p.mapId.value),
          ['marker_a', 'marker_b', 'marker_c']);
      expect(pins.every((p) => p.zIndex == 0.0), isTrue);
      expect(pins.every((p) => p.consumeTapEvents), isTrue);
    });

    test('нажатие сообщает id своего места', () {
      final tapped = <String>[];
      final pins = buildEstablishmentPins(
        places,
        selectedId: null,
        markers: MapMarkerGenerator(),
        onTap: tapped.add,
      );
      final pin = pins[1];
      pin.onTap!(pin, pin.point);
      expect(tapped, ['b']);
    });
  });

  group('низ карты: кнопка «моё место» и карточка', () {
    const screen = Size(390, 844);
    const cardHeight = 260.0;
    const button = Key('location');
    const card = Key('card');

    Future<void> pumpDock(WidgetTester tester, {required bool withCard}) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = screen;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Stack(children: [
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: MapPreviewDock(
                preview: withCard
                    ? const SizedBox(key: card, height: cardHeight)
                    : null,
                locationButton:
                    const SizedBox(key: button, width: 40, height: 40),
              ),
            ),
          ]),
        ),
      ));
    }

    testWidgets('без карточки — кнопка на прежнем месте: 24 от низа, 16 справа',
        (tester) async {
      await pumpDock(tester, withCard: false);
      final rect = tester.getRect(find.byKey(button));
      expect(rect.bottom, screen.height - 24);
      expect(rect.right, screen.width - 16);
    });

    testWidgets('с карточкой — кнопка над ней через 12 и её не накрывает',
        (tester) async {
      await pumpDock(tester, withCard: true);
      final rect = tester.getRect(find.byKey(button));
      final cardRect = tester.getRect(find.byKey(card));
      expect(cardRect.bottom, screen.height);
      expect(cardRect.width, screen.width, reason: 'карточка во всю ширину');
      expect(rect.bottom, cardRect.top - 12);
      expect(rect.overlaps(cardRect), isFalse);
      expect(rect.right, screen.width - 16);
    });

    testWidgets('место слева от кнопки касаний не ловит — они уходят карте',
        (tester) async {
      var mapTaps = 0;
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = screen;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Stack(children: [
            Positioned.fill(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => mapTaps++,
              ),
            ),
            const Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: MapPreviewDock(
                preview: SizedBox(key: card, height: cardHeight),
                locationButton: SizedBox(key: button, width: 40, height: 40),
              ),
            ),
          ]),
        ),
      ));
      final rect = tester.getRect(find.byKey(button));
      await tester.tapAt(Offset(40, rect.center.dy));
      expect(mapTaps, 1);
    });
  });
}
