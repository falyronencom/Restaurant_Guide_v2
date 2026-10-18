import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/services/position_tracker.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:restaurant_guide_mobile/utils/route_links.dart';
import 'package:restaurant_guide_mobile/utils/walk_reach.dart';
import 'package:restaurant_guide_mobile/widgets/action_sheet.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_pins.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_camera.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_clustering.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_preview_dock.dart';
import 'package:restaurant_guide_mobile/widgets/map/walk_controls.dart';
import 'package:restaurant_guide_mobile/widgets/map/walk_map_objects.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

/// Прогулка, как её видит хозяин карты: где человек, сколько минут, только
/// ли открытые. Хозяину — для подписи обложки «рядом · N из M», которую он
/// считает той же [walkReach], что и шторка.
///
/// [isLive] — жива ли карта, сообщившая прогулку: позиция прежней карты к
/// новой не относится — новая сама узнаёт свежую и сообщит её.
class FavoritesWalk {
  const FavoritesWalk({
    required this.position,
    required this.minutes,
    required this.openNowOnly,
    required bool Function() isLive,
  }) : _isLive = isLive;

  final GeoPoint position;
  final int minutes;
  final bool openNowOnly;
  final bool Function() _isLive;

  bool get isLive => _isLive();
}

/// Что человек выбрал в прогулке: минуты и «Открыто сейчас». Хозяин карты
/// хранит выбор, пока человек на вкладке: под карточкой заведения карта
/// снята, а новая после «назад» начинает с него ([FavoritesMap.initialWalk]).
typedef WalkChoice = ({int minutes, bool openNowOnly});

/// Карта «Избранного» (макет `3a`): пины сохранённых мест с координатами,
/// по тапу — та же карточка-превью, что на вкладке «Карта», с «Маршрутом».
///
/// Над ней — прогулка (макет `3b`, этап 4): чип «Пешком» → минуты → круг
/// пешей доступности вокруг человека, точка «я здесь» и шторка ближайших
/// мест по минутам; рядом чип «Открыто сейчас». Закрытые места с карты не
/// убираются — их пины серые (правило дизайнера).
///
/// Ничего не загружает: места приходят готовыми из избранного (координаты и
/// часы работы в нём уже есть). Кластеров нет — избранное это десятки
/// точек, не сотни (README макета).
///
/// Хозяин держит карту на экране, только пока её видно: невидимая нативная
/// карта — вторая живая рядом с картой вкладки «Карта». Новая карта при
/// каждом показе снова охватывает все места; открытая карточка закрывается,
/// а геолокация, которую прогулка держала, выключается вместе с прежней
/// картой. Прогулка на новой карте — выключена, если хозяин не передал
/// [initialWalk]: тогда она включается заново, со свежей позицией.
class FavoritesMap extends StatefulWidget {
  const FavoritesMap({
    super.key,
    required this.establishments,
    required this.onDetails,
    this.city,
    this.positionSource = const DevicePositionSource(),
    this.onWalkChanged,
    this.initialWalk,
    this.onWalkChoiceChanged,
  });

  /// Все места избранного; без координат пинами не становятся.
  final List<Establishment> establishments;

  /// «Подробнее» в карточке-превью.
  final ValueChanged<Establishment> onDetails;

  /// Выбранный город — центр карты, если координат нет ни у одного места.
  final String? city;

  /// Откуда прогулка берёт позицию; подменяется в тестах.
  final PositionSource positionSource;

  /// Прогулка изменилась: `null` — выключена или позиции ещё нет. Зовётся
  /// только из событий (нажатие, новая позиция), никогда из сборки.
  final ValueChanged<FavoritesWalk?>? onWalkChanged;

  /// С какой прогулкой карта начинает; `null` — выключена. Читается, когда
  /// карта узнала доступ к геолокации (до этого чипов нет): включается,
  /// только если разрешение дано, — без системного вопроса.
  final WalkChoice? initialWalk;

  /// Выбор прогулки изменился: включили, сменили минуты или «Открыто
  /// сейчас», выключили (`null`). В отличие от [onWalkChanged], не ждёт
  /// позиции. Зовётся только из событий, никогда из сборки.
  final ValueChanged<WalkChoice?>? onWalkChoiceChanged;

  @override
  State<FavoritesMap> createState() => _FavoritesMapState();
}

class _FavoritesMapState extends State<FavoritesMap> {
  static const MapObjectId _collectionId = MapObjectId('favorite_pins');

  /// Видимый верх чипов над картой — от верха карты (README: 44).
  static const double _chipsTop = 44;

  /// Где кончается полоса чипов: камера прогулки держит круг ниже.
  static const double _chipsBottom = _chipsTop + MapFilterChip.visibleHeight;

  final MapMarkerGenerator _markers = MapMarkerGenerator();

  /// Выбранное место — по id: данные под ним меняются (место обновили,
  /// убрали из избранного), и карточка берёт его из текущего списка.
  String? _selectedId;

  /// Что показывают пины: [pinContent] на момент последней [_rebuildMap].
  List<Object?> _mapPins = const [];

  /// Круг прогулки, с которым построена карта: центр и радиус. Новая
  /// позиция без смены круга карту не пересоздаёт.
  (GeoPoint, double)? _mapCircle;

  /// Виджет карты — между сборками один и тот же, новый только при смене
  /// пинов, выбора или круга ([_rebuildMap]): каждое обновление YandexMap
  /// заново сравнивает все объекты, и новый виджет на каждой сборке экрана
  /// платил бы это на каждый кадр.
  late Widget _map = _buildMap();

  YandexMapController? _controller;

  /// Размер карты на последней сборке — для рамки камеры прогулки.
  Size? _mapSize;

  final GlobalKey _sheetKey = GlobalKey();

  // ── Прогулка ──

  /// Можно ли узнать позицию; `null` — ещё проверяем (чипов нет).
  LocationAccess? _access;

  /// Минуты прогулки; `null` — прогулка выключена.
  int? _walkMinutes;

  bool _openNowOnly = false;

  /// Где человек; `null` — прогулка выключена или позиции ещё нет.
  GeoPoint? _position;

  /// Позицию узнать не удалось — шторка предлагает повторить.
  bool _locateFailed = false;

  /// Когда камере показать круг: один раз на включение и смену минут, и
  /// не раньше, чем встанет первая камера карты.
  final WalkCameraGate _framing = WalkCameraGate();

  /// Картинка «я здесь»; `null` — ещё рисуется.
  Uint8List? _meImage;

  late final PositionTracker _tracker = PositionTracker(
    source: widget.positionSource,
    onPosition: _onPosition,
    onFailure: _onLocateFailure,
  );

  /// Выбранное место, если оно ещё в избранном.
  Establishment? get _selected {
    final id = _selectedId;
    if (id == null) return null;
    for (final e in widget.establishments) {
      if (e.id == id && e.latitude != null && e.longitude != null) return e;
    }
    return null;
  }

  bool get _walking => _walkMinutes != null;

  /// Чипы прогулки есть, если позицию можно узнать: разрешение дано или ещё
  /// не спрашивалось (Р2). Запрещено или геолокация выключена — чипов нет.
  bool get _walkAvailable =>
      _access == LocationAccess.granted || _access == LocationAccess.askable;

  @override
  void initState() {
    super.initState();
    _initMarkers();
    _checkAccess();
  }

  Future<void> _initMarkers() async {
    final dpr =
        WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    await _markers.ensureInitialized(dpr);
    // Пины, построенные до готовности картинок, несут запасной значок.
    if (mounted) setState(_rebuildMap);
  }

  /// Без системного запроса: спрашивать разрешение — только по нажатию на
  /// «Пешком», никогда при входе на карту.
  Future<void> _checkAccess() async {
    LocationAccess access;
    try {
      access = await widget.positionSource.access();
    } catch (e) {
      debugPrint('FavoritesMap: доступ к геолокации не узнать: $e');
      access = LocationAccess.off;
    }
    if (!mounted) return;
    setState(() => _access = access);
    _resumeWalk(access);
  }

  /// Прогулка, с которой хозяин просит начать ([FavoritesMap.initialWalk]):
  /// разрешение дано — включается, как по нажатию; нет — выбор забыт.
  void _resumeWalk(LocationAccess access) {
    final choice = widget.initialWalk;
    if (choice == null || _walking) return;
    if (access != LocationAccess.granted) {
      widget.onWalkChoiceChanged?.call(null);
      return;
    }
    _openNowOnly = choice.openNowOnly;
    _startWalk(choice.minutes);
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

  @override
  void dispose() {
    // Геолокация прогулки живёт, пока живёт карта: ушли с вкладки, экран
    // накрыт, режим списка — выключена.
    _tracker.dispose();
    super.dispose();
  }

  /// Круг, который сейчас должен быть на карте.
  (GeoPoint, double)? get _circle {
    final position = _position;
    final minutes = _walkMinutes;
    if (position == null || minutes == null) return null;
    return (position, walkRadiusMeters(minutes));
  }

  void _rebuildMap() {
    _mapPins = pinContent(widget.establishments);
    _mapCircle = _circle;
    _map = _buildMap();
  }

  /// Пересоздать карту, только если круг другой (центр или радиус).
  void _syncCircle() {
    if (_circle != _mapCircle) _rebuildMap();
  }

  Widget _buildMap() {
    final circle = _circle;
    return YandexMap(
      onMapCreated: _onMapCreated,
      // Внизу — шторка прогулки и карточка-превью: знак Яндекса над ними,
      // слева сверху, как в макете (`3b`); чипы — ниже него.
      logoAlignment: const MapAlignment(
        horizontal: HorizontalAlignment.left,
        vertical: VerticalAlignment.top,
      ),
      mapObjects: [
        // Обе коллекции стоят на карте всё время, меняется только их
        // содержимое: снятие коллекции задевает дефект плагина на Android
        // (см. MapScreen._buildClusterCollection).
        walkLayer(
          center: circle?.$1,
          radiusMeters: circle?.$2,
          meImage: _meImage,
        ),
        MapObjectCollection(
          mapId: _collectionId,
          // Пины — над кругом и точкой «я здесь».
          zIndex: 1,
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
    _controller = controller;
    final framing = frameOrCity(
      establishmentPoints(widget.establishments),
      widget.city,
    );
    final settled = await settleInitialCamera(
      () => controller.moveCamera(framing.toCameraUpdate()),
      isMounted: () => mounted,
    );
    if (!settled) return;
    // Прогулку включили, пока камера вставала, — круг показывается после:
    // вторая попытка первой установки вернула бы камеру на все места.
    _framing.settle();
    _frameWalk();
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

  // ── Прогулка ──

  Future<void> _onWalkChipTap() async {
    if (_access == LocationAccess.askable) {
      LocationAccess access;
      try {
        access = await widget.positionSource.requestAccess();
      } catch (e) {
        debugPrint('FavoritesMap: запрос геолокации не удался: $e');
        return;
      }
      if (!mounted) return;
      // Человек отказал — до новой карты чипов нет, как при запрете; новая
      // карта спросит систему заново и, если та может спросить, покажет чип.
      setState(() => _access =
          access == LocationAccess.askable ? LocationAccess.denied : access);
      if (access != LocationAccess.granted) return;
    }
    if (!mounted) return;
    _openMinutesSheet();
  }

  void _openMinutesSheet() {
    showWalkMinutesSheet(
      context,
      current: _walkMinutes,
      onSelected: _startWalk,
      onTurnOff: _walking ? _stopWalk : null,
    );
  }

  void _startWalk(int minutes) {
    if (!mounted) return;
    final wasOff = !_walking;
    setState(() {
      _walkMinutes = minutes;
      _framing.request();
      if (wasOff) {
        _position = null;
        _locateFailed = false;
      }
      _syncCircle();
    });
    if (wasOff) {
      _ensureMeImage();
      _tracker.start();
    }
    // Минуты сменились при известной позиции — круг другой, камера по нему.
    _frameWalkAfterLayout();
    _reportWalk();
    _reportChoice();
  }

  void _stopWalk() {
    if (!mounted) return;
    _tracker.stop();
    setState(() {
      _walkMinutes = null;
      _openNowOnly = false;
      _position = null;
      _locateFailed = false;
      _framing.cancel();
      _syncCircle();
    });
    _reportWalk();
    _reportChoice();
  }

  void _toggleOpenNow() {
    setState(() => _openNowOnly = !_openNowOnly);
    _reportWalk();
    _reportChoice();
  }

  void _onPosition(GeoPoint position) {
    if (!mounted || !_walking) return;
    setState(() {
      _position = position;
      _locateFailed = false;
      _syncCircle();
    });
    _frameWalkAfterLayout();
    _reportWalk();
  }

  /// Позицию узнать не удалось: старая позиция была бы неправдой о том, кто
  /// в круге, — круг снимается, шторка предлагает повторить.
  ///
  /// Если причина — отозванное разрешение или выключенная геолокация,
  /// «Повторить» не поможет: прогулка выключается, а чипы показываются по
  /// новому доступу (выключена геолокация — чипов нет).
  Future<void> _onLocateFailure() async {
    if (!mounted || !_walking) return;
    setState(() {
      _locateFailed = true;
      _position = null;
      _framing.request();
      _syncCircle();
    });
    _reportWalk();

    LocationAccess access;
    try {
      access = await widget.positionSource.access();
    } catch (e) {
      debugPrint('FavoritesMap: доступ к геолокации не узнать: $e');
      return;
    }
    if (!mounted || !_walking || access == LocationAccess.granted) return;
    _stopWalk();
    setState(() => _access = access);
  }

  void _retryLocate() {
    setState(() => _locateFailed = false);
    _tracker.retry();
  }

  Future<void> _ensureMeImage() async {
    if (_meImage != null) return;
    final dpr =
        WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    try {
      final image = await userLocationMarkImage(dpr);
      if (!mounted) return;
      setState(() {
        _meImage = image;
        _rebuildMap();
      });
    } catch (e) {
      debugPrint('FavoritesMap: точка «я здесь» не нарисовалась: $e');
    }
  }

  void _reportWalk() {
    final callback = widget.onWalkChanged;
    if (callback == null) return;
    final position = _position;
    final minutes = _walkMinutes;
    callback(position == null || minutes == null
        ? null
        : FavoritesWalk(
            position: position,
            minutes: minutes,
            openNowOnly: _openNowOnly,
            isLive: () => mounted,
          ));
  }

  void _reportChoice() {
    final minutes = _walkMinutes;
    widget.onWalkChoiceChanged?.call(minutes == null
        ? null
        : (minutes: minutes, openNowOnly: _openNowOnly));
  }

  /// Камера — на круг, когда шторка уже разложена с местами: её высота
  /// решает, сколько карты остаётся кругу.
  void _frameWalkAfterLayout() {
    WidgetsBinding.instance.addPostFrameCallback((_) => _frameWalk());
  }

  /// Круг целиком в кадре между чипами и шторкой.
  void _frameWalk() {
    final controller = _controller;
    final circle = _circle;
    final size = _mapSize;
    if (!mounted || controller == null || size == null) return;
    if (circle == null || !_framing.take()) return;
    final sheet = _sheetKey.currentContext?.findRenderObject() as RenderBox?;
    final box = walkFrame(
      center: circle.$1,
      radiusMeters: circle.$2,
      viewport: size,
      topInset: _chipsBottom,
      bottomInset: sheet?.hasSize == true ? sheet!.size.height : 0,
    );
    controller.moveCamera(
      CameraUpdate.newGeometry(Geometry.fromBoundingBox(box)),
      animation: const MapAnimation(duration: 0.5),
    );
  }

  /// Нажатие на мини-карточку: камера едет к месту, пин жёлтый, карточка-
  /// превью поверх шторки.
  void _onWalkPlaceTap(Establishment establishment) {
    final lat = establishment.latitude;
    final lng = establishment.longitude;
    if (lat == null || lng == null) return;
    setState(() {
      _selectedId = establishment.id;
      _rebuildMap();
    });
    _controller?.moveCamera(
      CameraOnPoint(Point(latitude: lat, longitude: lng), kFocusZoom)
          .toCameraUpdate(),
      animation: const MapAnimation(duration: 0.5),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    return LayoutBuilder(
      builder: (context, constraints) {
        _mapSize = constraints.biggest;
        return Stack(
          children: [
            Positioned.fill(child: _map),
            if (_walkAvailable)
              Positioned(
                // Видимый верх чипа — на 44; зона нажатия выше на поле.
                top: _chipsTop -
                    (MapFilterChip.minTapHeight - MapFilterChip.visibleHeight) /
                        2,
                left: 12,
                right: 12,
                child: _buildChips(),
              ),
            if (_walking)
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                // Карточка-превью — поверх шторки; шторка под ней не видна
                // и не ловит касаний, но помнит прокрутку: закрыли
                // карточку — шторка вернулась как была.
                child: Visibility(
                  visible: selected == null,
                  maintainState: true,
                  maintainAnimation: true,
                  maintainSize: true,
                  child: KeyedSubtree(
                    key: _sheetKey,
                    child: _buildSheet(),
                  ),
                ),
              ),
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
                          // Второе нажатие до кадра застаёт выбор уже
                          // пустым — второй карточки заведения нет (как на
                          // вкладке «Карта»).
                          if (_selectedId == null) return;
                          // Карточка закрыта, пин прежний, затем переход.
                          _closePreview();
                          widget.onDetails(selected);
                        },
                        secondaryAction: RouteButton(
                          latitude: selected.latitude!,
                          longitude: selected.longitude!,
                          // Из прогулки — сразу пешком.
                          mode:
                              _walking ? RouteMode.walking : RouteMode.driving,
                        ),
                      ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildChips() {
    final minutes = _walkMinutes;
    // Крупный системный шрифт — не больше ×1,2, как у карточки списка; ряд
    // на узком экране ужимается целиком, подписи остаются полными.
    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.2,
      child: Align(
        alignment: Alignment.topLeft,
        child: FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.topLeft,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              MapFilterChip(
                icon: Icons.directions_walk,
                label: minutes == null
                    ? 'Пешком'
                    : walkMinutesChoiceLabel(minutes),
                active: minutes != null,
                onTap: _onWalkChipTap,
              ),
              if (minutes != null) ...[
                const SizedBox(width: 8),
                MapFilterChip(
                  icon: _openNowOnly ? Icons.check : null,
                  label: 'Открыто сейчас',
                  active: _openNowOnly,
                  onTap: _toggleOpenNow,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSheet() {
    final minutes = _walkMinutes!;
    final position = _position;
    final Widget sheet;
    if (position == null) {
      sheet = _locateFailed
          ? WalkReachSheet(
              title: 'Не удалось точно определить, где вы',
              action: (label: 'Повторить', onTap: _retryLocate),
            )
          : const WalkReachSheet(title: 'Ищем, где вы…', busy: true);
    } else {
      final reach = walkReach(
        widget.establishments,
        from: position,
        minutes: minutes,
        openNowOnly: _openNowOnly,
      );
      final more = minutes < kWalkMinuteOptions.last
          ? (label: 'Выбрать больше минут', onTap: _openMinutesSheet)
          : null;
      if (reach.shown > 0) {
        sheet = WalkReachSheet(
          title: walkReachTitle(reach.shown, minutes),
          caption: 'из избранного',
          places: reach.places,
          onPlaceTap: _onWalkPlaceTap,
        );
      } else if (reach.inCircle > 0) {
        // В круге есть места, но «Открыто сейчас» все убрал.
        sheet = WalkReachSheet(
          title: '${_capitalized(walkWithinLabel(minutes))} всё из '
              'избранного сейчас закрыто',
          action: more,
        );
      } else {
        sheet = WalkReachSheet(
          title: '${_capitalized(walkWithinLabel(minutes))} ничего из '
              'избранного',
          action: more,
        );
      }
    }
    return MediaQuery.withClampedTextScaling(maxScaleFactor: 1.2, child: sheet);
  }

  static String _capitalized(String text) =>
      text.isEmpty ? text : text[0].toUpperCase() + text.substring(1);
}
