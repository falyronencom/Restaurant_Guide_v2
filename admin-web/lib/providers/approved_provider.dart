import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// State management for the "Одобренные" (Approved) screen.
///
/// Manages two modes:
/// - Normal: shows active establishments with filtering/sorting
/// - Search: searches across ALL statuses when search query is present
///
/// Also handles detail loading, suspend/unsuspend actions.
class ApprovedProvider extends ChangeNotifier {
  /// Размер страницы. Совпадает с умолчанием сервиса и используется экраном
  /// для подписи «Показано 1–20 из 365»: расходиться этим двум числам нельзя.
  static const int perPage = 20;

  final ModerationService _service;

  ApprovedProvider({ModerationService? service})
      : _service = service ?? ModerationService() {
    AccountScope.register(resetAccountScope);
  }

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

  /// Метки запросов (пакет 2, пункт 4; Codex CL-4).
  ///
  /// Сервер решает, что скрыть, по роли того, кто спросил: ответ на запрос
  /// администратора несёт контакты и документ партнёра. Ответ пишется в
  /// состояние, только если его метка всё ещё текущая:
  /// - [_generation] сдвигает сброс при смене аккаунта — ответ на запрос
  ///   прежнего аккаунта (и на его действие) выбрасывается;
  /// - [_detailRequest] сдвигает каждый новый запрос детали, смена выбора и
  ///   сброс — поздняя деталь другой карточки не ложится в открытую панель;
  /// - [_listRequest] — то же для списка.
  int _generation = 0;
  int _detailRequest = 0;
  int _listRequest = 0;

  /// Сброс при смене аккаунта: каталог, поиск, фильтры, выбранная карточка и
  /// ход действия принадлежат вошедшему.
  void resetAccountScope() {
    _generation++;
    _detailRequest++;
    _listRequest++;
    _establishments = [];
    _isLoadingList = false;
    _listError = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _sort = 'newest';
    _cityFilter = null;
    _searchQuery = '';
    _isSearchMode = false;
    _selectedDetail = null;
    _isLoadingDetail = false;
    _detailError = null;
    _selectedId = null;
    _isSubmitting = false;
    _submitError = null;
    notifyListeners();
  }

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

  /// Деталь показывается только вместе со своим выбором: деталь другой
  /// карточки под этим выбором не отдаётся никогда (пакет 2, пункт 4).
  EstablishmentDetail? get selectedDetail =>
      _selectedDetail?.id == _selectedId ? _selectedDetail : null;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  /// Load active (approved) establishments
  Future<void> loadActiveEstablishments({int page = 1}) async {
    final request = ++_listRequest;
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
      if (request != _listRequest) return; // обогнали или сменился аккаунт

      _establishments = result.establishments;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;

      // Clear stale selection if the selected item is no longer in the list
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
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

  /// Search across all statuses
  /// Поиск по всем статусам. Страница обязана прокидываться: сервис её
  /// принимает, и без неё футер показывал бы номера страниц, на которые
  /// невозможно перейти.
  Future<void> searchEstablishments(String query, {int page = 1}) async {
    if (query.trim().isEmpty) {
      clearSearch();
      return;
    }

    final request = ++_listRequest;
    _searchQuery = query;
    _isSearchMode = true;
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.searchEstablishments(
        search: query,
        city: _cityFilter,
        page: page,
      );
      if (request != _listRequest) return; // обогнали или сменился аккаунт

      _establishments = result.establishments;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;

      // Clear stale selection if the selected item is no longer in search results
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
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

  /// Последнее действие могло убрать единственную запись открытой страницы.
  /// Раздел при этом не опустел, поэтому список перечитывается, а номер
  /// страницы зажимается в новые границы: иначе экран показывал бы пустоту
  /// при непустом разделе, а подпись — перевёрнутый диапазон вида «21–20».
  void _reloadIfPageEmptied() {
    if (_establishments.isNotEmpty || _totalCount == 0) return;

    final lastPage = (_totalCount + perPage - 1) ~/ perPage;
    final target = _currentPage > lastPage ? lastPage : _currentPage;
    if (_isSearchMode) {
      searchEstablishments(_searchQuery, page: target);
    } else {
      loadActiveEstablishments(page: target);
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
    // Ошибка загрузки — исключение: повторный тап и есть «попробовать снова»
    // (например, после сбоя перечитывания после передачи).
    if (_selectedId == id && selectedDetail != null && _detailError == null) {
      return;
    }

    // Прежняя деталь под новым выбором наружу не отдаётся: геттер
    // [selectedDetail] сверяет её id с выбором.
    _selectedId = id;
    _submitError = null;
    await _loadDetail(id);
  }

  /// Загрузить деталь [id] и записать её, только если ответ — на последний
  /// запрос: за время ожидания модератор мог выбрать другую карточку, а
  /// аккаунт — смениться.
  Future<void> _loadDetail(String id) async {
    final request = ++_detailRequest;
    _isLoadingDetail = true;
    _detailError = null;
    notifyListeners();

    try {
      final detail = await _service.getEstablishmentDetails(id);
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
    _isLoadingDetail = false;
    _detailError = null;
  }

  /// Clear selection
  void clearSelection() {
    _dropSelection();
    _submitError = null;
    notifyListeners();
  }

  /// Карточка, над которой выполняется действие, — та, что показана: её имя
  /// называет диалог подтверждения. Не просто выбранная: между кликом и
  /// ответом выбор и деталь могли расходиться (пакет 2, пункт 4).
  String? get _shownId => selectedDetail?.id;

  /// Suspend the establishment shown in the detail panel
  Future<bool> suspendEstablishment(String reason) async {
    final id = _shownId;
    if (id == null) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.suspendEstablishment(id: id, reason: reason);
    } catch (e) {
      if (generation != _generation) return false; // аккаунт уже другой
      _isSubmitting = false;
      // Ошибка — о карточке, над которой действовали: под другой, открытой
      // за это время, она не показывается.
      if (_selectedId == id) _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
    if (generation != _generation) return false;

    _isSubmitting = false;
    if (_selectedId == id) _dropSelection();

    // Поиск находит карточки любого статуса — приостановленная остаётся в
    // выдаче, уже в новом статусе: выдача перечитывается. Список одобренных
    // её теряет — убрать на месте.
    if (_isSearchMode) {
      notifyListeners();
      searchEstablishments(_searchQuery, page: _currentPage);
      return true;
    }

    _establishments.removeWhere((e) => e.id == id);
    _totalCount = (_totalCount - 1).clamp(0, _totalCount);
    notifyListeners();
    _reloadIfPageEmptied();
    return true;
  }

  /// Unsuspend (reactivate) the establishment shown in the detail panel
  Future<bool> unsuspendEstablishment() async {
    final id = _shownId;
    if (id == null) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.unsuspendEstablishment(id: id);
    } catch (e) {
      if (generation != _generation) return false;
      _isSubmitting = false;
      if (_selectedId == id) _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
    if (generation != _generation) return false;

    // Refresh the list (if in search mode, item status changed)
    _isSubmitting = false;
    if (_selectedId == id) _dropSelection();
    notifyListeners();

    if (_isSearchMode) {
      searchEstablishments(_searchQuery, page: _currentPage);
    } else {
      loadActiveEstablishments(page: _currentPage);
    }
    return true;
  }

  /// Claim the establishment shown in the detail panel for a target user
  Future<bool> claimEstablishment(String userId) async {
    final id = _shownId;
    if (id == null) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.claimEstablishment(id: id, userId: userId);
    } catch (e) {
      if (generation != _generation) return false;
      _isSubmitting = false;
      if (_selectedId == id) _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
    if (generation != _generation) return false;

    // Показать нового владельца: перечитать деталь именно переданной
    // карточки и только если она всё ещё открыта. Раньше перечитывание шло
    // через selectEstablishment и выходило ранним возвратом — деталь уже
    // была, и панель продолжала показывать прежнего владельца.
    _isSubmitting = false;
    notifyListeners();
    if (_selectedId == id) await _loadDetail(id);
    return true;
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
