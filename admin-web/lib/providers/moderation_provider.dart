import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// Per-field review state during moderation session
enum FieldReviewStatus { neutral, approved, rejected }

class FieldReviewState {
  final FieldReviewStatus status;
  final String? comment;

  const FieldReviewState({
    this.status = FieldReviewStatus.neutral,
    this.comment,
  });

  FieldReviewState copyWith({FieldReviewStatus? status, String? comment}) {
    return FieldReviewState(
      status: status ?? this.status,
      comment: comment ?? this.comment,
    );
  }
}

/// State management for the moderation workflow
class ModerationProvider with ChangeNotifier {
  final ModerationService _service;

  // Pending list state
  List<EstablishmentListItem> _establishments = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Selected establishment state
  EstablishmentDetail? _selectedDetail;
  bool _isLoadingDetail = false;
  String? _detailError;
  String? _selectedId;

  // Per-field review state (field_name → state)
  Map<String, FieldReviewState> _fieldReviews = {};

  // Moderation action state
  bool _isSubmitting = false;
  String? _submitError;

  ModerationProvider({ModerationService? service})
      : _service = service ?? ModerationService();

  // ============================================================================
  // Getters
  // ============================================================================

  List<EstablishmentListItem> get establishments => _establishments;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;

  EstablishmentDetail? get selectedDetail => _selectedDetail;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;

  Map<String, FieldReviewState> get fieldReviews => _fieldReviews;

  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  // ============================================================================
  // List operations
  // ============================================================================

  Future<void> loadPendingEstablishments({int page = 1}) async {
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final response = await _service.getPendingEstablishments(page: page);
      _establishments = response.establishments;
      _currentPage = response.page;
      _totalPages = response.pages;
      _totalCount = response.total;

      // Clear stale selection if the selected item is no longer in the list
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
        _selectedId = null;
        _selectedDetail = null;
        _fieldReviews = {};
        _detailError = null;
        _submitError = null;
      }
    } catch (e) {
      _listError = _extractMessage(e);
    } finally {
      _isLoadingList = false;
      notifyListeners();
    }
  }

  // ============================================================================
  // Detail operations
  // ============================================================================

  Future<void> selectEstablishment(String id) async {
    if (_selectedId == id && _selectedDetail != null) return;

    _selectedId = id;
    _isLoadingDetail = true;
    _detailError = null;
    _fieldReviews = {};
    _submitError = null;
    notifyListeners();

    try {
      _selectedDetail = await _service.getEstablishmentDetails(id);
    } catch (e) {
      _detailError = _extractMessage(e);
    } finally {
      _isLoadingDetail = false;
      notifyListeners();
    }
  }

  void clearSelection() {
    _selectedId = null;
    _selectedDetail = null;
    _fieldReviews = {};
    _detailError = null;
    _submitError = null;
    notifyListeners();
  }

  // ============================================================================
  // Field review operations
  // ============================================================================

  void approveField(String fieldName) {
    _fieldReviews[fieldName] = const FieldReviewState(
      status: FieldReviewStatus.approved,
    );
    notifyListeners();
  }

  void rejectField(String fieldName, {String? comment}) {
    _fieldReviews[fieldName] = FieldReviewState(
      status: FieldReviewStatus.rejected,
      comment: comment,
    );
    notifyListeners();
  }

  void commentField(String fieldName, String comment) {
    final current = _fieldReviews[fieldName] ?? const FieldReviewState();
    _fieldReviews[fieldName] = current.copyWith(comment: comment);
    notifyListeners();
  }

  void resetField(String fieldName) {
    _fieldReviews.remove(fieldName);
    notifyListeners();
  }

  FieldReviewState getFieldState(String fieldName) {
    return _fieldReviews[fieldName] ?? const FieldReviewState();
  }

  // ============================================================================
  // Moderation actions
  // ============================================================================

  Future<bool> approveEstablishment() async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      // Collect all field comments (both approved and rejected)
      final notes = <String, String>{};
      for (final entry in _fieldReviews.entries) {
        if (entry.value.comment != null && entry.value.comment!.isNotEmpty) {
          notes[entry.key] = entry.value.comment!;
        }
      }

      await _service.moderateEstablishment(
        id: _selectedId!,
        action: 'approve',
        moderationNotes: notes,
      );

      // Remove from list and clear selection
      _establishments.removeWhere((e) => e.id == _selectedId);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      clearSelection();
      return true;
    } catch (e) {
      _submitError = _extractMessage(e);
      return false;
    } finally {
      _isSubmitting = false;
      notifyListeners();
    }
  }

  Future<bool> rejectEstablishment() async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      // Collect per-field rejection notes
      final notes = <String, String>{};
      for (final entry in _fieldReviews.entries) {
        if (entry.value.status == FieldReviewStatus.rejected &&
            entry.value.comment != null &&
            entry.value.comment!.isNotEmpty) {
          notes[entry.key] = entry.value.comment!;
        }
      }

      await _service.moderateEstablishment(
        id: _selectedId!,
        action: 'reject',
        moderationNotes: notes,
      );

      // Remove from list and clear selection
      _establishments.removeWhere((e) => e.id == _selectedId);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      clearSelection();
      return true;
    } catch (e) {
      _submitError = _extractMessage(e);
      return false;
    } finally {
      _isSubmitting = false;
      notifyListeners();
    }
  }

  // ============================================================================
  // Coordinate correction
  // ============================================================================

  /// Update establishment coordinates (admin correction)
  Future<bool> updateCoordinates(double latitude, double longitude) async {
    if (_selectedId == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.updateCoordinates(
        id: _selectedId!,
        latitude: latitude,
        longitude: longitude,
      );

      // Force re-fetch detail to show updated coordinates
      _selectedDetail = null;
      await selectEstablishment(_selectedId!);

      _isSubmitting = false;
      notifyListeners();
      return true;
    } catch (e) {
      _submitError = _extractMessage(e);
      _isSubmitting = false;
      notifyListeners();
      return false;
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('Connection timeout')) return 'Превышено время ожидания';
    if (msg.contains('No internet')) return 'Нет подключения к серверу';
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('404')) return 'Заведение не найдено';
    return 'Произошла ошибка. Попробуйте снова.';
  }
}
