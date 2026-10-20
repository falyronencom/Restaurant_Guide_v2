import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

/// State management for the Reviews Management screen
class AdminReviewsProvider extends ChangeNotifier {
  final AdminReviewService _service;

  AdminReviewsProvider({AdminReviewService? service})
      : _service = service ?? AdminReviewService() {
    AccountScope.register(resetAccountScope);
  }

  static const int perPage = 20;

  /// Номер поколения запроса. Ответ, отправленный раньше пришедшего, свой
  /// результат уже не пишет.
  ///
  /// Перечитка после действия идёт параллельно с тем, что делает модератор:
  /// нажал «Скрыть» на третьей странице, не дождался, кликнул первую — и
  /// перечитка стартует с `_currentPage == 3`, уже после ухода запроса первой.
  /// Победил бы тот, кто ответил последним, а не тот, кого просили последним.
  int _requestSeq = 0;

  /// Поколение аккаунта для ответов на действия (пакет 2, пункт 4; ревью
  /// Phase 3.5). Откат держит копию отзыва, полученную прежним аккаунтом; у
  /// администратора в ней автор и почта. Сброс сдвигает поколение, и ответ
  /// на действие прежнего аккаунта — успех или ошибка — ничего не пишет.
  int _generation = 0;

  // List state
  List<AdminReviewItem> _reviews = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  int _hiddenCount = 0;
  double? _averageRating;

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
  int get hiddenCount => _hiddenCount;
  double? get averageRating => _averageRating;
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
    final seq = ++_requestSeq;
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

      if (seq != _requestSeq) return; // ответ устарел, его уже обогнали
      _reviews = result.reviews;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      _hiddenCount = result.hidden;
      _averageRating = result.averageRating;
      // Выбранный отзыв переопределяется по свежему списку, а не остаётся
      // прежним объектом: после действия модератора у него изменились и
      // статус, и рейтинг заведения, а `selectReview` на тот же id выходит
      // ранним возвратом и панель обновить бы не смог.
      _selectedReview = _selectedId == null
          ? null
          : _reviews.where((r) => r.id == _selectedId).firstOrNull;
      // Вместе с панелью снимается и сам выбор. Иначе `_selectedId` переживает
      // исчезновение отзыва из выборки, и при возврате на прежнюю страницу
      // панель открывается сама, без клика.
      if (_selectedReview == null) _selectedId = null;
      _isLoadingList = false;
      notifyListeners();
    } catch (e) {
      if (seq != _requestSeq) return;
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

  /// Set visibility of the selected review to [visible] (optimistic with
  /// rollback). The target is explicit — the button that was pressed says
  /// «скрыть» or «показать» — and is sent to the server as is, so a repeat of
  /// the same request (the client retries 5xx) asks for the same state.
  Future<bool> setVisibility({required bool visible}) async {
    final id = _selectedId;
    // Второй клик, пока первый запрос в пути, отсекается здесь, а не только
    // серой кнопкой (пункт A2-19).
    if (id == null || _isSubmitting) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;

    // Optimistic update: show the target state immediately for instant UI feedback
    final index = _reviews.indexWhere((r) => r.id == id);
    final bool prevVisible = index >= 0 ? _reviews[index].isVisible : true;
    if (index >= 0) {
      final updated = _reviews[index].copyWith(isVisible: visible);
      _reviews[index] = updated;
      _selectedReview = updated;
    }
    notifyListeners();

    try {
      await _service.setVisibility(id, isVisible: visible);
      if (generation != _generation) return false; // аккаунт уже другой
      _isSubmitting = false;
      notifyListeners();
      // Оптимистичная правка меняет один флаг, а действие меняет больше:
      // число скрытых в подписи экрана и рейтинг заведения в панели. Тихая
      // перечитка страницы сводит их вместе; скелетона при этом нет —
      // строки на месте, о загрузке говорит полоска шапки.
      await loadReviews(page: _currentPage);
      return true;
    } catch (e) {
      // После смены аккаунта откатывать нечего: список — уже нового, и
      // по индексу в нём лежит чужая строка (ревью Phase 3.5 пакета 2).
      if (generation != _generation) return false;
      // Rollback: revert to previous visibility state — by id: the list may
      // have been reloaded while the request was in flight.
      final at = _reviews.indexWhere((r) => r.id == id);
      if (at >= 0) {
        final reverted = _reviews[at].copyWith(isVisible: prevVisible);
        _reviews[at] = reverted;
        if (_selectedId == id) _selectedReview = reverted;
      }
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      // «Уже удалён», «видимость только что изменили»: откат вернул строку к
      // состоянию до клика, а на сервере она уже другая — перечитать.
      if (refusalMeansStaleData(e)) await loadReviews(page: _currentPage);
      return false;
    }
  }

  /// Delete the selected review (optimistic with rollback)
  Future<bool> deleteReview(String? reason) async {
    final id = _selectedId;
    // Второй клик, пока первый запрос в пути, отсекается здесь, а не только
    // серой кнопкой (пункт A2-19).
    if (id == null || _isSubmitting) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;

    // Optimistic update: mark as deleted immediately
    final index = _reviews.indexWhere((r) => r.id == id);
    AdminReviewItem? prevReview;
    if (index >= 0) {
      prevReview = _reviews[index];
      final updated = _reviews[index].copyWith(isDeleted: true);
      _reviews[index] = updated;
      _selectedReview = updated;
    }
    notifyListeners();

    try {
      await _service.deleteReview(id, reason: reason);
      if (generation != _generation) return false; // аккаунт уже другой
      _isSubmitting = false;
      notifyListeners();
      // Удаление пересчитывает рейтинг заведения — панель обязана показать
      // новый, иначе «без этого отзыва 4,12» так и останется обещанием.
      await loadReviews(page: _currentPage);
      return true;
    } catch (e) {
      // Сохранённая для отката копия получена прежним аккаунтом: после смены
      // аккаунта (администратор → просмотрщик) она несла бы автора и почту в
      // список нового (ревью Phase 3.5 пакета 2).
      if (generation != _generation) return false;
      // Rollback: restore original review state — by id, not by index.
      final at = _reviews.indexWhere((r) => r.id == id);
      if (at >= 0 && prevReview != null) {
        _reviews[at] = prevReview;
        if (_selectedId == id) _selectedReview = prevReview;
      }
      _isSubmitting = false;
      _submitError = _extractMessage(e);
      notifyListeners();
      // «Уже удалён», «видимость только что изменили»: откат вернул строку к
      // состоянию до клика, а на сервере она уже другая — перечитать.
      if (refusalMeansStaleData(e)) await loadReviews(page: _currentPage);
      return false;
    }
  }

  /// Выбрано ли что-то, кроме порядка. Порядок фильтром не считается: он
  /// задан всегда, и «сбросить» его значит вернуть к тем же новым сверху.
  bool get hasActiveFilters =>
      _statusFilter != null || _ratingFilter != null || _searchQuery.isNotEmpty;

  // Filter setters

  /// Снять все фильтры одним запросом.
  ///
  /// Три отдельных сеттера дали бы три запроса, и два первых ушли бы ещё со
  /// старым поиском. Победил бы ответивший последним, а не отправленный
  /// последним, — и список остался бы отфильтрованным по запросу, которого в
  /// шапке уже нет.
  void resetFilters() {
    _statusFilter = null;
    _ratingFilter = null;
    _searchQuery = '';
    _selectedId = null;
    _selectedReview = null;
    loadReviews();
  }

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

  /// Сброс при смене аккаунта: список, фильтры, выбор и ход действия
  /// принадлежат тому, кто вошёл. Поколение сдвигается, чтобы ответ, летящий
  /// для прежнего аккаунта, не лёг в состояние нового.
  void resetAccountScope() {
    _requestSeq++;
    _generation++;
    _reviews = [];
    _isLoadingList = false;
    _listError = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _hiddenCount = 0;
    _averageRating = null;
    _statusFilter = null;
    _ratingFilter = null;
    _sort = 'newest';
    _searchQuery = '';
    _dateFrom = null;
    _dateTo = null;
    _selectedReview = null;
    _selectedId = null;
    _isSubmitting = false;
    _submitError = null;
    notifyListeners();
  }

  /// Текст отказа для модератора — общий разбор панели ([describeError]).
  String _extractMessage(Object error) =>
      describeError(error, notFound: kReviewNotFoundPhrase);
}
