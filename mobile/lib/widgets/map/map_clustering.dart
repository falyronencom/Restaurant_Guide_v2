import 'dart:math' as math;

import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

// Pin clustering on the map screen: nearby establishments merge into one
// bubble with their count (MapKit's ClusterizedPlacemarkCollection), and a
// tap on a bubble zooms into its members. Parameters follow the web map
// (web/src/components/map/MapView.tsx, CLUSTER_* constants).

/// Pins merge into bubbles at this zoom and below; above it every
/// establishment is its own pin. The web map uses the same threshold.
const int kClusterMaxZoom = 14;

/// Zoom for a single establishment: "show on map" from its card and the
/// "my location" button. Must stay above [kClusterMaxZoom]: that is what
/// guarantees the establishment the map was opened for is a pin of its own,
/// never swallowed by a bubble.
const double kFocusZoom = 15.0;

/// Distance, in MapKit screen units, below which two pins merge. About the
/// pin's 48 dp circle plus a margin: pins closer than that would overlap, and
/// overlapping is what clustering is for.
const double kClusterRadius = 56.0;

/// Floor for the span a bubble tap zooms into (~150 m), as on the web:
/// members with coincident coordinates give a zero-size box, which is not a
/// usable camera target.
const double kClusterMinSpan = 0.0015;

/// Share of the span added on each side of a bubble's extent. The camera
/// fits the box edge to edge, and a pin is drawn above its point — a member
/// on the northern edge would otherwise end up off screen.
const double kClusterExtentMargin = 0.3;

/// A map pin whose hashCode leaves its image out.
///
/// The plugin diffs map objects through sets on every map update, and
/// equatable's hashCode walks every prop, image bytes included: ~15 KB of PNG
/// per pin, read byte by byte, several times per update. Measured 29.09.2026
/// on a Galaxy A72 (profile build): with 500 pins each tap on a pin froze the
/// map for 3.4 s. Identity, position and z-order hash in microseconds, and the
/// contract holds — equal pins still hash equally; pins that differ only by
/// image share a hash and are told apart by ==, which compares the images'
/// (cached, shared) byte arrays by identity first.
class EstablishmentPin extends PlacemarkMapObject {
  const EstablishmentPin({
    required super.mapId,
    required super.point,
    super.zIndex,
    super.onTap,
    super.consumeTapEvents,
    super.icon,
    super.opacity,
  });

  @override
  int get hashCode => Object.hash(mapId, point, zIndex);

  // Equality stays equatable's, over every prop; spelled out to pair with
  // the hash above.
  @override
  bool operator ==(Object other) => other is EstablishmentPin && super == other;
}

/// What the pins of [establishments] show at the moment [at] (now by
/// default), in order: which establishment, where, and whether it is open —
/// the pin's colour. Equal content means the same pins, so a refetch that
/// returns it needs no map update.
List<Object?> pinContent(Iterable<Establishment> establishments,
    {DateTime? at}) {
  final moment = at ?? DateTime.now();
  return [
    for (final e in establishments)
      ...[e.id, e.latitude, e.longitude, e.isOpenAt(moment)],
  ];
}

/// Camera target for a bubble tap: the box around its members, widened to at
/// least [minSpan] on each axis, then by [margin] of the span on each side.
/// Null when there are no points.
BoundingBox? clusterExtent(
  Iterable<Point> points, {
  double minSpan = kClusterMinSpan,
  double margin = kClusterExtentMargin,
}) {
  if (points.isEmpty) return null;

  var south = double.infinity;
  var north = double.negativeInfinity;
  var west = double.infinity;
  var east = double.negativeInfinity;
  for (final point in points) {
    south = math.min(south, point.latitude);
    north = math.max(north, point.latitude);
    west = math.min(west, point.longitude);
    east = math.max(east, point.longitude);
  }

  (double, double) widen(double min, double max) {
    final mid = (min + max) / 2;
    final span = math.max(max - min, minSpan) * (1 + 2 * margin);
    return (mid - span / 2, mid + span / 2);
  }

  final (boxSouth, boxNorth) = widen(south, north);
  final (boxWest, boxEast) = widen(west, east);
  return BoundingBox(
    northEast: Point(latitude: boxNorth, longitude: boxEast),
    southWest: Point(latitude: boxSouth, longitude: boxWest),
  );
}
