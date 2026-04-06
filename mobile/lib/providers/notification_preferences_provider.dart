import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Provider for push notification preferences (ChangeNotifier).
///
/// State: three booleans per category + loading flag.
/// Uses GET/PUT /api/v1/notifications/preferences with optimistic updates.
class NotificationPreferencesProvider extends ChangeNotifier {
  final ApiClient _apiClient = ApiClient();

  bool _bookingPushEnabled = true;
  bool _reviewsPushEnabled = true;
  bool _promotionsPushEnabled = true;
  bool _isLoading = false;
  bool _isInitialized = false;

  bool get bookingPushEnabled => _bookingPushEnabled;
  bool get reviewsPushEnabled => _reviewsPushEnabled;
  bool get promotionsPushEnabled => _promotionsPushEnabled;
  bool get isLoading => _isLoading;

  /// Fetch current preferences from backend.
  /// Returns defaults if no row exists (backend returns defaults).
  Future<void> fetchPreferences() async {
    if (_isLoading) return;
    _isLoading = true;
    notifyListeners();

    try {
      final response = await _apiClient.get(
        '/api/v1/notifications/preferences',
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final prefs = data['data'] as Map<String, dynamic>? ?? data;

        _bookingPushEnabled = prefs['booking_push_enabled'] as bool? ?? true;
        _reviewsPushEnabled = prefs['reviews_push_enabled'] as bool? ?? true;
        _promotionsPushEnabled =
            prefs['promotions_push_enabled'] as bool? ?? true;
      }
      _isInitialized = true;
    } catch (e) {
      debugPrint('Failed to fetch notification preferences: $e');
      // Keep defaults on error
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Update a preference category. Optimistic update with rollback on failure.
  Future<void> updatePreferences({
    bool? booking,
    bool? reviews,
    bool? promotions,
  }) async {
    // Save previous state for rollback
    final prevBooking = _bookingPushEnabled;
    final prevReviews = _reviewsPushEnabled;
    final prevPromotions = _promotionsPushEnabled;

    // Optimistic update
    if (booking != null) _bookingPushEnabled = booking;
    if (reviews != null) _reviewsPushEnabled = reviews;
    if (promotions != null) _promotionsPushEnabled = promotions;
    notifyListeners();

    try {
      final body = <String, dynamic>{};
      if (booking != null) body['booking_push_enabled'] = booking;
      if (reviews != null) body['reviews_push_enabled'] = reviews;
      if (promotions != null) body['promotions_push_enabled'] = promotions;

      await _apiClient.put(
        '/api/v1/notifications/preferences',
        data: body,
      );
    } catch (e) {
      // Rollback on failure
      _bookingPushEnabled = prevBooking;
      _reviewsPushEnabled = prevReviews;
      _promotionsPushEnabled = prevPromotions;
      notifyListeners();
      debugPrint('Failed to update notification preferences: $e');
    }
  }

  /// Ensure preferences are loaded (call on screen open).
  Future<void> ensureLoaded() async {
    if (!_isInitialized) {
      await fetchPreferences();
    }
  }
}
