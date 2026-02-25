import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/services/geocoding_service.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';

/// Step 5: Address Step
/// Allows partner to enter establishment address: city, street, building, corpus
/// Includes geocoding via Nominatim and mini-map with tap-to-move pin
class AddressStep extends StatefulWidget {
  const AddressStep({super.key});

  @override
  State<AddressStep> createState() => _AddressStepState();
}

class _AddressStepState extends State<AddressStep> {
  late TextEditingController _streetController;
  late TextEditingController _buildingController;
  late TextEditingController _corpusController;
  late PartnerRegistrationProvider _provider;
  String? _selectedCity;

  // Geocoding state
  Timer? _debounceTimer;
  bool _isGeocoding = false;
  double? _pinLatitude;
  double? _pinLongitude;
  YandexMapController? _mapController;
  final MapMarkerGenerator _markerGenerator = MapMarkerGenerator();
  bool _markerReady = false;

  final GeocodingService _geocodingService = GeocodingService();

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _greyBorder = AppTheme.strokeGrey;
  static const Color _greyText = Color(0xFF949494);

  @override
  void initState() {
    super.initState();
    _provider = context.read<PartnerRegistrationProvider>();
    final provider = _provider;
    _streetController = TextEditingController(text: provider.data.street ?? '');
    _buildingController = TextEditingController(text: provider.data.building ?? '');
    // Parse corpus from building if present (format: "дом, корпус")
    final building = provider.data.building ?? '';
    if (building.contains(',')) {
      final parts = building.split(',');
      _buildingController.text = parts[0].trim();
      _corpusController = TextEditingController(text: parts.length > 1 ? parts[1].trim() : '');
    } else {
      _corpusController = TextEditingController();
    }
    _selectedCity = provider.data.city;

    // Restore pin position from provider if available
    if (provider.data.latitude != null && provider.data.longitude != null) {
      _pinLatitude = provider.data.latitude;
      _pinLongitude = provider.data.longitude;
    } else if (_selectedCity != null) {
      final coords = CityOptions.coordinatesFor(_selectedCity!);
      _pinLatitude = coords.$1;
      _pinLongitude = coords.$2;
    }

    // Initialize marker generator for custom map pins
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initMarkerGenerator();
    });
  }

  Future<void> _initMarkerGenerator() async {
    final dpr = MediaQuery.of(context).devicePixelRatio;
    await _markerGenerator.ensureInitialized(dpr);
    if (mounted) {
      setState(() => _markerReady = true);
    }
  }

  @override
  void dispose() {
    // If geocoding was scheduled but hasn't fired yet, run it now (fire-and-forget).
    // This prevents losing geocoded coordinates when the user navigates away
    // before the debounce timer fires.
    if (_debounceTimer?.isActive ?? false) {
      _debounceTimer!.cancel();
      _geocodeAndUpdateProvider();
    }
    _streetController.dispose();
    _buildingController.dispose();
    _corpusController.dispose();
    super.dispose();
  }

  /// Fire-and-forget geocoding that only updates the provider (no setState).
  /// Used in dispose() when user navigates away before debounce fires.
  void _geocodeAndUpdateProvider() {
    final city = _selectedCity;
    final street = _streetController.text.trim();
    if (city == null || city.isEmpty || street.isEmpty) return;

    final building = _buildingController.text.trim();
    final corpus = _corpusController.text.trim();
    final fullBuilding = corpus.isNotEmpty ? '$building, $corpus' : building;

    _geocodingService.geocodeAddress(
      city: city,
      street: street,
      building: building,
    ).then((result) {
      if (result != null) {
        _provider.updateAddress(
          city: city,
          street: street,
          building: fullBuilding,
          latitude: result.latitude,
          longitude: result.longitude,
        );
      }
    });
  }

  /// Update provider with current field values and schedule geocoding
  void _updateProvider() {
    String building = _buildingController.text.trim();
    if (_corpusController.text.trim().isNotEmpty) {
      building = '$building, ${_corpusController.text.trim()}';
    }
    _provider.updateAddress(
      city: _selectedCity,
      street: _streetController.text.trim(),
      building: building,
    );

    // Schedule geocoding with debounce
    _scheduleGeocode();
  }

  /// Schedule geocoding after 600ms of no input
  void _scheduleGeocode() {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 600), () {
      _geocodeCurrentAddress();
    });
  }

  /// Geocode the current address and update pin position
  Future<void> _geocodeCurrentAddress() async {
    final city = _selectedCity;
    final street = _streetController.text.trim();

    // Need at least city and street to geocode
    if (city == null || city.isEmpty || street.isEmpty) return;

    setState(() => _isGeocoding = true);

    final result = await _geocodingService.geocodeAddress(
      city: city,
      street: street,
      building: _buildingController.text.trim(),
    );

    if (!mounted) return;

    if (result != null) {
      setState(() {
        _pinLatitude = result.latitude;
        _pinLongitude = result.longitude;
        _isGeocoding = false;
      });

      // Move camera to geocoded point
      _mapController?.moveCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(
            target: Point(
              latitude: result.latitude,
              longitude: result.longitude,
            ),
            zoom: 16.0,
          ),
        ),
        animation: const MapAnimation(
          type: MapAnimationType.smooth,
          duration: 0.5,
        ),
      );

      // Update provider with geocoded coordinates
      _updateProviderCoordinates(result.latitude, result.longitude);
    } else {
      setState(() => _isGeocoding = false);
    }
  }

  /// Update provider with new coordinates (without triggering geocoding)
  void _updateProviderCoordinates(double lat, double lon) {
    String building = _buildingController.text.trim();
    if (_corpusController.text.trim().isNotEmpty) {
      building = '$building, ${_corpusController.text.trim()}';
    }
    _provider.updateAddress(
      city: _selectedCity,
      street: _streetController.text.trim(),
      building: building,
      latitude: lat,
      longitude: lon,
    );
  }

  /// Handle map tap — move pin to tapped location
  void _onMapTap(Point point) {
    setState(() {
      _pinLatitude = point.latitude;
      _pinLongitude = point.longitude;
    });

    _mapController?.moveCamera(
      CameraUpdate.newCameraPosition(
        CameraPosition(target: point, zoom: 16.0),
      ),
      animation: const MapAnimation(
        type: MapAnimationType.smooth,
        duration: 0.3,
      ),
    );

    _updateProviderCoordinates(point.latitude, point.longitude);
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),

          // Section header
          _buildSectionHeader(),

          const SizedBox(height: 24),

          // Address fields container
          _buildAddressFields(),

          const SizedBox(height: 16),

          // Mini-map (visible after city selection)
          if (_selectedCity != null) ...[
            _buildMiniMap(),
            const SizedBox(height: 8),
            if (_pinLatitude != null && _pinLongitude != null)
              _buildCoordinatesText(),
          ],

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  /// Build section header with title and subtitle
  Widget _buildSectionHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Заполните адрес',
          style: TextStyle(
            fontFamily: AppTheme.fontDisplayFamily,
            fontSize: 22,
            fontWeight: FontWeight.w400,
            color: AppTheme.textPrimary,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Выберите или введите данные местонахождения вашего заведения',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: _greyText,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 16),
        Container(
          height: 1,
          color: _greyBorder,
        ),
      ],
    );
  }

  /// Build address fields container
  Widget _buildAddressFields() {
    return Column(
      children: [
        // City and Street in one container
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: _greyBorder),
            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          ),
          child: Column(
            children: [
              _buildCityDropdown(),
              Container(height: 1, color: _greyBorder),
              _buildTextField(
                controller: _streetController,
                label: 'Улица',
                onChanged: (_) => _updateProvider(),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Building and Corpus in one row
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: _greyBorder),
            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          ),
          child: IntrinsicHeight(
            child: Row(
              children: [
                Expanded(
                  child: _buildTextField(
                    controller: _buildingController,
                    label: 'Дом',
                    onChanged: (_) => _updateProvider(),
                  ),
                ),
                Container(width: 1, color: _greyBorder),
                Expanded(
                  child: _buildTextField(
                    controller: _corpusController,
                    label: 'Корпус',
                    onChanged: (_) => _updateProvider(),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Build city dropdown
  Widget _buildCityDropdown() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedCity,
          isExpanded: true,
          hint: const Text(
            'Населенный пункт',
            style: TextStyle(
              fontSize: 16,
              color: _greyText,
            ),
          ),
          style: const TextStyle(
            fontSize: 16,
            color: AppTheme.textPrimary,
          ),
          icon: const Icon(Icons.keyboard_arrow_down, color: _greyText),
          dropdownColor: _backgroundColor,
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          items: CityOptions.cities.map((city) {
            return DropdownMenuItem<String>(
              value: city,
              child: Text(city),
            );
          }).toList(),
          onChanged: (value) {
            setState(() {
              _selectedCity = value;
            });
            if (value != null) {
              // Set city center as initial pin position
              final coords = CityOptions.coordinatesFor(value);
              setState(() {
                _pinLatitude = coords.$1;
                _pinLongitude = coords.$2;
              });

              _provider.updateAddress(
                city: value,
                street: _streetController.text.trim(),
                building: _buildingController.text.trim(),
                latitude: coords.$1,
                longitude: coords.$2,
              );

              // Move camera to city center
              _mapController?.moveCamera(
                CameraUpdate.newCameraPosition(
                  CameraPosition(
                    target: Point(latitude: coords.$1, longitude: coords.$2),
                    zoom: 13.0,
                  ),
                ),
                animation: const MapAnimation(
                  type: MapAnimationType.smooth,
                  duration: 0.5,
                ),
              );

              // If street is already filled, geocode with new city
              if (_streetController.text.trim().isNotEmpty) {
                _scheduleGeocode();
              }
            } else {
              _updateProvider();
            }
          },
        ),
      ),
    );
  }

  /// Build mini-map with pin
  Widget _buildMiniMap() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Map container
        Container(
          height: 200,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            border: Border.all(color: _greyBorder),
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              YandexMap(
                onMapCreated: (YandexMapController controller) {
                  _mapController = controller;
                  // Set initial camera position
                  if (_pinLatitude != null && _pinLongitude != null) {
                    controller.moveCamera(
                      CameraUpdate.newCameraPosition(
                        CameraPosition(
                          target: Point(
                            latitude: _pinLatitude!,
                            longitude: _pinLongitude!,
                          ),
                          zoom: _streetController.text.trim().isNotEmpty ? 16.0 : 13.0,
                        ),
                      ),
                    );
                  }
                },
                onMapTap: _onMapTap,
                mapObjects: _buildMapObjects(),
              ),

              // Loading overlay
              if (_isGeocoding)
                Container(
                  color: AppTheme.backgroundPrimary.withValues(alpha: 0.5),
                  child: const Center(
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.primaryOrange,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),

        const SizedBox(height: 8),

        // Hint text
        const Text(
          'Нажмите на карту для уточнения местоположения',
          style: TextStyle(
            fontSize: 12,
            color: _greyText,
          ),
        ),
      ],
    );
  }

  /// Build map objects (pin marker)
  List<PlacemarkMapObject> _buildMapObjects() {
    if (_pinLatitude == null || _pinLongitude == null) return [];

    final Uint8List? markerBytes = _markerReady
        ? _markerGenerator.getMarkerImage(isOpen: true)
        : null;

    return [
      PlacemarkMapObject(
        mapId: const MapObjectId('address_pin'),
        point: Point(
          latitude: _pinLatitude!,
          longitude: _pinLongitude!,
        ),
        icon: markerBytes != null
            ? PlacemarkIcon.single(
                PlacemarkIconStyle(
                  image: BitmapDescriptor.fromBytes(markerBytes),
                  scale: 1.0,
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
      ),
    ];
  }

  /// Build coordinates text below map
  Widget _buildCoordinatesText() {
    return Text(
      '${_pinLatitude!.toStringAsFixed(6)}, ${_pinLongitude!.toStringAsFixed(6)}',
      style: const TextStyle(
        fontSize: 11,
        color: _greyText,
        fontFeatures: [FontFeature.tabularFigures()],
      ),
    );
  }

  /// Build text field
  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required ValueChanged<String> onChanged,
  }) {
    return TextField(
      controller: controller,
      style: const TextStyle(
        fontSize: 16,
        color: AppTheme.textPrimary,
      ),
      decoration: InputDecoration(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        hintText: label,
        hintStyle: const TextStyle(
          fontSize: 16,
          color: _greyText,
        ),
      ),
      onChanged: onChanged,
    );
  }
}
