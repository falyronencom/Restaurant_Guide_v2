import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Provider for push notification preferences (ChangeNotifier).
///
/// State: four booleans per category + loading flag.
/// Uses GET/PUT /api/v1/notifications/preferences with optimistic updates.
///
/// `menu_push_enabled` (backend migration 033) may be absent from a response
/// served by a backend whose schema predates it — read as `true`, the backend
/// default, so the toggle never flips off on its own.
class NotificationPreferencesProvider extends ChangeNotifier {
  final ApiClient _apiClient;

  /// [apiClient] is injectable for tests; the app uses the singleton.
  NotificationPreferencesProvider({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient() {
    AccountScope.register(resetAccountScope);
  }

  /// Bumped on every account-scope reset; a request started under the
  /// previous account captured an older value and drops its write, so a late
  /// answer can never show the previous account's data (pack 1 of the critics'
  /// findings, point 4 — Codex C2; the pattern of PartnerDashboardProvider).
  int _generation = 0;

  /// Back to defaults + not-initialized so the next account re-fetches its
  /// own preferences; registered in [AccountScope].
  void resetAccountScope() {
    _generation++;
    _bookingPushEnabled = true;
    _reviewsPushEnabled = true;
    _promotionsPushEnabled = true;
    _menuPushEnabled = true;
    _isLoading = false;
    _isInitialized = false;
    notifyListeners();
  }

  bool _bookingPushEnabled = true;
  bool _reviewsPushEnabled = true;
  bool _promotionsPushEnabled = true;
  bool _menuPushEnabled = true;
  bool _isLoading = false;
  bool _isInitialized = false;

  bool get bookingPushEnabled => _bookingPushEnabled;
  bool get reviewsPushEnabled => _reviewsPushEnabled;
  bool get promotionsPushEnabled => _promotionsPushEnabled;
  bool get menuPushEnabled => _menuPushEnabled;
  bool get isLoading => _isLoading;

  /// Fetch current preferences from backend.
  /// Returns defaults if no row exists (backend returns defaults).
  Future<void> fetchPreferences() async {
    if (_isLoading) return;
    _isLoading = true;
    notifyListeners();

    final generation = _generation;
    try {
      final response = await _apiClient.get(
        '/api/v1/notifications/preferences',
      );
      if (generation != _generation) return; // account switched mid-flight

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final prefs = data['data'] as Map<String, dynamic>? ?? data;

        _bookingPushEnabled = prefs['booking_push_enabled'] as bool? ?? true;
        _reviewsPushEnabled = prefs['reviews_push_enabled'] as bool? ?? true;
        _promotionsPushEnabled =
            prefs['promotions_push_enabled'] as bool? ?? true;
        _menuPushEnabled = prefs['menu_push_enabled'] as bool? ?? true;
      }
      _isInitialized = true;
    } catch (e) {
      if (generation != _generation) return;
      debugPrint('Failed to fetch notification preferences: $e');
      // Keep defaults on error
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  /// Update a preference category. Optimistic update with rollback on failure.
  ///
  /// Only the categories passed are sent — the backend keeps the rest as is.
  Future<void> updatePreferences({
    bool? booking,
    bool? reviews,
    bool? promotions,
    bool? menu,
  }) async {
    // Save previous state for rollback
    final prevBooking = _bookingPushEnabled;
    final prevReviews = _reviewsPushEnabled;
    final prevPromotions = _promotionsPushEnabled;
    final prevMenu = _menuPushEnabled;

    // Optimistic update
    if (booking != null) _bookingPushEnabled = booking;
    if (reviews != null) _reviewsPushEnabled = reviews;
    if (promotions != null) _promotionsPushEnabled = promotions;
    if (menu != null) _menuPushEnabled = menu;
    notifyListeners();

    final generation = _generation;
    try {
      final body = <String, dynamic>{};
      if (booking != null) body['booking_push_enabled'] = booking;
      if (reviews != null) body['reviews_push_enabled'] = reviews;
      if (promotions != null) body['promotions_push_enabled'] = promotions;
      if (menu != null) body['menu_push_enabled'] = menu;

      await _apiClient.put(
        '/api/v1/notifications/preferences',
        data: body,
      );
    } catch (e) {
      // Rollback on failure — unless the account changed meanwhile: the
      // toggles being restored are the previous account's.
      if (generation != _generation) return;
      _bookingPushEnabled = prevBooking;
      _reviewsPushEnabled = prevReviews;
      _promotionsPushEnabled = prevPromotions;
      _menuPushEnabled = prevMenu;
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
