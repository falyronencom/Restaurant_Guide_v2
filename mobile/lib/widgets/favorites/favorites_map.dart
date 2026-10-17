import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/action_sheet.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_pins.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_camera.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_clustering.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_preview_dock.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

/// Карта «Избранного» (макет `3a`): пины сохранённых мест с координатами,
/// по тапу — та же карточка-превью, что на вкладке «Карта», с «Маршрутом».
///
/// Ничего не загружает: места приходят готовыми из избранного (координаты и
/// часы работы в нём уже есть). Кластеров нет — избранное это десятки
/// точек, не сотни (README макета).
///
/// Хозяин держит карту на экране, только пока её видно: невидимая нативная
/// карта — вторая живая рядом с картой вкладки «Карта». Новая карта при
/// каждом показе снова охватывает все места; открытая карточка при этом
/// закрывается.
class FavoritesMap extends StatefulWidget {
  const FavoritesMap({
    super.key,
    required this.establishments,
    required this.onDetails,
    this.city,
  });

  /// Все места избранного; без координат пинами не становятся.
  final List<Establishment> establishments;

  /// «Подробнее» в карточке-превью.
  final ValueChanged<Establishment> onDetails;

  /// Выбранный город — центр карты, если координат нет ни у одного места.
  final String? city;

  @override
  State<FavoritesMap> createState() => _FavoritesMapState();
}

class _FavoritesMapState extends State<FavoritesMap> {
  static const MapObjectId _collectionId = MapObjectId('favorite_pins');

  final MapMarkerGenerator _markers = MapMarkerGenerator();

  /// Выбранное место — по id: данные под ним меняются (место обновили,
  /// убрали из избранного), и карточка берёт его из текущего списка.
  String? _selectedId;

  /// Что показывают пины: [pinContent] на момент последней [_rebuildMap].
  List<Object?> _mapPins = const [];

  /// Виджет карты — между сборками один и тот же, новый только при смене
  /// пинов или выбора ([_rebuildMap]): каждое обновление YandexMap заново
  /// сравнивает все пины, и новый виджет на каждой сборке экрана платил бы
  /// это на каждый кадр.
  late Widget _map = _buildMap();

  /// Выбранное место, если оно ещё в избранном.
  Establishment? get _selected {
    final id = _selectedId;
    if (id == null) return null;
    for (final e in widget.establishments) {
      if (e.id == id && e.latitude != null && e.longitude != null) return e;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    _initMarkers();
  }

  Future<void> _initMarkers() async {
    final dpr =
        WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    await _markers.ensureInitialized(dpr);
    // Пины, построенные до готовности картинок, несут запасной значок.
    if (mounted) setState(_rebuildMap);
  }

  @override
  void didUpdateWidget(FavoritesMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Место убрали из избранного (или у него пропали координаты), пока его
    // карточка открыта, — карточка закрывается, пин пропадает.
    var selectionGone = false;
    if (_selectedId != null && _selected == null) {
      _selectedId = null;
      selectionGone = true;
    }
    final pinsChanged =
        !listEquals(_mapPins, pinContent(widget.establishments));
    if (pinsChanged || selectionGone) _rebuildMap();
  }

  void _rebuildMap() {
    _mapPins = pinContent(widget.establishments);
    _map = _buildMap();
  }

  Widget _buildMap() {
    return YandexMap(
      onMapCreated: _onMapCreated,
      mapObjects: [
        // Коллекция стоит на карте всё время, меняются только пины внутри:
        // снятие коллекции задевает дефект плагина на Android (см.
        // MapScreen._buildClusterCollection).
        MapObjectCollection(
          mapId: _collectionId,
          mapObjects: buildEstablishmentPins(
            widget.establishments,
            selectedId: _selectedId,
            markers: _markers,
            onTap: _onPinTap,
          ),
        ),
      ],
    );
  }

  Future<void> _onMapCreated(YandexMapController controller) async {
    final framing = frameOrCity(
      establishmentPoints(widget.establishments),
      widget.city,
    );
    await settleInitialCamera(
      () => controller.moveCamera(framing.toCameraUpdate()),
      isMounted: () => mounted,
    );
  }

  void _onPinTap(String id) {
    if (widget.establishments.every((e) => e.id != id)) return;
    setState(() {
      _selectedId = id;
      _rebuildMap();
    });
  }

  void _closePreview() {
    setState(() {
      _selectedId = null;
      _rebuildMap();
    });
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    return Stack(
      children: [
        Positioned.fill(child: _map),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: MapPreviewDock(
            preview: selected == null
                ? null
                : EstablishmentMapPreview(
                    establishment: selected,
                    onClose: _closePreview,
                    onDetails: () {
                      // Второе нажатие до кадра застаёт выбор уже пустым —
                      // второй карточки заведения нет (как на вкладке
                      // «Карта»).
                      if (_selectedId == null) return;
                      // Карточка закрыта, пин прежний, затем переход.
                      _closePreview();
                      widget.onDetails(selected);
                    },
                    secondaryAction: RouteButton(
                      latitude: selected.latitude!,
                      longitude: selected.longitude!,
                    ),
                  ),
          ),
        ),
      ],
    );
  }
}
