import 'package:dio/dio.dart';

/// Result of a geocoding operation
class GeocodingResult {
  final double latitude;
  final double longitude;
  final String displayName;

  const GeocodingResult({
    required this.latitude,
    required this.longitude,
    required this.displayName,
  });
}

/// Geocoding service using OpenStreetMap Nominatim API
///
/// Converts address text (city + street + building) to coordinates.
/// Uses Nominatim (free, no API key required) with Belarus country restriction.
/// Designed to be swappable to Yandex Geocoder API when key is available.
///
/// Rate limit: Nominatim allows 1 request/second — caller must debounce.
class GeocodingService {
  static final GeocodingService _instance = GeocodingService._internal();
  factory GeocodingService() => _instance;

  late final Dio _dio;

  // Simple cache: last query → last result
  String? _lastQuery;
  GeocodingResult? _lastResult;

  GeocodingService._internal() {
    _dio = Dio(BaseOptions(
      baseUrl: 'https://nominatim.openstreetmap.org',
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      headers: {
        // Nominatim requires a valid User-Agent identifying the application
        'User-Agent': 'RestaurantGuideBelarus/1.0',
        'Accept': 'application/json',
      },
    ));
  }

  /// Geocode an address to coordinates
  ///
  /// Returns [GeocodingResult] with latitude/longitude, or null if not found.
  /// Caches the last successful result to avoid duplicate API calls.
  ///
  /// [city] — city name (e.g. "Минск")
  /// [street] — street name (e.g. "Победителей")
  /// [building] — building number (e.g. "10"), optional
  Future<GeocodingResult?> geocodeAddress({
    required String city,
    required String street,
    String? building,
  }) async {
    // Build query string
    final parts = <String>[city, street];
    if (building != null && building.isNotEmpty) {
      parts.add(building);
    }
    final query = parts.join(', ');

    // Return cached result if query unchanged
    if (query == _lastQuery && _lastResult != null) {
      return _lastResult;
    }

    try {
      final response = await _dio.get('/search', queryParameters: {
        'q': query,
        'format': 'json',
        'countrycodes': 'by',
        'limit': '1',
        'addressdetails': '0',
      });

      final data = response.data;
      if (data is! List || data.isEmpty) {
        return null;
      }

      final first = data[0] as Map<String, dynamic>;
      final lat = double.tryParse(first['lat']?.toString() ?? '');
      final lon = double.tryParse(first['lon']?.toString() ?? '');

      if (lat == null || lon == null) {
        return null;
      }

      final result = GeocodingResult(
        latitude: lat,
        longitude: lon,
        displayName: first['display_name']?.toString() ?? query,
      );

      // Cache result
      _lastQuery = query;
      _lastResult = result;

      return result;
    } on DioException {
      // Network error, timeout, etc. — return null silently
      return null;
    } catch (_) {
      return null;
    }
  }
}
