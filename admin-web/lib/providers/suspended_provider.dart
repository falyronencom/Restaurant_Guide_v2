import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

/// State management for the "Приостановленные" (Suspended) screen.
///
/// Manages:
/// - Suspended establishments list with pagination
/// - Detail loading for selected establishment
/// - Two independent pauses (Coordinator, 2026-10-07, option A): the
///   moderator's own suspension is lifted here («Возобновить» — the card goes
///   back to where it was); a card the partner paused is the partner's to
///   switch on, and the moderator may suspend it with a reason of their own.
class SuspendedProvider extends ChangeNotifier {
  /// Размер страницы — как у сервиса и как в подписи «Показано N–M из T».
  static const int perPage = 20;

  final ModerationService _service;

  SuspendedProvider({ModerationService? service})
      : _service = service ?? ModerationService() {
    AccountScope.register(resetAccountScope);
  }

  // List state
  List<SuspendedEstablishmentItem> _establishments = [];
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

  // Action state
  bool _isSubmitting = false;
  String? _submitError;

  /// Метки запросов (пакет 2, пункт 4; Codex CL-4) — как в ApprovedProvider:
  /// [_generation] — аккаунт (ответы на запросы и действия прежнего
  /// выбрасываются), [_detailRequest] — последний запрос детали,
  /// [_listRequest] — последний запрос списка.
  int _generation = 0;
  int _detailRequest = 0;
  int _listRequest = 0;

  /// Сброс при смене аккаунта: список, выбранная карточка и ход действия
  /// принадлежат вошедшему.
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
    _selectedDetail = null;
    _isLoadingDetail = false;
    _detailError = null;
    _selectedId = null;
    _isSubmitting = false;
    _submitError = null;
    notifyListeners();
  }

  // Getters
  List<SuspendedEstablishmentItem> get establishments => _establishments;
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
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  /// Load suspended establishments
  Future<void> loadSuspendedEstablishments({int page = 1}) async {
    final request = ++_listRequest;
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.getSuspendedEstablishments(page: page);
      if (request != _listRequest) return; // обогнали или сменился аккаунт

      _establishments = result.establishments;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;

      // Stale selection check (lesson from Testing Session 5)
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
        _dropSelection();
        _submitError = null;
      }

      notifyListeners();
    } catch (e) {
      if (request != _listRequest) return;
      _isLoadingList = false;
      _listError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Select establishment and load its detail
  Future<void> selectEstablishment(String id) async {
    if (_selectedId == id && selectedDetail != null) return;

    final request = ++_detailRequest;
    _selectedId = id;
    _isLoadingDetail = true;
    _detailError = null;
    _submitError = null;
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
    _isLoadingDetail = false;
    _detailError = null;
  }

  /// Действие выполняется над показанной карточкой — её имя называет диалог
  /// подтверждения (пакет 2, пункт 4).
  String? get _shownId => selectedDetail?.id;

  /// «Возобновить»: снять приостановку модератора с выбранной карточки.
  ///
  /// Сервер возвращает карточку туда, где она была до приостановки. На сайт,
  /// в очередь или в отклонённые — и она уходит из раздела; на паузу
  /// партнёра — и она остаётся здесь, уже как пауза партнёра. Поэтому
  /// раздел перечитывается, а не правится на месте.
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
      if (generation != _generation) return false; // аккаунт уже другой
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
    if (generation != _generation) return false;

    await _refreshAfterAction(id, generation);
    return true;
  }

  /// «Приостановить» карточку, которую партнёр поставил на паузу сам.
  ///
  /// Пауза партнёра не мешает модератору: поверх неё ставится приостановка
  /// модератора с причиной, и включить карточку сам партнёр уже не сможет.
  /// Карточка остаётся в разделе — с причиной и кнопкой «Возобновить».
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
      _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }
    if (generation != _generation) return false;

    await _refreshAfterAction(id, generation);
    return true;
  }

  /// После действия карточка либо ушла из раздела, либо осталась в нём в
  /// новом виде (пауза партнёра ↔ приостановка модератора). Сначала
  /// перечитывается сама карточка: осталась — раздел открывается с первой
  /// страницы (действие освежило карточку, а раздел упорядочен по времени
  /// изменения — она теперь первая; на второй странице её уже нет), выбор и
  /// новый вид сохраняются; ушла — перечитывается текущая страница, выбор
  /// снимет проверка устаревшего выбора в [loadSuspendedEstablishments].
  /// Действие уже выполнено: сбой перечитывания его не отменяет и ошибкой не
  /// считается. Перечитанная деталь ложится в панель, только если за это
  /// время не сменились ни аккаунт, ни выбор, и не ушёл новый запрос детали.
  Future<void> _refreshAfterAction(String id, int generation) async {
    _isSubmitting = false;
    final detailRequest = _detailRequest;

    EstablishmentDetail? detail;
    try {
      detail = await _service.getEstablishmentDetails(id);
    } catch (_) {
      // Карточка перечитается при следующем выборе.
    }
    if (generation != _generation) return;
    final stays = detail?.status == 'suspended';

    await loadSuspendedEstablishments(page: stays ? 1 : _currentPage);
    if (generation != _generation) return;

    if (_selectedId != id) {
      _reloadIfPageEmptied();
      return;
    }
    if (detail != null && detailRequest == _detailRequest) {
      _selectedDetail = detail;
    }
    notifyListeners();
  }

  /// Clear selection
  void clearSelection() {
    _dropSelection();
    _submitError = null;
    notifyListeners();
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

  /// «Возобновить» могло убрать единственную запись открытой страницы.
  /// Приостановленных при этом меньше не стало настолько, чтобы раздел
  /// опустел, — поэтому список перечитывается с зажатым номером страницы.
  void _reloadIfPageEmptied() {
    if (_establishments.isNotEmpty || _totalCount == 0) return;

    final lastPage = (_totalCount + perPage - 1) ~/ perPage;
    loadSuspendedEstablishments(
      page: _currentPage > lastPage ? lastPage : _currentPage,
    );
  }

}
