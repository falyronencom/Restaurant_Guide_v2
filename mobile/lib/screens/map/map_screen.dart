import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';

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

  // Colors
  static const Color _primaryOrange = Color(0xFFFD5F1B);
  static const Color _creamBackground = Color(0xFFF4F1EC);
  static const Color _starYellow = Color(0xFFFFB800);

  YandexMapController? _mapController;
  final EstablishmentsService _establishmentsService = EstablishmentsService();

  List<PlacemarkMapObject> _placemarks = [];
  bool _isLoading = false;
  String? _errorMessage;
  Uint8List? _markerIcon;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Yandex Map
          YandexMap(
            onMapCreated: _onMapCreated,
            onCameraPositionChanged: _onCameraPositionChanged,
            mapObjects: _placemarks,
          ),

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
                    color: Colors.white,
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
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.arrow_back_ios_new,
                    color: Colors.white,
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
              backgroundColor: Colors.white,
              onPressed: _goToDefaultLocation,
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
    _createMarkerIcon();
  }

  /// Create marker icon programmatically (orange circle with white border)
  Future<void> _createMarkerIcon() async {
    const double size = 48;
    const double radius = 20;
    const double borderWidth = 3;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);

    // White border
    final borderPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;
    canvas.drawCircle(const Offset(size / 2, size / 2), radius, borderPaint);

    // Orange fill
    final fillPaint = Paint()
      ..color = _primaryOrange
      ..style = PaintingStyle.fill;
    canvas.drawCircle(
      const Offset(size / 2, size / 2),
      radius - borderWidth,
      fillPaint,
    );

    final picture = recorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);

    if (byteData != null && mounted) {
      setState(() {
        _markerIcon = byteData.buffer.asUint8List();
      });
    }
  }

  void _onMapCreated(YandexMapController controller) async {
    _mapController = controller;

    // Determine initial position: focused establishment or default (Minsk)
    final focused = widget.focusedEstablishment;
    final Point initialTarget;
    final double initialZoom;

    if (focused != null && focused.latitude != null && focused.longitude != null) {
      // Center on focused establishment with closer zoom
      initialTarget = Point(
        latitude: focused.latitude!,
        longitude: focused.longitude!,
      );
      initialZoom = 15.0; // Closer zoom for focused view
    } else {
      initialTarget = _defaultCenter;
      initialZoom = _defaultZoom;
    }

    await controller.moveCamera(
      CameraUpdate.newCameraPosition(
        CameraPosition(
          target: initialTarget,
          zoom: initialZoom,
        ),
      ),
    );

    // Fetch establishments for initial view
    _fetchEstablishmentsForCurrentBounds();

    // Show preview for focused establishment after markers are loaded
    if (focused != null) {
      // Small delay to ensure markers are rendered
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
        ? FilterConstants.categoriesToApi(provider.categoryFilters.toList())
        : null;
    final List<String>? apiCuisines = provider.cuisineFilters.isNotEmpty
        ? FilterConstants.cuisinesToApi(provider.cuisineFilters.toList())
        : null;
    // Backend /search/map expects single priceRange value (not array like categories/cuisines)
    final String? apiPriceRange = provider.priceFilters.isNotEmpty
        ? provider.priceFilters.first.apiValue
        : null;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // Get visible region from controller
      final VisibleRegion visibleRegion = await _mapController!.getVisibleRegion();

      final double north = visibleRegion.topRight.latitude;
      final double south = visibleRegion.bottomLeft.latitude;
      final double east = visibleRegion.topRight.longitude;
      final double west = visibleRegion.bottomLeft.longitude;

      // Fetch establishments within bounds with filters
      final establishments = await _establishmentsService.searchByMapBounds(
        north: north,
        south: south,
        east: east,
        west: west,
        categories: apiCategories,
        cuisines: apiCuisines,
        priceRange: apiPriceRange,
      );

      final placemarks = _createPlacemarks(establishments);

      setState(() {
        _placemarks = placemarks;
        _isLoading = false;
      });

      // Show snackbar if no establishments in area
      if (establishments.isEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('В этой области нет заведений'),
            duration: Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Ошибка загрузки заведений';
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_errorMessage!),
            backgroundColor: Colors.red,
            behavior: SnackBarBehavior.floating,
            action: SnackBarAction(
              label: 'Повторить',
              textColor: Colors.white,
              onPressed: _fetchEstablishmentsForCurrentBounds,
            ),
          ),
        );
      }
    }
  }

  List<PlacemarkMapObject> _createPlacemarks(List<Establishment> establishments) {
    return establishments
        .where((e) => e.latitude != null && e.longitude != null)
        .map((establishment) {
      return PlacemarkMapObject(
        mapId: MapObjectId('marker_${establishment.id}'),
        point: Point(
          latitude: establishment.latitude!,
          longitude: establishment.longitude!,
        ),
        icon: _markerIcon != null
            ? PlacemarkIcon.single(
                PlacemarkIconStyle(
                  image: BitmapDescriptor.fromBytes(_markerIcon!),
                  scale: 1.0,
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
          _showEstablishmentPreview(establishment);
        },
      );
    }).toList();
  }

  void _showEstablishmentPreview(Establishment establishment) {
    showModalBottomSheet(
      context: context,
      backgroundColor: _creamBackground,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _buildPreviewContent(establishment),
    );
  }

  Widget _buildPreviewContent(Establishment establishment) {
    return Container(
      padding: const EdgeInsets.all(16),
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

          // Content row
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Thumbnail
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
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
            ],
          ),

          const SizedBox(height: 16),

          // Button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                Navigator.of(context).pop(); // Close bottom sheet
                _navigateToDetail(establishment);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: _primaryOrange,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
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
    );
  }

  void _navigateToDetail(Establishment establishment) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => EstablishmentDetailScreen(
          establishmentId: establishment.id,
        ),
      ),
    );
  }

  void _goToDefaultLocation() {
    _mapController?.moveCamera(
      CameraUpdate.newCameraPosition(
        const CameraPosition(
          target: _defaultCenter,
          zoom: _defaultZoom,
        ),
      ),
      animation: const MapAnimation(
        type: MapAnimationType.smooth,
        duration: 1.0,
      ),
    );
  }
}
