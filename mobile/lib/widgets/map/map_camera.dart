import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_clustering.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

// Камера — одна для всех карт приложения: вкладка «Карта» и карта
// «Избранного» ставят её одним кодом. Две копии разошлись бы при первой
// правке, а у первой установки камеры есть ловушка iPhone (ниже).

/// Пауза перед второй, надёжной попыткой поставить камеру.
const Duration kInitialCameraRetryDelay = Duration(milliseconds: 600);

/// Пауза после второй попытки, прежде чем верить событиям камеры.
const Duration kInitialCameraSettleDelay = Duration(milliseconds: 250);

/// Первая установка камеры только что созданной карты.
///
/// На настоящих iPhone нативная карта молча пропускает `moveCamera`, если
/// вызвать его до полной готовности нативного вида. Поэтому сначала сразу
/// (часто срабатывает, когда тайлы уже в кэше), затем ещё раз через
/// [kInitialCameraRetryDelay] (холодные районы), затем
/// [kInitialCameraSettleDelay] на успокоение — только после этого события
/// камеры от пользователя можно принимать за его движения.
///
/// [move] — установка камеры (`controller.moveCamera(...)`); [isMounted] —
/// жив ли ещё экран: после каждой паузы мёртвому экрану камеру не ставим.
/// Возвращает `true`, если камера поставлена и экран жив.
Future<bool> settleInitialCamera(
  Future<void> Function() move, {
  required bool Function() isMounted,
}) async {
  await move();
  await Future<void>.delayed(kInitialCameraRetryDelay);
  if (!isMounted()) return false;
  await move();
  await Future<void>.delayed(kInitialCameraSettleDelay);
  return isMounted();
}

/// Куда смотрит камера, охватывая точки: одну — в центр крупно, несколько —
/// рамкой вокруг всех. Отдельно от [CameraUpdate], чтобы проверять значения.
sealed class CameraFraming {
  const CameraFraming();

  CameraUpdate toCameraUpdate();
}

/// Точка в центре на заданном приближении.
final class CameraOnPoint extends CameraFraming {
  const CameraOnPoint(this.target, this.zoom);

  final Point target;
  final double zoom;

  @override
  CameraUpdate toCameraUpdate() => CameraUpdate.newCameraPosition(
        CameraPosition(target: target, zoom: zoom),
      );
}

/// Рамка, в которую камера вписывает карту.
final class CameraOnBox extends CameraFraming {
  const CameraOnBox(this.box);

  final BoundingBox box;

  @override
  CameraUpdate toCameraUpdate() =>
      CameraUpdate.newGeometry(Geometry.fromBoundingBox(box));
}

/// Центр, когда смотреть не на что: выбранный город, без города — Минск.
const Point kDefaultCenter = Point(latitude: 53.9006, longitude: 27.5590);

/// Приближение «весь город».
const double kCityZoom = 13.0;

/// Центр города [city]; `null` — [kDefaultCenter].
Point cityCenter(String? city) {
  if (city == null) return kDefaultCenter;
  final (lat, lon) = CityOptions.coordinatesFor(city);
  return Point(latitude: lat, longitude: lon);
}

/// Точки заведений, у которых есть координаты, — в том же порядке.
List<Point> establishmentPoints(Iterable<Establishment> establishments) => [
      for (final e in establishments)
        if (e.latitude != null && e.longitude != null)
          Point(latitude: e.latitude!, longitude: e.longitude!),
    ];

/// Охват точек: одна — крупный план [kFocusZoom] (выше порога кластеров,
/// пин не уйдёт в пузырь), несколько — рамка [clusterExtent] с отступом.
/// Пусто — `null`: решает вызывающий (вкладка «Карта» камеру не трогает,
/// «Избранное» смотрит на центр города).
CameraFraming? framePoints(List<Point> points) {
  if (points.isEmpty) return null;
  if (points.length == 1) return CameraOnPoint(points.single, kFocusZoom);
  return CameraOnBox(clusterExtent(points)!);
}

/// Охват точек, а если их нет — весь выбранный город [city] (так карта
/// «Избранного» встречает места без координат).
CameraFraming frameOrCity(List<Point> points, String? city) =>
    framePoints(points) ?? CameraOnPoint(cityCenter(city), kCityZoom);
