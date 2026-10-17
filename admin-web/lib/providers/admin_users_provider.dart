import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';

/// Состояние экрана «Пользователи»: список, поиск, выбранный человек и его
/// блокировка (проход тестировщика 17.10, п. 8).
class AdminUsersProvider extends ChangeNotifier {
  final AdminUserService _service;

  AdminUsersProvider({AdminUserService? service})
      : _service = service ?? AdminUserService() {
    AccountScope.register(resetAccountScope);
  }

  static const int perPage = 20;

  /// Номер запроса списка: ответ, обогнанный более поздним, ничего не пишет.
  int _listSeq = 0;

  /// Номер запроса карточки — по той же причине: модератор кликает по строкам
  /// быстрее, чем отвечает сервер.
  int _detailSeq = 0;

  /// Поколение аккаунта: ответ, полученный прежним аккаунтом (администратор →
  /// просмотрщик), в состояние нового не ложится.
  int _generation = 0;

  List<AdminUser> _users = <AdminUser>[];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  String? _statusFilter;
  String _searchQuery = '';

  String? _selectedId;
  AdminUser? _selectedUser;
  bool _isLoadingDetail = false;
  String? _detailError;

  bool _isSubmitting = false;
  String? _submitError;

  /// Что сделало последнее удавшееся действие — подпись над кнопками.
  String? _lastResult;

  List<AdminUser> get users => _users;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  String? get statusFilter => _statusFilter;
  String get searchQuery => _searchQuery;
  String? get selectedId => _selectedId;
  AdminUser? get selectedUser => _selectedUser;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;
  String? get lastResult => _lastResult;
  bool get hasActiveFilters => _statusFilter != null || _searchQuery.isNotEmpty;

  Future<void> loadUsers({int page = 1}) async {
    final seq = ++_listSeq;
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final result = await _service.getUsers(
        page: page,
        perPage: perPage,
        search: _searchQuery.isNotEmpty ? _searchQuery : null,
        status: _statusFilter,
      );
      if (seq != _listSeq) return;
      _users = result.users;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _isLoadingList = false;
      notifyListeners();
    } catch (e) {
      if (seq != _listSeq) return;
      _isLoadingList = false;
      _listError = describeUserActionError(e);
      notifyListeners();
    }
  }

  /// Открыть человека — из списка или по ссылке из отзыва. Карточка читается
  /// отдельным запросом: в ней последняя блокировка, а сам человек может и не
  /// стоять на текущей странице списка.
  Future<void> openUser(String id) async {
    if (_selectedId != id) {
      _selectedUser = _users.where((u) => u.id == id).firstOrNull;
      _submitError = null;
      _lastResult = null;
    }
    _selectedId = id;
    await _loadDetail();
  }

  Future<void> _loadDetail() async {
    final id = _selectedId;
    if (id == null) return;
    final seq = ++_detailSeq;
    _isLoadingDetail = true;
    _detailError = null;
    notifyListeners();

    try {
      final user = await _service.getUser(id);
      if (seq != _detailSeq) return;
      _selectedUser = user;
      _isLoadingDetail = false;
      notifyListeners();
    } catch (e) {
      if (seq != _detailSeq) return;
      _isLoadingDetail = false;
      _detailError = describeUserActionError(e);
      notifyListeners();
    }
  }

  Future<bool> block(String reason) => _act(
        (id) => _service.block(id, reason: reason),
        'Пользователь заблокирован, его отзывы скрыты',
      );

  Future<bool> unblock(String reason) => _act(
        (id) => _service.unblock(id, reason: reason),
        'Пользователь разблокирован, отзывы, скрытые блокировкой, снова видны',
      );

  Future<bool> resetName(String reason) => _act(
        (id) => _service.resetName(id, reason: reason),
        'Имя сброшено на «Пользователь»',
      );

  /// Действие без оптимизма: блокировка трогает отзывы и рейтинг, и экран
  /// показывает то, что вернул сервер, а не догадку о нём.
  Future<bool> _act(Future<void> Function(String id) call, String done) async {
    final id = _selectedId;
    if (id == null || _isSubmitting) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    _lastResult = null;
    notifyListeners();

    try {
      await call(id);
      if (generation != _generation) return false;
      _isSubmitting = false;
      _lastResult = done;
      notifyListeners();
      await Future.wait(<Future<void>>[
        _loadDetail(),
        loadUsers(page: _currentPage),
      ]);
      return true;
    } catch (e) {
      if (generation != _generation) return false;
      _isSubmitting = false;
      _submitError = describeUserActionError(e);
      notifyListeners();
      return false;
    }
  }

  void search(String query) {
    _searchQuery = query.trim();
    loadUsers();
  }

  void clearSearch() {
    _searchQuery = '';
    loadUsers();
  }

  void setStatusFilter(String? status) {
    _statusFilter = status;
    loadUsers();
  }

  void resetFilters() {
    _statusFilter = null;
    _searchQuery = '';
    loadUsers();
  }

  void resetAccountScope() {
    _listSeq++;
    _detailSeq++;
    _generation++;
    _users = <AdminUser>[];
    _isLoadingList = false;
    _listError = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _statusFilter = null;
    _searchQuery = '';
    _selectedId = null;
    _selectedUser = null;
    _isLoadingDetail = false;
    _detailError = null;
    _isSubmitting = false;
    _submitError = null;
    _lastResult = null;
    notifyListeners();
  }
}

final RegExp _cyrillic = RegExp('[А-Яа-яЁё]');

/// Текст отказа для модератора.
///
/// Сервер пишет отказы этих действий по-русски («У этого партнёра есть
/// карточки заведений…», «Укажите причину») — их и показываем: в них сказано,
/// почему. Всё остальное (английский текст, сеть) — общими словами, без кодов.
@visibleForTesting
String describeUserActionError(Object error) {
  if (error is DioException) {
    final message = error.error;
    if (message is String && _cyrillic.hasMatch(message)) return message;
    switch (error.response?.statusCode) {
      case 403:
        return 'Доступ запрещён';
      case 404:
        return 'Пользователь не найден';
    }
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Ошибка соединения с сервером';
    }
  }
  return 'Произошла ошибка';
}
