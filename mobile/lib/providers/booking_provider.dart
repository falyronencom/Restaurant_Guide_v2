import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/models/booking.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Provider for partner booking management.
/// Handles listing, confirming, declining, and status updates.
class BookingProvider with ChangeNotifier {
  final ApiClient _apiClient = ApiClient();

  // State
  List<Booking> _pendingBookings = [];
  List<Booking> _confirmedBookings = [];
  List<Booking> _historyBookings = [];
  bool _isLoading = false;
  String? _error;

  // Getters
  List<Booking> get pendingBookings => _pendingBookings;
  List<Booking> get confirmedBookings => _confirmedBookings;
  List<Booking> get historyBookings => _historyBookings;
  bool get isLoading => _isLoading;
  String? get error => _error;
  int get pendingCount => _pendingBookings.length;
  int get confirmedCount => _confirmedBookings.length;

  /// Load all partner bookings for an establishment
  Future<void> loadPartnerBookings(String establishmentId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _apiClient
          .get('/api/v1/partner/bookings/$establishmentId');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = (response.data as Map<String, dynamic>)['data'];
        final items = (data is Map<String, dynamic>)
            ? (data['items'] as List? ?? [])
            : (data is List ? data : []);

        final allBookings = items
            .map((b) => Booking.fromJson(b as Map<String, dynamic>))
            .toList();

        _pendingBookings =
            allBookings.where((b) => b.isPending).toList();
        _confirmedBookings =
            allBookings.where((b) => b.isConfirmed).toList();
        _historyBookings = allBookings
            .where((b) =>
                !b.isPending && !b.isConfirmed)
            .toList();
      }
    } catch (e) {
      _error = 'Ошибка загрузки бронирований';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Confirm a pending booking
  Future<bool> confirmBooking(
      String establishmentId, String bookingId) async {
    try {
      final response = await _apiClient.put(
        '/api/v1/partner/bookings/$establishmentId/$bookingId/confirm',
      );

      if (response.statusCode == 200) {
        await loadPartnerBookings(establishmentId);
        return true;
      }
      _error = 'Не удалось подтвердить бронь';
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Ошибка подтверждения';
      notifyListeners();
      return false;
    }
  }

  /// Decline a pending booking
  Future<bool> declineBooking(
      String establishmentId, String bookingId, String reason) async {
    try {
      final response = await _apiClient.put(
        '/api/v1/partner/bookings/$establishmentId/$bookingId/decline',
        data: {'reason': reason},
      );

      if (response.statusCode == 200) {
        await loadPartnerBookings(establishmentId);
        return true;
      }
      _error = 'Не удалось отклонить бронь';
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Ошибка отклонения';
      notifyListeners();
      return false;
    }
  }

  /// Mark as no-show
  Future<bool> markNoShow(
      String establishmentId, String bookingId) async {
    try {
      final response = await _apiClient.put(
        '/api/v1/partner/bookings/$establishmentId/$bookingId/no-show',
      );

      if (response.statusCode == 200) {
        await loadPartnerBookings(establishmentId);
        return true;
      }
      return false;
    } catch (e) {
      _error = 'Ошибка отметки неявки';
      notifyListeners();
      return false;
    }
  }

  /// Mark as completed
  Future<bool> markCompleted(
      String establishmentId, String bookingId) async {
    try {
      final response = await _apiClient.put(
        '/api/v1/partner/bookings/$establishmentId/$bookingId/complete',
      );

      if (response.statusCode == 200) {
        await loadPartnerBookings(establishmentId);
        return true;
      }
      return false;
    } catch (e) {
      _error = 'Ошибка завершения';
      notifyListeners();
      return false;
    }
  }

  // ==========================================================================
  // User-facing methods
  // ==========================================================================

  List<Booking> _userBookings = [];
  List<Booking> get userBookings => _userBookings;
  List<Booking> get userActiveBookings =>
      _userBookings.where((b) => b.isActive).toList();
  List<Booking> get userHistoryBookings =>
      _userBookings.where((b) => !b.isActive).toList();

  /// Create a new booking (user action)
  Future<bool> createBooking({
    required String establishmentId,
    required String date,
    required String time,
    required int guestCount,
    String? comment,
    required String contactPhone,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _apiClient.post(
        '/api/v1/bookings',
        data: {
          'establishmentId': establishmentId,
          'date': date,
          'time': time,
          'guestCount': guestCount,
          if (comment != null && comment.isNotEmpty) 'comment': comment,
          'contactPhone': contactPhone,
        },
      );

      if (response.statusCode == 201) {
        _isLoading = false;
        notifyListeners();
        return true;
      }
      _error = 'Не удалось создать бронь';
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      // Extract server error message if available
      String message = 'Ошибка создания бронирования';
      if (e is DioException && e.response?.data is Map) {
        final serverMsg = (e.response!.data as Map)['message'];
        if (serverMsg is String) message = serverMsg;
      }
      _error = message;
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// Load user's bookings
  Future<void> loadUserBookings() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _apiClient.get('/api/v1/bookings/my');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = (response.data as Map<String, dynamic>)['data'];
        final items = data is List ? data : [];
        _userBookings = items
            .map((b) => Booking.fromJson(b as Map<String, dynamic>))
            .toList();
      }
    } catch (e) {
      _error = 'Ошибка загрузки бронирований';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Cancel a confirmed booking (user action)
  Future<bool> cancelBooking(String bookingId) async {
    try {
      final response = await _apiClient.put(
        '/api/v1/bookings/$bookingId/cancel',
      );

      if (response.statusCode == 200) {
        await loadUserBookings();
        return true;
      }
      _error = 'Не удалось отменить бронь';
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Ошибка отмены';
      notifyListeners();
      return false;
    }
  }
}
