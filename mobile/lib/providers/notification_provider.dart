import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
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

  /// Last page that actually arrived (0 — none yet). Advanced only on a
  /// successful answer: a load that fails leaves it in place, so the next
  /// scroll asks for the same page again instead of skipping it.
  int _loadedPage = 0;
  String? _currentCategory;
  String? _errorMessage;

  /// Whether the load that failed last was a reload from page 1 — so
  /// [retry] repeats the same kind of load.
  bool _failedOnRefresh = false;
  Timer? _pollingTimer;
  bool _isAuthenticated = false;

  /// Bumped on every account-scope reset; a request started under the
  /// previous account captured an older value and drops its write, so a late
  /// answer can never show the previous account's data (pack 1 of the critics'
  /// findings, point 4 — Codex C2; the pattern of PartnerDashboardProvider).
  int _generation = 0;

  /// Bumped by every list load. A reload from page 1 (filter change,
  /// pull-to-refresh) starts even while another load is in flight; the
  /// earlier one then finds a newer ticket and drops its answer — otherwise
  /// the filter shown and the list under it would disagree.
  int _listTicket = 0;

  NotificationProvider({NotificationService? service})
      : _service = service ?? NotificationService() {
    // stopPolling already clears the list, badge and timer — exactly the
    // account-scoped reset needed on logout / account switch.
    AccountScope.register(stopPolling);
  }

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
    _generation++;
    _isAuthenticated = false;
    _pollingTimer?.cancel();
    _pollingTimer = null;
    _unreadCount = 0;
    _notifications = [];
    _isLoading = false;
    _loadedPage = 0;
    _hasMore = true;
    _currentCategory = null;
    _errorMessage = null;
    _failedOnRefresh = false;
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
    final generation = _generation;
    try {
      final count = await _service.getUnreadCount();
      if (generation != _generation) return; // account switched mid-flight
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

  /// Fetch notifications (supports pull-to-refresh and category filter).
  ///
  /// `refresh: true` reloads from page 1 and supersedes a load in flight;
  /// otherwise the next page after the last one that arrived is appended,
  /// and a call while a load is in flight is ignored.
  Future<void> fetchNotifications({bool refresh = false}) async {
    if (!_isAuthenticated) return;
    if (_isLoading && !refresh) return;

    final page = refresh ? 1 : _loadedPage + 1;
    final ticket = ++_listTicket;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    final generation = _generation;
    try {
      final result = await _service.getNotifications(
        page: page,
        limit: 20,
        category: _currentCategory,
      );
      if (generation != _generation) return; // account switched mid-flight
      if (ticket != _listTicket) return; // superseded by a newer reload

      final items = result['items'] as List<NotificationModel>;
      final pagination = result['pagination'] as Map<String, dynamic>;

      if (refresh) {
        _notifications = items;
      } else {
        // The server pages by offset: a notification created between two
        // loads shifts the feed, and the last row of the previous page comes
        // again at the top of this one. Keep the first copy only.
        final seen = {for (final n in _notifications) n.id};
        _notifications = [
          ..._notifications,
          ...items.where((n) => seen.add(n.id)),
        ];
      }
      _loadedPage = page;

      final totalPages = pagination['totalPages'] as int? ?? 1;
      _hasMore = page < totalPages;

      _isLoading = false;
      notifyListeners();
    } catch (e) {
      if (generation != _generation) return;
      if (ticket != _listTicket) return;
      _isLoading = false;
      _errorMessage = 'Не удалось загрузить уведомления';
      _failedOnRefresh = refresh;
      notifyListeners();
    }
  }

  /// Load next page.
  ///
  /// Does nothing after a failed load: the screen calls this on every scroll
  /// tick near the bottom, and retrying from there would fire a request per
  /// tick. The way on is [retry] — the screen's «Повторить» button.
  Future<void> loadMore() async {
    if (!_hasMore || _isLoading || _errorMessage != null) return;
    await fetchNotifications();
  }

  /// Repeat the load that failed last.
  Future<void> retry() =>
      fetchNotifications(refresh: _failedOnRefresh || _loadedPage == 0);

  // ============================================================================
  // Category filter
  // ============================================================================

  /// Switch category filter and refresh list.
  ///
  /// The previous filter's list is dropped at once: kept on screen during
  /// the load, it would stand under the new chip — and stay there if the
  /// load fails.
  void setCategory(String? category) {
    if (_currentCategory == category) return;
    _currentCategory = category;
    _notifications = [];
    _loadedPage = 0;
    _hasMore = true;
    fetchNotifications(refresh: true);
  }

  // ============================================================================
  // Mark as read
  // ============================================================================

  /// Mark a single notification as read — optimistic update
  Future<void> markAsRead(String notificationId) async {
    // Find and update locally first (optimistic)
    final index = _notifications.indexWhere((n) => n.id == notificationId);
    final markedHere = index != -1 && !_notifications[index].isRead;
    if (markedHere) {
      _notifications[index] = _notifications[index].copyWith(isRead: true);
      if (_unreadCount > 0) _unreadCount--;
      notifyListeners();
    }

    final generation = _generation;
    try {
      await _service.markAsRead(notificationId);
    } catch (_) {
      // Revert on failure — unless the account changed meanwhile: the list
      // being reverted is already gone. Nothing to revert if the row was
      // already read. The row is looked up again by id: a reload or a filter
      // change during the request replaces the list, and the old index would
      // point at another row — or past the end.
      if (generation != _generation || !markedHere) return;
      _unreadCount++;
      final current = _notifications.indexWhere((n) => n.id == notificationId);
      if (current != -1) {
        _notifications[current] =
            _notifications[current].copyWith(isRead: false);
      }
      notifyListeners();
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

    final generation = _generation;
    try {
      await _service.markAllAsRead();
    } catch (_) {
      if (generation != _generation) return;
      // Revert on failure
      _notifications = previousNotifications;
      _unreadCount = previousCount;
      notifyListeners();
    }
  }
}
