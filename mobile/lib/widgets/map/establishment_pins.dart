import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_clustering.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_painter.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

/// Заведения, которые могут стать пинами: с обеими координатами. Место без
/// координат на карте не показывается, но в счётчике «N мест» остаётся.
List<Establishment> pinnableEstablishments(
        Iterable<Establishment> establishments) =>
    [
      for (final e in establishments)
        if (e.latitude != null && e.longitude != null) e,
    ];

/// Пины заведений — одни на все карты приложения: маркер открытого,
/// закрытого или выбранного места из [markers] (существующие оранжевый,
/// серый и жёлтый), [EstablishmentPin] без байтов картинки в хэше.
///
/// Выбранный пин — последним и выше остальных: рисуется поверх соседей.
/// Нажатие сообщает только id: пины переживают список, из которого их
/// построили, и заведение ищется в текущем списке в момент нажатия.
List<EstablishmentPin> buildEstablishmentPins(
  Iterable<Establishment> establishments, {
  required String? selectedId,
  required MapMarkerGenerator markers,
  required void Function(String id) onTap,
}) {
  final valid = pinnableEstablishments(establishments);
  final ordered = [
    for (final e in valid)
      if (e.id != selectedId) e,
    for (final e in valid)
      if (e.id == selectedId) e,
  ];

  return [
    for (final establishment in ordered)
      _pin(establishment, establishment.id == selectedId, markers, onTap),
  ];
}

EstablishmentPin _pin(
  Establishment establishment,
  bool selected,
  MapMarkerGenerator markers,
  void Function(String id) onTap,
) {
  final markerBytes = markers.getMarkerImage(
    isOpen: establishment.isCurrentlyOpen,
    isSelected: selected,
  );
  return EstablishmentPin(
    mapId: MapObjectId('marker_${establishment.id}'),
    point: Point(
      latitude: establishment.latitude!,
      longitude: establishment.longitude!,
    ),
    zIndex: selected ? 1.0 : 0.0,
    // The tap belongs to the topmost pin. Without this MapKit hands it on
    // to the other objects under the finger (plugin docs), so on
    // overlapping pins more than one would answer.
    consumeTapEvents: true,
    icon: markerBytes != null
        ? PlacemarkIcon.single(
            PlacemarkIconStyle(
              image: BitmapDescriptor.fromBytes(markerBytes),
              scale: 1.0,
              anchor: MapMarkerPainter.anchor,
            ),
          )
        : PlacemarkIcon.single(
            PlacemarkIconStyle(
              image: BitmapDescriptor.fromAssetImage(
                  'packages/yandex_mapkit/assets/place.png'),
              scale: 2.0,
            ),
          ),
    opacity: 1.0,
    onTap: (PlacemarkMapObject self, Point point) => onTap(establishment.id),
  );
}
