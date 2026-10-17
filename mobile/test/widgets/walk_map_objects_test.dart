// Рисунок прогулки на карте: кольцо, слой, точка «я здесь» и рамка камеры.
//
// Кольцо и «в круге» обязаны совпадать: точки кольца меряются той же
// функцией, которой прогулка решает, кто в круге. Рамка камеры проверяется
// обратной проекцией: где на экране окажутся край круга и его центр, если
// камера впишет рамку в карту край в край.

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:restaurant_guide_mobile/utils/walk_reach.dart';
import 'package:restaurant_guide_mobile/widgets/map/walk_map_objects.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

const GeoPoint _me = (latitude: 53.9000, longitude: 27.5600);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('кольцо', () {
    test('64 отрезка, замкнуто, каждая точка — ровно на радиусе', () {
      final radius = walkRadiusMeters(15);
      final ring = walkRingPoints(_me, radius);
      expect(ring, hasLength(65));
      expect(ring.last, ring.first);
      for (final p in ring) {
        expect(
            metersBetween(_me, (latitude: p.latitude, longitude: p.longitude)),
            closeTo(923.0769, 0.001));
      }
      // Точки обходят круг, а не стоят в одной: север и юг на месте.
      expect(ring.first.latitude, greaterThan(_me.latitude));
      expect(ring[32].latitude, lessThan(_me.latitude));
    });
  });

  group('слой прогулки', () {
    final image = Uint8List.fromList([1, 2, 3]);

    test('без позиции — пустая коллекция с постоянным id', () {
      final layer = walkLayer();
      expect(layer.mapId, kWalkLayerId);
      expect(layer.mapId.value, 'walk_layer');
      expect(layer.mapObjects, isEmpty);
    });

    test('пунктир: заливка 5 %, кольцо 35 % пунктиром, точка поверх', () {
      final layer =
          walkLayer(center: _me, radiusMeters: 923.0769, meImage: image);
      final ids = [for (final o in layer.mapObjects) o.mapId.value];
      expect(ids, ['walk_fill', 'walk_ring', 'walk_me']);

      final fill = layer.mapObjects[0] as PolygonMapObject;
      expect(fill.fillColor, const Color(0x0D3F63B8));
      expect(fill.strokeWidth, 0);
      final ring = layer.mapObjects[1] as PolylineMapObject;
      expect(ring.strokeColor, const Color(0x593F63B8));
      expect(ring.strokeWidth, 2);
      expect(ring.dashLength, greaterThan(0));
      expect(ring.gapLength, greaterThan(0));
      expect(ring.polyline.points, fill.polygon.outerRing.points,
          reason: 'заливка и кольцо — по одним точкам');
      final me = layer.mapObjects[2] as PlacemarkMapObject;
      expect(me.point, const Point(latitude: 53.9, longitude: 27.56));
      expect(me.zIndex, greaterThan(ring.zIndex));
    });

    test('сплошная обводка: кольца-ломаной нет, обводка у заливки', () {
      final layer = walkLayer(
          center: _me, radiusMeters: 500, meImage: image, dashed: false);
      expect([for (final o in layer.mapObjects) o.mapId.value],
          ['walk_fill', 'walk_me']);
      final fill = layer.mapObjects[0] as PolygonMapObject;
      expect(fill.strokeColor, const Color(0x593F63B8));
      expect(fill.strokeWidth, 2);
    });

    test('картинка «я здесь» ещё рисуется — круг есть, точки нет', () {
      final layer = walkLayer(center: _me, radiusMeters: 500);
      expect([for (final o in layer.mapObjects) o.mapId.value],
          ['walk_fill', 'walk_ring']);
    });

    test('хэш точки — без байтов картинки, равенство — по ним', () {
      UserLocationMark mark(Uint8List bytes) => UserLocationMark(
            mapId: const MapObjectId('walk_me'),
            point: const Point(latitude: 53.9, longitude: 27.56),
            icon: PlacemarkIcon.single(
                PlacemarkIconStyle(image: BitmapDescriptor.fromBytes(bytes))),
          );
      final a = mark(Uint8List.fromList([1, 2, 3]));
      final b = mark(Uint8List.fromList([9, 9, 9]));
      expect(a.hashCode, b.hashCode);
      expect(a == b, isFalse);
      expect(a == mark(Uint8List.fromList([1, 2, 3])), isTrue);
    });
  });

  group('картинка «я здесь»', () {
    test(
        'холст 32 на плотность; в центре василёк, кольцо белое, ореол '
        'полупрозрачный', () async {
      const dpr = 3.0;
      final bytes = await userLocationMarkImage(dpr);
      final codec = await ui.instantiateImageCodec(bytes);
      final image = (await codec.getNextFrame()).image;
      expect(image.width, 96);
      expect(image.height, 96);
      final data = (await image.toByteData())!;
      List<int> rgba(double dx, double dy) {
        final x = (dx * dpr).floor();
        final y = (dy * dpr).floor();
        final i = (y * image.width + x) * 4;
        return [
          data.getUint8(i),
          data.getUint8(i + 1),
          data.getUint8(i + 2),
          data.getUint8(i + 3),
        ];
      }

      // Центр 16 × 16: точка 16 (радиус 8), белое кольцо до 10, ореол до 15.
      expect(rgba(16, 16), [0x3F, 0x63, 0xB8, 255]);
      expect(rgba(16, 7), [255, 255, 255, 255], reason: 'белое кольцо');
      final halo = rgba(16, 2.5);
      expect(halo[3], inInclusiveRange(30, 60),
          reason: 'ореол 18 %: альфа ≈ 46, а не сплошной');
      expect(rgba(0.2, 0.2)[3], 0, reason: 'угол холста прозрачный');
    });
  });

  group('когда камере показать круг', () {
    test('до первой установки камеры карты — нельзя; после — один раз', () {
      final gate = WalkCameraGate()..request();
      expect(gate.take(), isFalse, reason: 'камера карты ещё встаёт');
      gate.settle();
      expect(gate.take(), isTrue);
      expect(gate.take(), isFalse, reason: 'один раз на включение');
    });

    test('без просьбы — нет; прогулку выключили — просьба снята', () {
      final gate = WalkCameraGate()..settle();
      expect(gate.take(), isFalse);
      gate
        ..request()
        ..cancel();
      expect(gate.take(), isFalse);
      gate.request();
      expect(gate.take(), isTrue);
    });
  });

  group('рамка камеры', () {
    /// Где на экране высоты [viewport] окажется широта [lat], если камера
    /// впишет [box] в карту край в край.
    double screenY(BoundingBox box, double lat, Size viewport) =>
        (box.northEast.latitude - lat) /
        (box.northEast.latitude - box.southWest.latitude) *
        viewport.height;

    double screenX(BoundingBox box, double lng, Size viewport) =>
        (lng - box.southWest.longitude) /
        (box.northEast.longitude - box.southWest.longitude) *
        viewport.width;

    test('круг целиком между чипами и шторкой, по центру полосы', () {
      const viewport = Size(390, 620);
      const top = 78.0;
      const bottom = 180.0;
      final radius = walkRadiusMeters(15);
      final box = walkFrame(
        center: _me,
        radiusMeters: radius,
        viewport: viewport,
        topInset: top,
        bottomInset: bottom,
      );
      final north = pointAtDistance(_me, radius, 0);
      final south = pointAtDistance(_me, radius, 180);
      final east = pointAtDistance(_me, radius, 90);
      final west = pointAtDistance(_me, radius, 270);

      expect(screenY(box, north.latitude, viewport),
          greaterThanOrEqualTo(top + 16 - 0.5));
      expect(screenY(box, south.latitude, viewport),
          lessThanOrEqualTo(viewport.height - bottom - 16 + 0.5));
      expect(
          screenX(box, west.longitude, viewport), greaterThanOrEqualTo(15.5));
      expect(screenX(box, east.longitude, viewport),
          lessThanOrEqualTo(viewport.width - 15.5));
      // Центр круга — на середине полосы между чипами и шторкой.
      expect(screenY(box, _me.latitude, viewport),
          closeTo((top + viewport.height - bottom) / 2, 0.5));
      expect(screenX(box, _me.longitude, viewport),
          closeTo(viewport.width / 2, 0.5));
    });

    test('рамка той же пропорции, что карта: метры по осям равны', () {
      const viewport = Size(390, 620);
      final box = walkFrame(
        center: _me,
        radiusMeters: 1846,
        viewport: viewport,
        topInset: 78,
        bottomInset: 180,
      );
      final heightMeters = metersBetween(
        (latitude: box.northEast.latitude, longitude: _me.longitude),
        (latitude: box.southWest.latitude, longitude: _me.longitude),
      );
      final widthMeters = metersBetween(
        (latitude: _me.latitude, longitude: box.southWest.longitude),
        (latitude: _me.latitude, longitude: box.northEast.longitude),
      );
      expect(heightMeters / widthMeters,
          closeTo(viewport.height / viewport.width, 0.001));
    });
  });
}
