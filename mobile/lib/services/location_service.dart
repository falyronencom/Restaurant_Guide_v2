import 'package:flutter/foundation.dart';
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
    debugPrint('LocationService: checkPermission() called');

    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    debugPrint('LocationService: isLocationServiceEnabled = $serviceEnabled');
    if (!serviceEnabled) {
      return false;
    }

    LocationPermission permission = await Geolocator.checkPermission();
    debugPrint('LocationService: current permission = $permission');

    if (permission == LocationPermission.denied) {
      debugPrint('LocationService: requesting permission...');
      permission = await Geolocator.requestPermission();
      debugPrint('LocationService: permission after request = $permission');
      if (permission == LocationPermission.denied) {
        return false;
      }
    }

    if (permission == LocationPermission.deniedForever) {
      debugPrint('LocationService: permission denied forever');
      return false;
    }

    debugPrint('LocationService: permission granted');
    return true;
  }

  /// Get current GPS position
  /// Uses getLastKnownPosition() first (instant, cached) with getCurrentPosition() fallback
  Future<Position?> getCurrentPosition() async {
    try {
      debugPrint('LocationService: getCurrentPosition() starting...');

      bool hasPermission = await checkPermission();
      if (!hasPermission) {
        debugPrint('LocationService: no permission, returning null');
        return null;
      }

      // Try cached position first (instant on emulator)
      debugPrint('LocationService: trying getLastKnownPosition()...');
      Position? position = await Geolocator.getLastKnownPosition();

      if (position != null) {
        debugPrint('LocationService: got cached position: ${position.latitude}, ${position.longitude}');
        _lastKnownPosition = position;
        return position;
      }

      // Fallback to fresh GPS (may timeout on emulator)
      debugPrint('LocationService: no cache, trying getCurrentPosition()...');
      _lastKnownPosition = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        timeLimit: const Duration(seconds: 5),
      );

      debugPrint('LocationService: got fresh position: ${_lastKnownPosition?.latitude}, ${_lastKnownPosition?.longitude}');
      return _lastKnownPosition;
    } catch (e) {
      debugPrint('LocationService: Error getting position: $e');
      return null;
    }
  }

  /// Check if permission is permanently denied (user must go to Settings)
  Future<bool> isPermissionDeniedForever() async {
    final permission = await Geolocator.checkPermission();
    return permission == LocationPermission.deniedForever;
  }

  /// Open device app settings so user can grant location permission
  Future<bool> openSettings() async {
    return Geolocator.openAppSettings();
  }

  /// Calculate distance between two points in kilometers
  double calculateDistance(double lat1, double lng1, double lat2, double lng2) {
    return Geolocator.distanceBetween(lat1, lng1, lat2, lng2) / 1000;
  }
}
