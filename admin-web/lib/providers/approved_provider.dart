import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// State management for the "Одобренные" (Approved) screen.
///
/// Manages two modes:
/// - Normal: shows active establishments with filtering/sorting
/// - Search: searches across ALL statuses when search query is present
///
/// Also handles detail loading, suspend/unsuspend actions.
class ApprovedProvider extends ChangeNotifier {
  final ModerationService _service = ModerationService();

  // List state
  List<EstablishmentListItem> _establishments = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Filters / sort
  String _sort = 'newest';
  String? _cityFilter;

  // Search state
  String _searchQuery = '';
  bool _isSearchMode = false;

  // Selected detail state
  EstablishmentDetail? _selectedDetail;
  bool _isLoadingDetail = false;
  String? _detailError;
  String? _selectedId;

  // Action state
  bool _isSubmitting = false;
  String? _submitError;

  // Getters
  List<EstablishmentListItem> get establishments => _establishments;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  String get sort => _sort;
  String? get cityFilter => _cityFilter;
  String get searchQuery => _searchQuery;
  bool get isSearchMode => _isSearchMode;

  EstablishmentDetail? get selectedDetail => _selectedDetail;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  /// Load active (approved) establishments
  Future<void> loadActiveEstablishments({int page = 1}) async {
    _isLoadingList = true;
    _listError = null;
    _isSearchMode = false;
    notifyListeners();

    try {
      final result = await _service.getActiveEstablishments(
        page: page,
        sort: _sort,
        city: _cityFilter,
      );

      _establishments = result.establishments;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;
      notifyListeners();
    } catch (e) {
      _isLoadingList = false;
      _listError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Search across all statuses
  Future<void> searchEstablishments(String query) async {
    if (query.trim().isEmpty) {
      clearSearch();
      return;
    }

    _searchQuery = query;
    _isSearchMode = true;
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.searchEstablishments(
        search: query,
        city: _cityFilter,
      );

      _establishments = result.establishments;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;
      notifyListeners();
    } catch (e) {
      _isLoadingList = false;
      _listError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Clear search and return to normal active list
  void clearSearch() {
    _searchQuery = '';
    _isSearchMode = false;
    notifyListeners();
    loadActiveEstablishments();
  }

  /// Update sort order and reload
  void setSort(String sort) {
    _sort = sort;
    if (!_isSearchMode) {
      loadActiveEstablishments();
    }
  }

  /// Update city filter and reload
  void setCityFilter(String? city) {
    _cityFilter = city;
    if (_isSearchMode) {
      searchEstablishments(_searchQuery);
    } else {
      loadActiveEstablishments();
    }
  }

  /// Select an establishment and load its detail
  Future<void> selectEstablishment(String id) async {
    if (_selectedId == id && _selectedDetail != null) return;

    _selectedId = id;
    _isLoadingDetail = true;
    _detailError = null;
    _submitError = null;
    notifyListeners();

    try {
      _selectedDetail = await _service.getEstablishmentDetails(id);
      _isLoadingDetail = false;
      notifyListeners();
    } catch (e) {
      _isLoadingDetail = false;
      _detailError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Clear selection
  void clearSelection() {
    _selectedId = null;
    _selectedDetail = null;
    _detailError = null;
    _submitError = null;
    notifyListeners();
  }

  /// Suspend the currently selected establishment
  Future<bool> suspendEstablishment(String reason) async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.suspendEstablishment(
        id: _selectedId!,
        reason: reason,
      );

      // Remove from list and clear selection
      _establishments.removeWhere((e) => e.id == _selectedId);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      _selectedId = null;
      _selectedDetail = null;
      _isSubmitting = false;
      notifyListeners();
      return true;
    } catch (e) {
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
  }

  /// Unsuspend (reactivate) the currently selected establishment
  Future<bool> unsuspendEstablishment() async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.unsuspendEstablishment(id: _selectedId!);

      // Refresh the list (if in search mode, item status changed)
      _selectedId = null;
      _selectedDetail = null;
      _isSubmitting = false;
      notifyListeners();

      if (_isSearchMode) {
        searchEstablishments(_searchQuery);
      } else {
        loadActiveEstablishments(page: _currentPage);
      }
      return true;
    } catch (e) {
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('404')) return 'Заведение не найдено';
    if (msg.contains('400')) return 'Некорректный запрос';
    if (msg.contains('SocketException') || msg.contains('Connection')) {
      return 'Ошибка соединения с сервером';
    }
    return 'Произошла ошибка';
  }
}
