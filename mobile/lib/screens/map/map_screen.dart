import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';
import 'package:restaurant_guide_mobile/services/location_service.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_clustering.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_painter.dart';

/// Map screen displaying establishments on Yandex Map
/// Users can explore restaurants geographically and tap markers for previews
class MapScreen extends StatefulWidget {
  /// Optional establishment to focus on when opening the map.
  /// When provided, the map will center on this establishment
  /// and automatically show its preview.
  final Establishment? focusedEstablishment;

  const MapScreen({
    super.key,
    this.focusedEstablishment,
  });

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  // Default center: Minsk, Belarus
  static const Point _defaultCenter = Point(latitude: 53.9006, longitude: 27.5590);
  static const double _defaultZoom = 13.0;

  // One request covers the whole visible city. At the old 100 a city view
  // with more cards than that silently lost the lowest-rated ones, and a
  // bubble would under-count its group. 500 is the backend's ceiling for
  // /search/map (searchService.searchByBounds) and the web map's FETCH_LIMIT.
  static const int _fetchLimit = 500;

  static const MapObjectId _clusterCollectionId =
      MapObjectId('establishment_clusters');

  // Colors
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _creamBackground = AppTheme.backgroundWarm;
  static const Color _starYellow = Color(0xFFFFB800);

  YandexMapController? _mapController;
  final EstablishmentsService _establishmentsService = EstablishmentsService();

  List<Establishment> _establishments = [];

  /// The map widget, kept between builds and replaced only when the pins
  /// change ([_rebuildMap]). Every update of a YandexMap re-hashes all its
  /// pins, image bytes included (the plugin diffs map objects through
  /// equatable, which does not cache hashCode): a fresh widget on each build
  /// would pay that on every frame of dragging the preview card.
  late Widget _map = _buildMap();

  /// What the pins on the map show: [pinContent] as of the last
  /// [_rebuildMap]. A refetch is compared with this, not with the previous
  /// list — open state comes from the clock, so both lists evaluated now
  /// would always agree, and a place that opened or closed since the pins
  /// were drawn would keep its old colour.
  List<Object?> _mapPins = const [];

  bool _isLoading = false;
  bool _isEmpty = false;
  String? _errorMessage;
  final MapMarkerGenerator _markerGenerator = MapMarkerGenerator();

  /// Currently selected establishment for inline preview (replaces modal bottom sheet)
  Establishment? _selectedEstablishment;

  /// Drag offset for swipe-to-dismiss gesture (0 = resting, positive = dragged down)
  double _previewDragOffset = 0.0;

  /// Track last known city to detect changes when returning to map tab
  String? _lastCity;

  /// Gate flag: skip onCameraPositionChanged until initial moveCamera completes.
  /// Prevents race condition on real iOS devices where the default camera position
  /// (world view) triggers a fetch+setState that interferes with moveCamera.
  bool _initialCameraReady = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Yandex Map
          _map,

          // Loading indicator
          if (_isLoading)
            Positioned(
              top: MediaQuery.of(context).padding.top + 16,
              left: 0,
              right: 0,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.backgroundPrimary,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.1),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(_primaryOrange),
                        ),
                      ),
                      SizedBox(width: 8),
                      Text(
                        'Загрузка...',
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.black87,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

          // Empty state overlay
          if (_isEmpty && !_isLoading && _errorMessage == null)
            Positioned(
              bottom: 80,
              left: 16,
              right: 16,
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.backgroundPrimary,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.12),
                      blurRadius: 10,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.location_off_outlined,
                      size: 36,
                      color: AppTheme.textGrey,
                    ),
                    SizedBox(height: 8),
                    Text(
                      'В этой области нет заведений',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                        color: Colors.black87,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Попробуйте изменить масштаб карты или переместиться в другую область',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.textGrey,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),

          // Error state overlay
          if (_errorMessage != null && !_isLoading)
            Positioned(
              bottom: 80,
              left: 16,
              right: 16,
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.backgroundPrimary,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.12),
                      blurRadius: 10,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.wifi_off_rounded,
                      size: 28,
                      color: AppTheme.textGrey,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _errorMessage!,
                        style: const TextStyle(
                          fontSize: 14,
                          color: Colors.black87,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    GestureDetector(
                      onTap: _fetchEstablishmentsForCurrentBounds,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: _primaryOrange,
                          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                        ),
                        child: const Text(
                          'Повторить',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppTheme.textOnPrimary,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

          // Establishment preview card (inline, no modal barrier)
          if (_selectedEstablishment != null)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: _buildPreviewContent(_selectedEstablishment!),
            ),

          // Back button (only when pushed as standalone route, not as tab)
          if (Navigator.of(context).canPop())
            Positioned(
              top: MediaQuery.of(context).padding.top + 12,
              left: 16,
              child: GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.6),
                    borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  ),
                  child: const Icon(
                    Icons.arrow_back_ios_new,
                    color: AppTheme.textOnPrimary,
                    size: 20,
                  ),
                ),
              ),
            ),

          // My location button
          Positioned(
            bottom: 24,
            right: 16,
            child: FloatingActionButton(
              mini: true,
              backgroundColor: AppTheme.backgroundPrimary,
              onPressed: _goToMyLocation,
              child: const Icon(
                Icons.my_location,
                color: _primaryOrange,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    _initMarkers();
    // Listen for city changes to re-center map when user switches city
    // and returns to the map tab
    final provider = context.read<EstablishmentsProvider>();
    _lastCity = provider.selectedCity;
    provider.addListener(_onProviderChanged);
  }

  @override
  void dispose() {
    context.read<EstablishmentsProvider>().removeListener(_onProviderChanged);
    super.dispose();
  }

  /// React to provider changes — fly to new city when selectedCity changes
  void _onProviderChanged() {
    final provider = context.read<EstablishmentsProvider>();
    final currentCity = provider.selectedCity;
    if (currentCity != _lastCity && _mapController != null) {
      _lastCity = currentCity;
      // Animate camera to new city center
      final Point target;
      if (currentCity != null) {
        final (lat, lon) = CityOptions.coordinatesFor(currentCity);
        target = Point(latitude: lat, longitude: lon);
      } else {
        target = _defaultCenter;
      }
      _mapController!.moveCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(target: target, zoom: _defaultZoom),
        ),
        animation: const MapAnimation(
          type: MapAnimationType.smooth,
          duration: 1.0,
        ),
      );
    }
  }

  /// Pre-generate marker bitmaps (open + closed variants)
  Future<void> _initMarkers() async {
    final dpr = WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    await _markerGenerator.ensureInitialized(dpr);
    // Pins built before the bitmaps were ready carry the fallback icon.
    if (mounted) setState(_rebuildMap);
  }

  void _onMapCreated(YandexMapController controller) async {
    _mapController = controller;

    // Determine initial position priority:
    // 1. Focused establishment → center on it (zoom 15)
    // 2. Selected city from provider → center on city (zoom 13)
    // 3. Fallback → Minsk default (zoom 13)
    final focused = widget.focusedEstablishment;
    final Point initialTarget;
    final double initialZoom;

    if (focused != null && focused.latitude != null && focused.longitude != null) {
      // Center on focused establishment with closer zoom — above the
      // clustering threshold, so its pin is never inside a bubble
      initialTarget = Point(
        latitude: focused.latitude!,
        longitude: focused.longitude!,
      );
      initialZoom = kFocusZoom;
    } else {
      // Check selected city from provider
      final selectedCity = context.read<EstablishmentsProvider>().selectedCity;
      if (selectedCity != null) {
        final (lat, lon) = CityOptions.coordinatesFor(selectedCity);
        initialTarget = Point(latitude: lat, longitude: lon);
      } else {
        initialTarget = _defaultCenter;
      }
      initialZoom = _defaultZoom;
    }

    // On real iOS devices the native map view can silently ignore moveCamera
    // if called before the native view is fully initialized.  We fire an
    // immediate attempt (works when tile cache is warm, e.g. Minsk after using
    // the map tab), then retry after a longer delay for cold regions.
    final cameraPosition = CameraPosition(
      target: initialTarget,
      zoom: initialZoom,
    );

    // Attempt 1: immediate (often succeeds for cached tile regions)
    await controller.moveCamera(
      CameraUpdate.newCameraPosition(cameraPosition),
    );

    // Attempt 2: after native view is reliably ready
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    await controller.moveCamera(
      CameraUpdate.newCameraPosition(cameraPosition),
    );

    // Let the map settle before enabling user-driven camera tracking
    await Future.delayed(const Duration(milliseconds: 250));
    if (!mounted) return;

    // Now safe to respond to user camera movements
    _initialCameraReady = true;

    // Fetch establishments for the correct (post-move) position
    _fetchEstablishmentsForCurrentBounds();

    // Show preview for focused establishment after markers load
    if (focused != null) {
      Future.delayed(const Duration(milliseconds: 500), () {
        if (mounted) {
          _showEstablishmentPreview(focused);
        }
      });
    }
  }

  void _onCameraPositionChanged(
    CameraPosition position,
    CameraUpdateReason reason,
    bool finished,
  ) {
    // Skip until initial camera positioning is complete.
    // On real iOS devices, this fires for the default world-view position
    // before moveCamera finishes, causing a fetch+setState that resets the camera.
    if (!_initialCameraReady) return;

    // Only fetch when camera movement finished
    if (finished) {
      _fetchEstablishmentsForCurrentBounds();
    }
  }

  Future<void> _fetchEstablishmentsForCurrentBounds() async {
    if (_mapController == null) return;

    // Get current filters from provider BEFORE async operations
    final provider = context.read<EstablishmentsProvider>();
    final List<String>? apiCategories = provider.categoryFilters.isNotEmpty
        ? provider.categoryFilters.toList()
        : null;
    final List<String>? apiCuisines = provider.cuisineFilters.isNotEmpty
        ? provider.cuisineFilters.toList()
        : null;
    final List<String>? apiPriceRanges = provider.priceFilters.isNotEmpty
        ? provider.priceFilters.map((p) => p.apiValue).toList()
        : null;
    final String? apiSearch = provider.searchQuery;
    final String? apiHoursFilter = provider.hoursFilter?.apiValue;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _isEmpty = false;
    });

    try {
      // Get visible region from controller
      final VisibleRegion visibleRegion = await _mapController!.getVisibleRegion();

      // Add 30% buffer around visible bounds so markers don't
      // disappear at edges when panning slightly
      final double latSpan = visibleRegion.topRight.latitude - visibleRegion.bottomLeft.latitude;
      final double lonSpan = visibleRegion.topRight.longitude - visibleRegion.bottomLeft.longitude;
      const double bufferRatio = 0.3;

      final double north = visibleRegion.topRight.latitude + latSpan * bufferRatio;
      final double south = visibleRegion.bottomLeft.latitude - latSpan * bufferRatio;
      final double east = visibleRegion.topRight.longitude + lonSpan * bufferRatio;
      final double west = visibleRegion.bottomLeft.longitude - lonSpan * bufferRatio;

      // Fetch establishments within buffered bounds with filters
      final establishments = await _establishmentsService.searchByMapBounds(
        north: north,
        south: south,
        east: east,
        west: west,
        limit: _fetchLimit,
        categories: apiCategories,
        cuisines: apiCuisines,
        priceRanges: apiPriceRanges,
        search: apiSearch,
        hoursFilter: apiHoursFilter,
      );

      if (!mounted) return;
      // Most refetches (one per camera stop) bring back the pins already on
      // the map; the map widget then stays as it is (see [_map]).
      final pinsChanged = !listEquals(_mapPins, pinContent(establishments));
      setState(() {
        _establishments = establishments;
        if (pinsChanged) _rebuildMap();
        _isLoading = false;
        _isEmpty = establishments.isEmpty;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = 'Не удалось загрузить заведения';
      });
    }
  }

  /// A new map widget carrying the current pins (see [_map]).
  Widget _buildMap() {
    return YandexMap(
      onMapCreated: _onMapCreated,
      onCameraPositionChanged: _onCameraPositionChanged,
      mapObjects: [_buildClusterCollection()],
    );
  }

  void _rebuildMap() {
    _mapPins = pinContent(_establishments);
    _map = _buildMap();
  }

  /// All pins go into one collection that MapKit clusters by screen distance
  /// (see map_clustering.dart). The collection stays on the map for the
  /// screen's lifetime, empty or not — only its pins change. Removing it would
  /// hit a plugin defect on Android: the removal notice is sent under a key
  /// the Dart side does not read.
  ClusterizedPlacemarkCollection _buildClusterCollection() {
    return ClusterizedPlacemarkCollection(
      mapId: _clusterCollectionId,
      placemarks: _createPlacemarks(_establishments),
      radius: kClusterRadius,
      minZoom: kClusterMaxZoom,
      onClusterAdded: _styleCluster,
      onClusterTap: _zoomIntoCluster,
    );
  }

  /// Gives a new bubble its image: the group's count in a brand circle.
  /// Without it MapKit shows a bare placemark at half opacity (the plugin's
  /// default for a cluster's appearance).
  Future<Cluster?> _styleCluster(
    ClusterizedPlacemarkCollection self,
    Cluster cluster,
  ) async {
    final image = _markerGenerator.getClusterImage(cluster.size);
    if (image == null) return null;
    final Uint8List bytes;
    try {
      bytes = await image;
    } catch (_) {
      // An error here would reach MapKit as a failed callback, and the bubble
      // would lose its tap listener. Plain appearance until the next clustering.
      return null;
    }
    return cluster.copyWith(
      appearance: cluster.appearance.copyWith(
        opacity: 1.0,
        icon: PlacemarkIcon.single(
          PlacemarkIconStyle(
            image: BitmapDescriptor.fromBytes(bytes),
            scale: 1.0,
          ),
        ),
      ),
    );
  }

  /// A tap on a bubble zooms into its members, as on the web.
  void _zoomIntoCluster(ClusterizedPlacemarkCollection self, Cluster cluster) {
    final extent = clusterExtent(cluster.placemarks.map((p) => p.point));
    if (extent == null) return;
    _mapController?.moveCamera(
      CameraUpdate.newGeometry(Geometry.fromBoundingBox(extent)),
      animation: const MapAnimation(
        type: MapAnimationType.smooth,
        duration: 0.5,
      ),
    );
  }

  List<PlacemarkMapObject> _createPlacemarks(List<Establishment> establishments) {
    final valid = establishments
        .where((e) => e.latitude != null && e.longitude != null)
        .toList();

    // Sort: selected marker last so it renders on top of others
    if (_selectedEstablishment != null) {
      final selectedId = _selectedEstablishment!.id;
      valid.sort((a, b) {
        if (a.id == selectedId) return 1;
        if (b.id == selectedId) return -1;
        return 0;
      });
    }

    return valid.map((establishment) {
      final bool selected = _selectedEstablishment?.id == establishment.id;
      final markerBytes = _markerGenerator.getMarkerImage(
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
                  image: BitmapDescriptor.fromAssetImage('packages/yandex_mapkit/assets/place.png'),
                  scale: 2.0,
                ),
              ),
        opacity: 1.0,
        onTap: (PlacemarkMapObject self, Point point) {
          _onPinTap(establishment.id);
        },
      );
    }).toList();
  }

  /// A pin carries only its establishment's id: pins outlive the list they
  /// were built from (a refetch with the same pins keeps them), so the
  /// establishment is read from the current list at tap time.
  void _onPinTap(String id) {
    final establishment = _establishments.where((e) => e.id == id).firstOrNull;
    if (establishment != null) _showEstablishmentPreview(establishment);
  }

  void _showEstablishmentPreview(Establishment establishment) {
    setState(() {
      _selectedEstablishment = establishment;
      _previewDragOffset = 0.0;
      _rebuildMap();
    });
  }

  void _dismissPreview() {
    setState(() {
      _selectedEstablishment = null;
      _rebuildMap();
    });
  }

  Widget _buildPreviewContent(Establishment establishment) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onVerticalDragUpdate: (details) {
        setState(() {
          // Only allow downward drag (clamp to >= 0)
          _previewDragOffset = (_previewDragOffset + details.delta.dy).clamp(0.0, double.infinity);
        });
      },
      onVerticalDragEnd: (details) {
        // Dismiss if dragged far enough (>80px) or fast enough (>200 px/s)
        if (_previewDragOffset > 80 || (details.primaryVelocity ?? 0) > 200) {
          _previewDragOffset = 0.0;
          _dismissPreview();
        } else {
          // Snap back to resting position
          setState(() => _previewDragOffset = 0.0);
        }
      },
      child: Transform.translate(
        offset: Offset(0, _previewDragOffset),
        child: Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _creamBackground,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle bar
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Content row with close button
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Thumbnail
              ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                child: SizedBox(
                  width: 100,
                  height: 100,
                  child: establishment.thumbnailUrl != null
                      ? CachedNetworkImage(
                          imageUrl: establishment.thumbnailUrl!,
                          fit: BoxFit.cover,
                          placeholder: (context, url) => Container(
                            color: Colors.grey[200],
                            child: const Icon(Icons.restaurant, color: Colors.grey),
                          ),
                          errorWidget: (context, url, error) => Container(
                            color: Colors.grey[200],
                            child: const Icon(Icons.restaurant, color: Colors.grey),
                          ),
                        )
                      : Container(
                          color: Colors.grey[200],
                          child: const Icon(Icons.restaurant, color: Colors.grey, size: 40),
                        ),
                ),
              ),

              const SizedBox(width: 12),

              // Info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Name
                    Text(
                      establishment.name,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: Colors.black87,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),

                    const SizedBox(height: 4),

                    // Rating
                    if (establishment.rating != null)
                      Row(
                        children: [
                          const Icon(Icons.star, color: _starYellow, size: 18),
                          const SizedBox(width: 4),
                          Text(
                            establishment.rating!.toStringAsFixed(1),
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                              color: Colors.black87,
                            ),
                          ),
                        ],
                      ),

                    const SizedBox(height: 4),

                    // Category
                    Text(
                      establishment.category,
                      style: TextStyle(
                        fontSize: 14,
                        color: Colors.grey[600],
                      ),
                    ),

                    const SizedBox(height: 4),

                    // Address
                    Text(
                      establishment.address,
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.grey[500],
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),

              const SizedBox(width: 8),

              // Close button
              GestureDetector(
                onTap: _dismissPreview,
                child: Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: Colors.grey[200],
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.close,
                    size: 18,
                    color: Colors.grey[600],
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                _dismissPreview();
                _navigateToDetail(establishment);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: _primaryOrange,
                foregroundColor: AppTheme.textOnPrimary,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                ),
              ),
              child: const Text(
                'Подробнее',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),

          // Bottom padding for safe area
          SizedBox(height: MediaQuery.of(context).padding.bottom),
        ],
      ),
    ),  // closes Transform.translate
    ),  // closes GestureDetector
    );
  }

  void _navigateToDetail(Establishment establishment) {
    // rootNavigator: карточка должна открываться поверх всего, как из избранного,
    // поиска и уведомлений. Без флага маршрут ложится в навигатор вкладки и
    // рисуется внутри body — нижнее меню остаётся на экране, а карточке достаётся
    // высота за вычетом этой полосы. Возврат по «назад» ведёт обратно на карту.
    Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute(
        builder: (context) => EstablishmentDetailScreen(
          establishmentId: establishment.id,
        ),
      ),
    );
  }

  void _goToDefaultLocation() {
    // Use selected city center if available, otherwise Minsk default
    final selectedCity = context.read<EstablishmentsProvider>().selectedCity;
    final Point target;
    if (selectedCity != null) {
      final (lat, lon) = CityOptions.coordinatesFor(selectedCity);
      target = Point(latitude: lat, longitude: lon);
    } else {
      target = _defaultCenter;
    }

    _mapController?.moveCamera(
      CameraUpdate.newCameraPosition(
        CameraPosition(
          target: target,
          zoom: _defaultZoom,
        ),
      ),
      animation: const MapAnimation(
        type: MapAnimationType.smooth,
        duration: 1.0,
      ),
    );
  }

  /// Go to user's real GPS location, fallback to default if unavailable
  Future<void> _goToMyLocation() async {
    final position = await LocationService().getCurrentPosition();

    if (position != null) {
      _mapController?.moveCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(
            target: Point(
              latitude: position.latitude,
              longitude: position.longitude,
            ),
            zoom: kFocusZoom,
          ),
        ),
        animation: const MapAnimation(
          type: MapAnimationType.smooth,
          duration: 1.0,
        ),
      );
    } else {
      _goToDefaultLocation(); // Fallback to Minsk center
    }
  }
}