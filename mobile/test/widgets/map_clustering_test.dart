import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_clustering.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

/// Правила объединения пинов на карте (map_clustering.dart).
///
/// Сама группировка — нативная (MapKit), тестам недоступна: её проверяют на
/// устройстве. Здесь — то, что решает наш код: порог масштаба относительно
/// масштаба «одного заведения», рамка, к которой карта приближается по
/// нажатию на кружок, и признак «пины не изменились».
void main() {
  test('настройка: масштаб одного заведения выше порога объединения', () {
    // Сторожит конфигурацию, а не поведение MapKit. Поведение — «на масштабе
    // выше minZoom пины по одному» — проверено на устройстве 29.09.2026. На
    // kFocusZoom открываются «Показать на карте» из карточки и «Моё
    // местоположение»; на сайте та же связка (14 < 15).
    expect(kFocusZoom, greaterThan(kClusterMaxZoom));
  });

  group('пин заведения: отпечаток (hashCode) без байтов картинки', () {
    // Плагин сравнивает объекты карты через множества при каждом обновлении;
    // отпечаток по байтам картинки стоил 3.4 с на нажатие при 500 пинах
    // (Galaxy A72, 29.09.2026).
    test('пины, различные только картинкой, — один отпечаток, но не равны',
        () {
      final a = _pin(Uint8List.fromList([1, 2, 3]));
      final b = _pin(Uint8List.fromList([4, 5, 6]));

      expect(a.hashCode, b.hashCode,
          reason: 'в отпечаток попали байты картинки');
      expect(a == b, isFalse);
    });

    test('равные пины — равные отпечатки, даже из разных массивов байтов', () {
      final a = _pin(Uint8List.fromList([1, 2, 3]));
      final b = _pin(Uint8List.fromList([1, 2, 3]));

      expect(a == b, isTrue);
      expect(a.hashCode, b.hashCode);
    });

    test('пины разных заведений различаются отпечатком', () {
      // Постоянный отпечаток соблюдал бы контракт, но вернул бы заморозку:
      // множества в диффе плагина сравнивали бы попарно каждый пин.
      final image = Uint8List.fromList([1, 2, 3]);

      expect(_pin(image, id: 'e1').hashCode,
          isNot(_pin(image, id: 'e2').hashCode));
    });
  });

  group('содержимое пинов — по нему карта решает, обновляться ли', () {
    test('те же заведения другими объектами — то же содержимое', () {
      expect(pinContent([_establishment('a'), _establishment('b')]),
          pinContent([_establishment('a'), _establishment('b')]));
    });

    test('различаются заведение, координаты, порядок и открытость', () {
      final base = pinContent([_establishment('a'), _establishment('b')]);

      expect(pinContent([_establishment('a'), _establishment('c')]),
          isNot(base));
      expect(
          pinContent([_establishment('a'), _establishment('b', lat: 53.95)]),
          isNot(base));
      expect(
          pinContent([_establishment('a'), _establishment('b', lon: 27.6)]),
          isNot(base));
      expect(pinContent([_establishment('b'), _establishment('a')]),
          isNot(base));
      // Без часов работы открытость берётся из статуса: active — открыто.
      expect(
          pinContent(
              [_establishment('a'), _establishment('b', status: 'suspended')]),
          isNot(base));
    });

    test('те же заведения в другой момент — другое содержимое, если '
        'заведение за это время закрылось', () {
      // Карта сравнивает загруженное со снимком того, что нарисовано; снимок
      // и новая загрузка считаются в разные моменты. 29.09.2026 — вторник.
      final places = [
        _establishment('a', hours: {'tuesday': '10:00-22:00'}),
      ];

      expect(pinContent(places, at: DateTime(2026, 9, 29, 12)),
          isNot(pinContent(places, at: DateTime(2026, 9, 29, 23, 30))));
      expect(pinContent(places, at: DateTime(2026, 9, 29, 12)),
          pinContent(places, at: DateTime(2026, 9, 29, 13)));
    });
  });

  group('рамка приближения по нажатию на кружок', () {
    test('разнесённые точки: их рамка плюс 30 % пролёта с каждой стороны', () {
      final box = clusterExtent(const [
        Point(latitude: 53.90, longitude: 27.55),
        Point(latitude: 53.91, longitude: 27.57),
      ])!;

      // Широта: пролёт 0.01 → 0.016 с полями вокруг центра 53.905.
      expect(box.southWest.latitude, closeTo(53.897, 1e-9));
      expect(box.northEast.latitude, closeTo(53.913, 1e-9));
      // Долгота: пролёт 0.02 → 0.032 вокруг центра 27.56.
      expect(box.southWest.longitude, closeTo(27.544, 1e-9));
      expect(box.northEast.longitude, closeTo(27.576, 1e-9));
    });

    test('заведения в одной точке: рамка не нулевая, а 0.0015° с полями, '
        'по центру точки', () {
      // Нулевая рамка — не цель для камеры. На проде 29.09.2026 два
      // заведения из 26 стоят ближе ~10 м друг к другу.
      final box = clusterExtent(const [
        Point(latitude: 53.9, longitude: 27.5),
        Point(latitude: 53.9, longitude: 27.5),
      ])!;

      // 0.0015 × 1.6 = 0.0024 → ±0.0012 от точки.
      expect(box.southWest.latitude, closeTo(53.8988, 1e-9));
      expect(box.northEast.latitude, closeTo(53.9012, 1e-9));
      expect(box.southWest.longitude, closeTo(27.4988, 1e-9));
      expect(box.northEast.longitude, closeTo(27.5012, 1e-9));
    });

    test('точки на одной широте: пол пролёта ставится только по широте', () {
      final box = clusterExtent(const [
        Point(latitude: 53.90, longitude: 27.55),
        Point(latitude: 53.90, longitude: 27.57),
      ])!;

      expect(box.northEast.latitude - box.southWest.latitude,
          closeTo(0.0024, 1e-9));
      expect(box.northEast.longitude - box.southWest.longitude,
          closeTo(0.032, 1e-9));
    });

    test('нет точек — нет рамки', () {
      expect(clusterExtent(const <Point>[]), isNull);
    });
  });
}

EstablishmentPin _pin(Uint8List image, {String id = 'e1'}) => EstablishmentPin(
      mapId: MapObjectId('marker_$id'),
      point: const Point(latitude: 53.9, longitude: 27.57),
      consumeTapEvents: true,
      icon: PlacemarkIcon.single(
        PlacemarkIconStyle(image: BitmapDescriptor.fromBytes(image)),
      ),
      opacity: 1.0,
    );

Establishment _establishment(
  String id, {
  double lat = 53.9,
  double lon = 27.57,
  String status = 'active',
  Map<String, dynamic>? hours,
}) =>
    Establishment(
      id: id,
      name: 'Заведение $id',
      category: 'Ресторан',
      address: 'Октябрьская, 23А',
      city: 'Минск',
      latitude: lat,
      longitude: lon,
      workingHours: hours,
      status: status,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );
