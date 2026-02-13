import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';

/// State management for the Reviews Management screen
class AdminReviewsProvider extends ChangeNotifier {
  final AdminReviewService _service = AdminReviewService();

  // List state
  List<AdminReviewItem> _reviews = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Filters
  String? _statusFilter;
  int? _ratingFilter;
  String _sort = 'newest';
  String _searchQuery = '';
  DateTime? _dateFrom;
  DateTime? _dateTo;

  // Selected review detail
  AdminReviewItem? _selectedReview;
  String? _selectedId;

  // Action state
  bool _isSubmitting = false;
  String? _submitError;

  // Getters
  List<AdminReviewItem> get reviews => _reviews;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  String? get statusFilter => _statusFilter;
  int? get ratingFilter => _ratingFilter;
  String get sort => _sort;
  String get searchQuery => _searchQuery;
  DateTime? get dateFrom => _dateFrom;
  DateTime? get dateTo => _dateTo;
  AdminReviewItem? get selectedReview => _selectedReview;
  String? get selectedId => _selectedId;
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  /// Load reviews with current filters
  Future<void> loadReviews({int page = 1}) async {
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.getReviews(
        page: page,
        status: _statusFilter,
        rating: _ratingFilter,
        search: _searchQuery.isNotEmpty ? _searchQuery : null,
        sort: _sort,
        from: _dateFrom,
        to: _dateTo,
      );

      _reviews = result.reviews;
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

  /// Select a review from the list to show in detail panel
  void selectReview(String id) {
    if (_selectedId == id) return;
    _selectedId = id;
    _selectedReview = _reviews.where((r) => r.id == id).firstOrNull;
    _submitError = null;
    notifyListeners();
  }

  void clearSelection() {
    _selectedId = null;
    _selectedReview = null;
    _submitError = null;
    notifyListeners();
  }

  /// Toggle visibility of the selected review
  Future<bool> toggleVisibility() async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.toggleVisibility(_selectedId!);

      // Optimistic update: toggle is_visible in local list
      final index = _reviews.indexWhere((r) => r.id == _selectedId);
      if (index >= 0) {
        final updated = _reviews[index].copyWith(
          isVisible: !_reviews[index].isVisible,
        );
        _reviews[index] = updated;
        _selectedReview = updated;
      }

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

  /// Delete the selected review
  Future<bool> deleteReview(String? reason) async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.deleteReview(_selectedId!, reason: reason);

      // Optimistic update: mark as deleted in local list
      final index = _reviews.indexWhere((r) => r.id == _selectedId);
      if (index >= 0) {
        final updated = _reviews[index].copyWith(isDeleted: true);
        _reviews[index] = updated;
        _selectedReview = updated;
      }

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

  // Filter setters

  void setStatusFilter(String? status) {
    _statusFilter = status;
    _selectedId = null;
    _selectedReview = null;
    loadReviews();
  }

  void setRatingFilter(int? rating) {
    _ratingFilter = rating;
    loadReviews();
  }

  void setSort(String sort) {
    _sort = sort;
    loadReviews();
  }

  void setDateRange(DateTime? from, DateTime? to) {
    _dateFrom = from;
    _dateTo = to;
    loadReviews();
  }

  void search(String query) {
    _searchQuery = query;
    _selectedId = null;
    _selectedReview = null;
    loadReviews();
  }

  void clearSearch() {
    _searchQuery = '';
    _selectedId = null;
    _selectedReview = null;
    loadReviews();
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('404')) return 'Отзыв не найден';
    if (msg.contains('400')) return 'Некорректный запрос';
    if (msg.contains('SocketException') || msg.contains('Connection')) {
      return 'Ошибка соединения с сервером';
    }
    return 'Произошла ошибка';
  }
}
