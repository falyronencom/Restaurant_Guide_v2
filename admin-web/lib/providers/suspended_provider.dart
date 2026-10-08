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

  /// Сброс при смене аккаунта: список, выбранная карточка и ход действия
  /// принадлежат вошедшему.
  void resetAccountScope() {
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

  EstablishmentDetail? get selectedDetail => _selectedDetail;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  /// Load suspended establishments
  Future<void> loadSuspendedEstablishments({int page = 1}) async {
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.getSuspendedEstablishments(page: page);

      _establishments = result.establishments;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;

      // Stale selection check (lesson from Testing Session 5)
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
        _selectedId = null;
        _selectedDetail = null;
        _detailError = null;
        _submitError = null;
      }

      notifyListeners();
    } catch (e) {
      _isLoadingList = false;
      _listError = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Select establishment and load its detail
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

  /// «Возобновить»: снять приостановку модератора с выбранной карточки.
  ///
  /// Сервер возвращает карточку туда, где она была до приостановки. На сайт,
  /// в очередь или в отклонённые — и она уходит из раздела; на паузу
  /// партнёра — и она остаётся здесь, уже как пауза партнёра. Поэтому
  /// раздел перечитывается, а не правится на месте.
  Future<bool> unsuspendEstablishment() async {
    final id = _selectedId;
    if (id == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.unsuspendEstablishment(id: id);
    } catch (e) {
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }

    await _refreshAfterAction(id);
    return true;
  }

  /// «Приостановить» карточку, которую партнёр поставил на паузу сам.
  ///
  /// Пауза партнёра не мешает модератору: поверх неё ставится приостановка
  /// модератора с причиной, и включить карточку сам партнёр уже не сможет.
  /// Карточка остаётся в разделе — с причиной и кнопкой «Возобновить».
  Future<bool> suspendEstablishment(String reason) async {
    final id = _selectedId;
    if (id == null) return false;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.suspendEstablishment(id: id, reason: reason);
    } catch (e) {
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      return false;
    }

    await _refreshAfterAction(id);
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
  /// считается.
  Future<void> _refreshAfterAction(String id) async {
    _isSubmitting = false;

    EstablishmentDetail? detail;
    try {
      detail = await _service.getEstablishmentDetails(id);
    } catch (_) {
      // Карточка перечитается при следующем выборе.
    }
    final stays = detail?.status == 'suspended';

    await loadSuspendedEstablishments(page: stays ? 1 : _currentPage);

    if (_selectedId != id) {
      _reloadIfPageEmptied();
      return;
    }
    if (detail != null) _selectedDetail = detail;
    notifyListeners();
  }

  /// Clear selection
  void clearSelection() {
    _selectedId = null;
    _selectedDetail = null;
    _detailError = null;
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
