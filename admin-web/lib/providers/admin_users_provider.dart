import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';
import 'package:restaurant_guide_admin_web/utils/id_format.dart';

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
  String? _roleFilter;
  String _searchQuery = '';

  String? _selectedId;
  AdminUser? _selectedUser;
  bool _isLoadingDetail = false;
  String? _detailError;

  /// В ссылке `?user=…` был не номер человека — карточку не запрашивали.
  bool _linkRejected = false;

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
  String? get roleFilter => _roleFilter;
  String get searchQuery => _searchQuery;
  String? get selectedId => _selectedId;
  AdminUser? get selectedUser => _selectedUser;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  bool get linkRejected => _linkRejected;
  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;
  String? get lastResult => _lastResult;
  bool get hasActiveFilters =>
      _statusFilter != null || _roleFilter != null || _searchQuery.isNotEmpty;

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
        role: _roleFilter,
      );
      if (seq != _listSeq) return;
      // Разблокировал последнего на странице «Заблокированных» — предыдущая
      // страница, а не «никого не нашлось» (проход по панели 20.10, A2-08).
      if (result.users.isEmpty && page > 1) {
        final target = result.pages >= 1 ? math.min(result.pages, page - 1) : 1;
        await loadUsers(page: target);
        return;
      }
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

  /// Открыть человека по номеру из адреса страницы (ссылка из отзыва или
  /// присланная кем-то). Номер не в формате сервера — запроса нет, справа
  /// «Пользователь не найден» (сверка меток панели 29.10, S4).
  Future<void> openUserFromLink(String id) async {
    if (!isUuid(id)) {
      _closeCard(); // ответ прежней карточки сюда уже не ляжет
      _linkRejected = true;
      notifyListeners();
      return;
    }
    await openUser(id);
  }

  /// Экран открыт без ссылки: «не найден» от прошлой битой ссылки не
  /// остаётся — провайдер живёт дольше экрана.
  void forgetRejectedLink() {
    if (!_linkRejected) return;
    _linkRejected = false;
    notifyListeners();
  }

  /// Открыть человека — из списка или по ссылке из отзыва. Карточка читается
  /// отдельным запросом: в ней последняя блокировка, а сам человек может и не
  /// стоять на текущей странице списка.
  Future<void> openUser(String id) async {
    _linkRejected = false;
    if (_selectedId != id) {
      _selectedUser = _users.where((u) => u.id == id).firstOrNull;
      _submitError = null;
      _lastResult = null;
    }
    _selectedId = id;
    await _loadDetail();
  }

  /// Повтор загрузки открытой карточки — «Повторить» под ошибкой и в тосте.
  Future<void> retryDetail() => _loadDetail();

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

  /// Итог — со счётом сервера, а не обещанием (проход по панели 20.10,
  /// A2-06): «скрыто отзывов: 3», а если скрывать было нечего — так и сказано.
  Future<bool> block(String reason) => _act((id) async {
        final result = await _service.block(id, reason: reason);
        return (result.changed, blockResultText(result));
      });

  Future<bool> unblock(String reason, {bool restoreReviews = true}) =>
      _act((id) async {
        final result = await _service.unblock(
          id,
          reason: reason,
          restoreReviews: restoreReviews,
        );
        return (
          result.changed,
          unblockResultText(result, restoreReviews: restoreReviews),
        );
      });

  Future<bool> resetName(String reason) => _act((id) async {
        final changed = await _service.resetName(id, reason: reason);
        return (changed, 'Имя сброшено на «Пользователь»');
      });

  /// Действие без оптимизма: блокировка трогает отзывы и рейтинг, и экран
  /// показывает то, что вернул сервер, а не догадку о нём.
  ///
  /// Итог — подпись под кнопками — пишется, только если на экране всё ещё
  /// тот, над кем действовали: строки списка кликабельны и во время запроса,
  /// и «Пользователь заблокирован» не должно встать под другим человеком.
  Future<bool> _act(
    Future<(bool, String)> Function(String id) call,
  ) async {
    final id = _selectedId;
    if (id == null || _isSubmitting) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    _lastResult = null;
    notifyListeners();

    try {
      final (changed, done) = await call(id);
      if (generation != _generation) return false;
      _isSubmitting = false;
      if (_selectedId == id) {
        // Повтор или чужое действие раньше: сервер ничего не менял.
        _lastResult = changed ? done : kUserActionNothingChanged;
      }
      notifyListeners();
      await Future.wait(<Future<void>>[
        _loadDetail(),
        loadUsers(page: _currentPage),
      ]);
      return true;
    } catch (e) {
      if (generation != _generation) return false;
      _isSubmitting = false;
      if (_selectedId == id) _submitError = describeUserActionError(e);
      notifyListeners();
      return false;
    }
  }

  void search(String query) {
    _searchQuery = query.trim();
    _closeCard();
    loadUsers();
  }

  void clearSearch() {
    _searchQuery = '';
    _closeCard();
    loadUsers();
  }

  void setStatusFilter(String? status) {
    _statusFilter = status;
    _closeCard();
    loadUsers();
  }

  void setRoleFilter(String? role) {
    _roleFilter = role;
    _closeCard();
    loadUsers();
  }

  void resetFilters() {
    _statusFilter = null;
    _roleFilter = null;
    _searchQuery = '';
    _closeCard();
    loadUsers();
  }

  /// Новый отбор — новый список: карточка прежнего человека справа от
  /// списка, где его нет, читается как ошибка фильтра (осмотр панели 20.10,
  /// п. 34). Ответ его карточки, если ещё в пути, уже ничего не пишет.
  void _closeCard() {
    _detailSeq++;
    _selectedId = null;
    _selectedUser = null;
    _isLoadingDetail = false;
    _detailError = null;
    _submitError = null;
    _lastResult = null;
    _linkRejected = false;
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
    _roleFilter = null;
    _searchQuery = '';
    _selectedId = null;
    _selectedUser = null;
    _isLoadingDetail = false;
    _detailError = null;
    _linkRejected = false;
    _isSubmitting = false;
    _submitError = null;
    _lastResult = null;
    notifyListeners();
  }
}

/// Итог блокировки по ответу сервера.
@visibleForTesting
String blockResultText(AdminUserBlockResult result) {
  final hidden = result.hiddenReviews;
  if (hidden == null) return 'Пользователь заблокирован';
  if (hidden == 0) {
    return 'Пользователь заблокирован. Видимых отзывов у него не было — '
        'скрывать было нечего';
  }
  return 'Пользователь заблокирован, скрыто отзывов: ${formatCount(hidden)}';
}

/// Итог разблокировки: сколько отзывов вернулось из скольких скрыла
/// блокировка — и почему не все.
@visibleForTesting
String unblockResultText(
  AdminUserUnblockResult result, {
  required bool restoreReviews,
}) {
  if (!restoreReviews) {
    return 'Пользователь разблокирован, его отзывы остались скрытыми';
  }
  if (!result.blockFound) {
    return 'Пользователь разблокирован. Записи о блокировке в журнале нет — '
        'скрытые отзывы остались как были';
  }
  if (result.blockByOperator) {
    return 'Пользователь разблокирован. Блокировку ставил оператор скриптом, '
        'без списка отзывов, — скрытые отзывы остались как были';
  }
  final restored = formatCount(result.restoredReviews);
  final total = result.blockHiddenReviews;
  if (total == null) {
    return 'Пользователь разблокирован, возвращено отзывов: $restored';
  }
  if (total == 0) {
    return 'Пользователь разблокирован. Блокировка не скрывала отзывов — '
        'возвращать было нечего';
  }
  final head = 'Пользователь разблокирован, возвращено отзывов: $restored '
      'из ${formatCount(total)}, скрытых блокировкой';
  if (result.restoredReviews >= total) return head;
  return '$head. Остальные с тех пор скрыли или показали вручную, '
      'или они удалены';
}

/// Подпись, когда сервер ответил `changed: false`: так уже было.
const String kUserActionNothingChanged =
    'Ничего не изменилось: так уже было — возможно, это сделал другой модератор';

/// Текст отказа для модератора — общий разбор панели ([describeError]).
///
/// Сервер пишет отказы этих действий по-русски («У этого партнёра есть
/// карточки заведений…», «Укажите причину») — их разбор и показывает: в них
/// сказано, почему.
@visibleForTesting
String describeUserActionError(Object error) =>
    describeError(error, notFound: kUserNotFoundPhrase);
