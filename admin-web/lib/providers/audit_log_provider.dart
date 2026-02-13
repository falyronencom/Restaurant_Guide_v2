import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';

/// State management for the Audit Log viewer screen
class AuditLogProvider extends ChangeNotifier {
  final AuditLogService _service = AuditLogService();

  // List state
  List<AuditLogEntry> _entries = [];
  bool _isLoading = false;
  String? _error;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Filters
  String? _actionFilter;
  DateTime? _dateFrom;
  DateTime? _dateTo;

  // Expanded row (for showing old_data/new_data details)
  String? _expandedEntryId;

  // Getters
  List<AuditLogEntry> get entries => _entries;
  bool get isLoading => _isLoading;
  String? get error => _error;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  String? get actionFilter => _actionFilter;
  DateTime? get dateFrom => _dateFrom;
  DateTime? get dateTo => _dateTo;
  String? get expandedEntryId => _expandedEntryId;

  /// Load audit log entries with current filters
  Future<void> loadEntries({int page = 1}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await _service.getAuditLog(
        page: page,
        action: _actionFilter,
        from: _dateFrom,
        to: _dateTo,
      );

      _entries = result.entries;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _isLoading = false;
      _error = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Set action type filter and reload
  void setActionFilter(String? action) {
    _actionFilter = action;
    _expandedEntryId = null;
    loadEntries();
  }

  /// Set date range filter and reload
  void setDateRange(DateTime? from, DateTime? to) {
    _dateFrom = from;
    _dateTo = to;
    _expandedEntryId = null;
    loadEntries();
  }

  /// Clear all filters and reload
  void clearFilters() {
    _actionFilter = null;
    _dateFrom = null;
    _dateTo = null;
    _expandedEntryId = null;
    loadEntries();
  }

  /// Toggle expanded row for showing details
  void toggleExpanded(String entryId) {
    _expandedEntryId = _expandedEntryId == entryId ? null : entryId;
    notifyListeners();
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('401')) return 'Требуется авторизация';
    if (msg.contains('SocketException') || msg.contains('Connection')) {
      return 'Ошибка соединения с сервером';
    }
    return 'Произошла ошибка при загрузке журнала';
  }
}
