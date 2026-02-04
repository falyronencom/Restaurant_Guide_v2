import 'package:geolocator/geolocator.dart';

/// Service for handling device GPS location
class LocationService {
  static final LocationService _instance = LocationService._internal();
  factory LocationService() => _instance;
  LocationService._internal();

  Position? _lastKnownPosition;

  Position? get lastKnownPosition => _lastKnownPosition;

  /// Check and request location permission
  Future<bool> checkPermission() async {
    print('LocationService: checkPermission() called');

    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    print('LocationService: isLocationServiceEnabled = $serviceEnabled');
    if (!serviceEnabled) {
      return false;
    }

    LocationPermission permission = await Geolocator.checkPermission();
    print('LocationService: current permission = $permission');

    if (permission == LocationPermission.denied) {
      print('LocationService: requesting permission...');
      permission = await Geolocator.requestPermission();
      print('LocationService: permission after request = $permission');
      if (permission == LocationPermission.denied) {
        return false;
      }
    }

    if (permission == LocationPermission.deniedForever) {
      print('LocationService: permission denied forever');
      return false;
    }

    print('LocationService: permission granted');
    return true;
  }

  /// Get current GPS position
  /// Uses getLastKnownPosition() first (instant, cached) with getCurrentPosition() fallback
  Future<Position?> getCurrentPosition() async {
    try {
      print('LocationService: getCurrentPosition() starting...');

      bool hasPermission = await checkPermission();
      if (!hasPermission) {
        print('LocationService: no permission, returning null');
        return null;
      }

      // Try cached position first (instant on emulator)
      print('LocationService: trying getLastKnownPosition()...');
      Position? position = await Geolocator.getLastKnownPosition();

      if (position != null) {
        print('LocationService: got cached position: ${position.latitude}, ${position.longitude}');
        _lastKnownPosition = position;
        return position;
      }

      // Fallback to fresh GPS (may timeout on emulator)
      print('LocationService: no cache, trying getCurrentPosition()...');
      _lastKnownPosition = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        timeLimit: const Duration(seconds: 5),
      );

      print('LocationService: got fresh position: ${_lastKnownPosition?.latitude}, ${_lastKnownPosition?.longitude}');
      return _lastKnownPosition;
    } catch (e) {
      print('LocationService: Error getting position: $e');
      return null;
    }
  }

  /// Calculate distance between two points in kilometers
  double calculateDistance(double lat1, double lng1, double lat2, double lng2) {
    return Geolocator.distanceBetween(lat1, lng1, lat2, lng2) / 1000;
  }
}
