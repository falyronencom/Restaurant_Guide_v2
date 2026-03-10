import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/services/notification_service.dart';

/// Polling interval for unread count updates
const Duration _pollingInterval = Duration(seconds: 30);

/// Notification state provider
/// Manages notification list, unread count, polling, pagination, and filters
class NotificationProvider with ChangeNotifier {
  final NotificationService _service;

  // State
  int _unreadCount = 0;
  List<NotificationModel> _notifications = [];
  bool _isLoading = false;
  bool _hasMore = true;
  int _currentPage = 1;
  String? _currentCategory;
  String? _errorMessage;
  Timer? _pollingTimer;
  bool _isAuthenticated = false;

  NotificationProvider({NotificationService? service})
      : _service = service ?? NotificationService();

  // Getters
  int get unreadCount => _unreadCount;
  List<NotificationModel> get notifications => _notifications;
  bool get isLoading => _isLoading;
  bool get hasMore => _hasMore;
  String? get currentCategory => _currentCategory;
  String? get errorMessage => _errorMessage;

  // ============================================================================
  // Polling
  // ============================================================================

  /// Start polling for unread count updates (call after auth confirmed)
  void startPolling() {
    _isAuthenticated = true;
    _pollingTimer?.cancel();
    // Fetch immediately, then periodically
    fetchUnreadCount();
    _pollingTimer = Timer.periodic(_pollingInterval, (_) {
      if (_isAuthenticated) {
        fetchUnreadCount();
      }
    });
  }

  /// Stop polling (call on logout)
  void stopPolling() {
    _isAuthenticated = false;
    _pollingTimer?.cancel();
    _pollingTimer = null;
    _unreadCount = 0;
    _notifications = [];
    _currentPage = 1;
    _hasMore = true;
    _currentCategory = null;
    _errorMessage = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    super.dispose();
  }

  // ============================================================================
  // Badge count
  // ============================================================================

  /// Lightweight call for badge — silent on errors
  Future<void> fetchUnreadCount() async {
    if (!_isAuthenticated) return;
    try {
      final count = await _service.getUnreadCount();
      if (_unreadCount != count) {
        _unreadCount = count;
        notifyListeners();
      }
    } catch (_) {
      // Silent — badge should not break the app
    }
  }

  // ============================================================================
  // Notification list
  // ============================================================================

  /// Fetch notifications (supports pull-to-refresh and category filter)
  Future<void> fetchNotifications({bool refresh = false}) async {
    if (!_isAuthenticated) return;
    if (_isLoading) return;

    if (refresh) {
      _currentPage = 1;
      _hasMore = true;
    }

    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _service.getNotifications(
        page: _currentPage,
        limit: 20,
        category: _currentCategory,
      );

      final items = result['items'] as List<NotificationModel>;
      final pagination = result['pagination'] as Map<String, dynamic>;

      if (refresh) {
        _notifications = items;
      } else {
        _notifications = [..._notifications, ...items];
      }

      final totalPages = pagination['totalPages'] as int? ?? 1;
      _hasMore = _currentPage < totalPages;

      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _isLoading = false;
      _errorMessage = 'Не удалось загрузить уведомления';
      notifyListeners();
    }
  }

  /// Load next page
  Future<void> loadMore() async {
    if (!_hasMore || _isLoading) return;
    _currentPage++;
    await fetchNotifications();
  }

  // ============================================================================
  // Category filter
  // ============================================================================

  /// Switch category filter and refresh list
  void setCategory(String? category) {
    if (_currentCategory == category) return;
    _currentCategory = category;
    fetchNotifications(refresh: true);
  }

  // ============================================================================
  // Mark as read
  // ============================================================================

  /// Mark a single notification as read — optimistic update
  Future<void> markAsRead(String notificationId) async {
    // Find and update locally first (optimistic)
    final index = _notifications.indexWhere((n) => n.id == notificationId);
    if (index != -1 && !_notifications[index].isRead) {
      _notifications[index] = _notifications[index].copyWith(isRead: true);
      if (_unreadCount > 0) _unreadCount--;
      notifyListeners();
    }

    try {
      await _service.markAsRead(notificationId);
    } catch (_) {
      // Revert on failure
      if (index != -1) {
        _notifications[index] = _notifications[index].copyWith(isRead: false);
        _unreadCount++;
        notifyListeners();
      }
    }
  }

  /// Mark all notifications as read — optimistic update
  Future<void> markAllAsRead() async {
    final previousNotifications =
        _notifications.map((n) => n.copyWith()).toList();
    final previousCount = _unreadCount;

    // Optimistic: mark all read locally
    _notifications =
        _notifications.map((n) => n.copyWith(isRead: true)).toList();
    _unreadCount = 0;
    notifyListeners();

    try {
      await _service.markAllAsRead();
    } catch (_) {
      // Revert on failure
      _notifications = previousNotifications;
      _unreadCount = previousCount;
      notifyListeners();
    }
  }
}
