import 'dart:math' as math;

/// Точка на земле: широта и долгота в градусах.
typedef GeoPoint = ({double latitude, double longitude});

/// Радиус Земли той формулы, которой считают расстояние Geolocator и «км от
/// вас» в списке «Избранного».
const double _earthRadiusMeters = 6378137.0;

/// Метров по прямой между точками — та же формула гаверсинусов и тот же
/// радиус Земли, что у `Geolocator.distanceBetween`
/// (geolocator_platform_interface 4.2.6), то есть у «км от вас» в списке.
/// Своя копия — чтобы расчёт оставался чистой функцией без плагина.
double metersBetween(GeoPoint a, GeoPoint b) {
  double rad(double degrees) => degrees * math.pi / 180;
  final dLat = rad(b.latitude - a.latitude);
  final dLon = rad(b.longitude - a.longitude);
  final h = math.pow(math.sin(dLat / 2), 2) +
      math.pow(math.sin(dLon / 2), 2) *
          math.cos(rad(a.latitude)) *
          math.cos(rad(b.latitude));
  return _earthRadiusMeters * 2 * math.asin(math.sqrt(h));
}

/// Точка в [meters] от [from] по направлению [bearingDegrees] (0 — север,
/// 90 — восток) на той же сфере, что [metersBetween]: расстояние от [from] до
/// неё по [metersBetween] — ровно [meters]. Отсюда кольцо прогулки на карте
/// совпадает с тем, кого прогулка считает «в круге».
GeoPoint pointAtDistance(GeoPoint from, double meters, double bearingDegrees) {
  final lat1 = from.latitude * math.pi / 180;
  final lon1 = from.longitude * math.pi / 180;
  final theta = bearingDegrees * math.pi / 180;
  final delta = meters / _earthRadiusMeters;
  final lat2 = math.asin(math.sin(lat1) * math.cos(delta) +
      math.cos(lat1) * math.sin(delta) * math.cos(theta));
  final lon2 = lon1 +
      math.atan2(math.sin(theta) * math.sin(delta) * math.cos(lat1),
          math.cos(delta) - math.sin(lat1) * math.sin(lat2));
  return (latitude: lat2 * 180 / math.pi, longitude: lon2 * 180 / math.pi);
}
