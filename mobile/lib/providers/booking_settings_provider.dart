import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/booking_settings.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Provider for partner booking settings management.
/// Follows PromotionProvider pattern.
class BookingSettingsProvider with ChangeNotifier {
  final ApiClient _apiClient = ApiClient();

  BookingSettingsProvider() {
    AccountScope.register(resetAccountScope);
  }

  /// Bumped on every account-scope reset; a request started under the
  /// previous account captured an older value and drops its write, so a late
  /// answer can never show the previous account's data (pack 1 of the critics'
  /// findings, point 4 — Codex C2; the pattern of PartnerDashboardProvider).
  int _generation = 0;

  /// Clears the partner's booking settings; registered in [AccountScope],
  /// runs on logout / account switch.
  void resetAccountScope() {
    _generation++;
    _settings = null;
    _isLoading = false;
    _error = null;
    notifyListeners();
  }

  // State
  BookingSettings? _settings;
  bool _isLoading = false;
  String? _error;

  // Getters
  BookingSettings? get settings => _settings;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isActivated => _settings != null && _settings!.isEnabled;

  /// Load booking settings for an establishment
  Future<void> loadSettings(String establishmentId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    final generation = _generation;
    try {
      final response = await _apiClient
          .get('/api/v1/partner/booking-settings/$establishmentId');
      if (generation != _generation) return; // account switched mid-flight

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = (response.data as Map<String, dynamic>)['data'];
        _settings = data != null
            ? BookingSettings.fromJson(data as Map<String, dynamic>)
            : null;
      }
    } catch (e) {
      if (generation != _generation) return;
      _error = 'Ошибка загрузки настроек бронирования';
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  /// Activate booking (wizard completion)
  Future<bool> activateBooking(
    String establishmentId,
    Map<String, dynamic> settingsData,
  ) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    final generation = _generation;
    try {
      final response = await _apiClient.post(
        '/api/v1/partner/booking-settings/$establishmentId/activate',
        data: settingsData,
      );
      if (generation != _generation) return false; // account switched mid-flight

      if (response.statusCode == 201 && response.data is Map<String, dynamic>) {
        final data = (response.data as Map<String, dynamic>)['data'];
        if (data != null) {
          _settings = BookingSettings.fromJson(data as Map<String, dynamic>);
        }
        _isLoading = false;
        notifyListeners();
        return true;
      }
      _error = 'Не удалось активировать бронирование';
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      if (generation != _generation) return false;
      _error = 'Ошибка активации бронирования';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// Update existing settings
  Future<bool> updateSettings(
    String establishmentId,
    Map<String, dynamic> settingsData,
  ) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    final generation = _generation;
    try {
      final response = await _apiClient.put(
        '/api/v1/partner/booking-settings/$establishmentId',
        data: settingsData,
      );
      if (generation != _generation) return false; // account switched mid-flight

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = (response.data as Map<String, dynamic>)['data'];
        if (data != null) {
          _settings = BookingSettings.fromJson(data as Map<String, dynamic>);
        }
        _isLoading = false;
        notifyListeners();
        return true;
      }
      _error = 'Не удалось обновить настройки';
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      if (generation != _generation) return false;
      _error = 'Ошибка обновления настроек';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// Deactivate booking
  Future<bool> deactivateBooking(String establishmentId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    final generation = _generation;
    try {
      final response = await _apiClient.post(
        '/api/v1/partner/booking-settings/$establishmentId/deactivate',
      );
      if (generation != _generation) return false; // account switched mid-flight

      if (response.statusCode == 200) {
        _settings = null;
        _isLoading = false;
        notifyListeners();
        return true;
      }
      _error = 'Не удалось отключить бронирование';
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      if (generation != _generation) return false;
      _error = 'Ошибка отключения бронирования';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
