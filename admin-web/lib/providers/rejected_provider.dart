import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// State management for the "Отказанные" (Rejected) screen.
///
/// Loads rejection history from audit log. Purely informational —
/// no action buttons, read-only detail view.
class RejectedProvider extends ChangeNotifier {
  /// Размер страницы — как у сервиса и как в подписи «Показано N–M из T».
  static const int perPage = 20;

  final ModerationService _service;

  RejectedProvider({ModerationService? service})
      : _service = service ?? ModerationService() {
    AccountScope.register(resetAccountScope);
  }

  // List state
  List<RejectedEstablishmentItem> _rejections = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Selected detail state
  EstablishmentDetail? _selectedDetail;
  bool _isLoadingDetail = false;
  String? _detailError;
  String? _selectedId;

  // Currently selected rejection item (for rejection notes)
  RejectedEstablishmentItem? _selectedRejection;

  /// Метки запросов (пакет 2, пункт 4; Codex CL-4) — как в ApprovedProvider:
  /// ответ пишется, только если его метка всё ещё текущая. Сброс при смене
  /// аккаунта сдвигает обе: поздний ответ администратору (с контактами
  /// партнёра) не ложится в панель просмотрщика. Счётчика поколения для
  /// действий здесь нет — у раздела нет действий.
  int _detailRequest = 0;
  int _listRequest = 0;

  /// Сброс при смене аккаунта: история и выбранная карточка принадлежат
  /// вошедшему.
  void resetAccountScope() {
    _detailRequest++;
    _listRequest++;
    _rejections = [];
    _isLoadingList = false;
    _listError = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _selectedDetail = null;
    _isLoadingDetail = false;
    _detailError = null;
    _selectedId = null;
    _selectedRejection = null;
    notifyListeners();
  }

  // Getters
  List<RejectedEstablishmentItem> get rejections => _rejections;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;

  /// Деталь показывается только вместе со своим выбором (пакет 2, пункт 4).
  EstablishmentDetail? get selectedDetail =>
      _selectedDetail?.id == _selectedId ? _selectedDetail : null;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;
  RejectedEstablishmentItem? get selectedRejection => _selectedRejection;

  /// Load rejection history
  Future<void> loadRejectedEstablishments({int page = 1}) async {
    final request = ++_listRequest;
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.getRejectedEstablishments(page: page);
      if (request != _listRequest) return; // обогнали или сменился аккаунт

      _rejections = result.rejections;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;

      // Clear stale selection if the selected item is no longer in the list
      if (_selectedId != null &&
          !_rejections.any((e) => e.establishmentId == _selectedId)) {
        _dropSelection();
      }

      notifyListeners();
    } catch (e) {
      if (request != _listRequest) return;
      _isLoadingList = false;
      _listError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Select a rejected establishment and load its detail
  Future<void> selectEstablishment(RejectedEstablishmentItem rejection) async {
    final id = rejection.establishmentId;
    if (_selectedId == id && selectedDetail != null) return;

    final request = ++_detailRequest;
    _selectedId = id;
    _selectedRejection = rejection;
    _isLoadingDetail = true;
    _detailError = null;
    notifyListeners();

    try {
      final detail = await _service.getEstablishmentDetails(id);
      // За время ожидания модератор мог выбрать другую карточку, а аккаунт
      // — смениться: тогда этот ответ уже не для панели.
      if (request != _detailRequest) return;
      _selectedDetail = detail;
      _isLoadingDetail = false;
      notifyListeners();
    } catch (e) {
      if (request != _detailRequest) return;
      _isLoadingDetail = false;
      _detailError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Снять выбор и отменить ожидание его детали.
  void _dropSelection() {
    _detailRequest++;
    _selectedId = null;
    _selectedDetail = null;
    _selectedRejection = null;
    _isLoadingDetail = false;
    _detailError = null;
  }

  /// Clear selection
  void clearSelection() {
    _dropSelection();
    notifyListeners();
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('404')) return 'Заведение не найдено';
    if (msg.contains('SocketException') || msg.contains('Connection')) {
      return 'Ошибка соединения с сервером';
    }
    return 'Произошла ошибка';
  }
}
