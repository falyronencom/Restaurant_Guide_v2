import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

// Рисунок прогулки на карте: круг пешей доступности и точка «я здесь»
// (README макета, экран 3, «Радиус пешей доступности»). Не знает, чьи места
// вокруг: карта «Избранного» кладёт его рядом со своими пинами, общая карта
// сможет положить рядом со своими.

/// Пунктир у кольца: у окружности карты пунктира нет (yandex_mapkit 4.2.1,
/// `CircleMapObject`), у ломаной есть — кольцо рисуется замкнутой ломаной.
/// `false` — сплошная полупрозрачная обводка, README это разрешает. Выбор —
/// по виду на телефоне (этап 4).
const bool kWalkRingDashed = true;

/// Коллекция прогулки стоит на карте всё время, меняется только её
/// содержимое: снятие коллекции задевает дефект плагина на Android (как у
/// пинов, `MapScreen._buildClusterCollection`).
const MapObjectId kWalkLayerId = MapObjectId('walk_layer');

/// Сколько отрезков у кольца: на 2 км в поперечнике 64 отрезка — около 90 м
/// дуги на отрезок, глазом не отличить от окружности.
const int kWalkRingSegments = 64;

/// Заливка круга — василёк 5 %, кольцо — 35 %, 2 точки (README).
const Color kWalkFillColor = Color(0x0D3F63B8);
const Color kWalkRingColor = Color(0x593F63B8);
const double kWalkRingWidth = 2;
const double kWalkRingDash = 6;
const double kWalkRingGap = 5;

/// Точки кольца радиуса [radiusMeters] вокруг [center], замкнутые: первая
/// повторена последней. Каждая — на расстоянии [radiusMeters] по
/// [metersBetween], то есть ровно на границе «в круге».
List<Point> walkRingPoints(
  GeoPoint center,
  double radiusMeters, {
  int segments = kWalkRingSegments,
}) {
  return [
    for (var i = 0; i <= segments; i++)
      _toPoint(pointAtDistance(center, radiusMeters, 360.0 * i / segments)),
  ];
}

Point _toPoint(GeoPoint p) =>
    Point(latitude: p.latitude, longitude: p.longitude);

/// Коллекция прогулки: круг [radiusMeters] вокруг [center] и точка «я здесь»
/// в [center]. Без [center] — пустая (прогулка выключена или позиции ещё
/// нет). Без [meImage] точки нет: картинка ещё рисуется.
///
/// Слой лежит под пинами ([zIndex] коллекции пинов выше): пин у места, где
/// стоит человек, нажимается, а не прячется под точку.
MapObjectCollection walkLayer({
  GeoPoint? center,
  double? radiusMeters,
  Uint8List? meImage,
  bool dashed = kWalkRingDashed,
}) {
  final ring = center != null && radiusMeters != null
      ? walkRingPoints(center, radiusMeters)
      : null;
  return MapObjectCollection(
    mapId: kWalkLayerId,
    mapObjects: [
      if (ring != null)
        PolygonMapObject(
          mapId: const MapObjectId('walk_fill'),
          polygon: Polygon(
            outerRing: LinearRing(points: ring),
            innerRings: const [],
          ),
          fillColor: kWalkFillColor,
          strokeColor: dashed ? Colors.transparent : kWalkRingColor,
          strokeWidth: dashed ? 0 : kWalkRingWidth,
        ),
      if (ring != null && dashed)
        PolylineMapObject(
          mapId: const MapObjectId('walk_ring'),
          polyline: Polyline(points: ring),
          strokeColor: kWalkRingColor,
          strokeWidth: kWalkRingWidth,
          dashLength: kWalkRingDash,
          gapLength: kWalkRingGap,
          zIndex: 1,
        ),
      if (center != null && meImage != null)
        UserLocationMark(
          mapId: const MapObjectId('walk_me'),
          point: _toPoint(center),
          zIndex: 2,
          icon: PlacemarkIcon.single(
            PlacemarkIconStyle(
              image: BitmapDescriptor.fromBytes(meImage),
              scale: 1.0,
              anchor: const Offset(0.5, 0.5),
            ),
          ),
          opacity: 1.0,
        ),
    ],
  );
}

/// Точка «я здесь» с хэшем без байтов картинки — как [EstablishmentPin]:
/// плагин хэширует все объекты на каждом обновлении карты, а equatable
/// проходит PNG байт за байтом (память
/// `feedback_yandex_mapkit_diff_hashes_icon_bytes`).
class UserLocationMark extends PlacemarkMapObject {
  const UserLocationMark({
    required super.mapId,
    required super.point,
    super.zIndex,
    super.icon,
    super.opacity,
  });

  @override
  int get hashCode => Object.hash(mapId, point, zIndex);

  // Равенство — equatable по всем полям; записано рядом с хэшем в пару.
  @override
  bool operator ==(Object other) => other is UserLocationMark && super == other;
}

/// Рисунок «я здесь» (README): точка 16 василька в белой обводке 2 с тенью
/// и ореол 30 василька 18 %. Холст — ореол и поле в точку по краям; якорь —
/// центр.
class UserLocationMarkPainter extends CustomPainter {
  const UserLocationMarkPainter();

  static const double dotDiameter = 16;
  static const double borderWidth = 2;
  static const double haloDiameter = 30;
  static const double canvasSide = haloDiameter + 2;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    canvas.drawCircle(
      center,
      haloDiameter / 2,
      Paint()..color = AppTheme.cockadeCornflower.withValues(alpha: 0.18),
    );
    const outer = dotDiameter / 2 + borderWidth;
    canvas.drawCircle(
      center.translate(0, 1),
      outer,
      Paint()
        ..color = Colors.black.withValues(alpha: 0.25)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2),
    );
    canvas.drawCircle(center, outer, Paint()..color = Colors.white);
    canvas.drawCircle(
      center,
      dotDiameter / 2,
      Paint()..color = AppTheme.cockadeCornflower,
    );
  }

  @override
  bool shouldRepaint(UserLocationMarkPainter oldDelegate) => false;
}

final Map<double, Future<Uint8List>> _meImages = {};

/// PNG «я здесь» под плотность [devicePixelRatio] — рисуется один раз на
/// плотность и дальше берётся из памяти.
Future<Uint8List> userLocationMarkImage(double devicePixelRatio) {
  return _meImages.putIfAbsent(devicePixelRatio, () {
    final render = _renderMe(devicePixelRatio);
    // Неудачная отрисовка не остаётся в памяти: следующая попытка рисует
    // заново.
    render.then<void>((_) {}, onError: (Object _) {
      if (identical(_meImages[devicePixelRatio], render)) {
        _meImages.remove(devicePixelRatio);
      }
    });
    return render;
  });
}

Future<Uint8List> _renderMe(double devicePixelRatio) async {
  const side = UserLocationMarkPainter.canvasSide;
  final physical = (side * devicePixelRatio).ceil();
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.scale(devicePixelRatio);
  const UserLocationMarkPainter().paint(canvas, const Size(side, side));
  final picture = recorder.endRecording();
  final image = await picture.toImage(physical, physical);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return bytes!.buffer.asUint8List();
}

/// Когда камере показать круг прогулки: один раз на каждое включение
/// прогулки и смену минут — когда круг уже есть и первая установка камеры
/// карты закончилась. Раньше нельзя: вторая попытка первой установки
/// (`settleInitialCamera`, через 600 мс) вернула бы камеру на все места, и
/// круг так и остался бы за кадром.
class WalkCameraGate {
  bool _settled = false;
  bool _pending = false;

  /// Круг ждёт показа: прогулку включили, сменили минуты, позиция потерялась.
  void request() => _pending = true;

  /// Прогулку выключили — показывать нечего.
  void cancel() => _pending = false;

  /// Первая установка камеры карты закончилась.
  void settle() => _settled = true;

  /// Показать круг сейчас? Да — один раз на [request], и только после
  /// [settle]. Есть ли круг, проверяет зовущий.
  bool take() {
    if (!_pending || !_settled) return false;
    _pending = false;
    return true;
  }
}

/// Рамка камеры для прогулки: круг [radiusMeters] вокруг [center] целиком
/// виден в полосе карты между [topInset] (чипы) и [bottomInset] (шторка), с
/// полем [margin] со всех сторон; центр круга — посередине полосы.
///
/// Рамка той же пропорции, что карта [viewport], — камера вписывает её край
/// в край, и масштаб выходит ровно таким, чтобы круг поместился и по высоте
/// полосы, и по ширине карты. Метры в градусы — локально, у широты центра:
/// на двух километрах ошибка меньше точки экрана.
BoundingBox walkFrame({
  required GeoPoint center,
  required double radiusMeters,
  required Size viewport,
  required double topInset,
  required double bottomInset,
  double margin = 16,
}) {
  final bandHeight =
      math.max(1.0, viewport.height - topInset - bottomInset - 2 * margin);
  final bandWidth = math.max(1.0, viewport.width - 2 * margin);
  // Метров на точку экрана: круг влезает и по высоте полосы, и по ширине.
  final metersPerPx =
      math.max(2 * radiusMeters / bandHeight, 2 * radiusMeters / bandWidth);
  // Центр круга — на середине полосы.
  final centerY = topInset + margin + bandHeight / 2;
  final northMeters = centerY * metersPerPx;
  final southMeters = (viewport.height - centerY) * metersPerPx;
  final halfWidthMeters = viewport.width / 2 * metersPerPx;

  const metersPerDegreeLat = 6378137.0 * math.pi / 180;
  final metersPerDegreeLon =
      metersPerDegreeLat * math.cos(center.latitude * math.pi / 180);
  return BoundingBox(
    northEast: Point(
      latitude: center.latitude + northMeters / metersPerDegreeLat,
      longitude: center.longitude + halfWidthMeters / metersPerDegreeLon,
    ),
    southWest: Point(
      latitude: center.latitude - southMeters / metersPerDegreeLat,
      longitude: center.longitude - halfWidthMeters / metersPerDegreeLon,
    ),
  );
}
