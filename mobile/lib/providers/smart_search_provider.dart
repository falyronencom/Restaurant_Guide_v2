import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/smart_search_service.dart';

/// Smart search states
enum SmartSearchState { idle, loading, results, error }

/// Provider for Smart Search state management.
/// Separate from EstablishmentsProvider — parallel search path.
class SmartSearchProvider extends ChangeNotifier {
  final SmartSearchService _service = SmartSearchService();

  SmartSearchProvider() {
    AccountScope.register(resetAccountScope);
  }

  /// Фраза принадлежит тому, кто её набрал.
  ///
  /// Провайдер живёт в `main.dart` и переживает выход из аккаунта, а превью
  /// рисуется на ПЕРВОМ экране после входа — следующий вошедший видел бы блок
  /// выдачи под чужим запросом, ничего не набирая. Это устаревшее состояние, а
  /// не утечка ПДн (сама выдача — публичный каталог), но показывать человеку
  /// чужой запрос на старте всё равно нельзя. / The phrase belongs to whoever
  /// typed it; the preview renders on the first screen after login.
  /// Bumped on every account-scope reset; a search started before the reset
  /// drops its answer (pack 1 of the critics' findings, point 4 — Codex C2).
  int _generation = 0;

  void resetAccountScope() {
    _generation++;
    _state = SmartSearchState.idle;
    _smartResults = [];
    _totalResults = 0;
    _parsedIntent = null;
    _isFallback = false;
    _matchedTotal = null;
    _errorMessage = null;
    _lastQuery = '';
    notifyListeners();
  }

  SmartSearchState _state = SmartSearchState.idle;
  List<Establishment> _smartResults = [];
  int _totalResults = 0;
  SmartSearchIntent? _parsedIntent;
  bool _isFallback = false;
  int? _matchedTotal;
  String? _errorMessage;
  String _lastQuery = '';

  // Getters
  SmartSearchState get state => _state;
  List<Establishment> get smartResults => _smartResults;
  int get totalResults => _totalResults;
  SmartSearchIntent? get parsedIntent => _parsedIntent;
  bool get isFallback => _isFallback;

  /// Сколько первых заведений выдачи совпали с фразой (В3); null — сервер
  /// поля не прислал, вся выдача — совпадения.
  int? get matchedTotal => _matchedTotal;

  /// Сколько из показанных в превью — совпадения; остальные идут под
  /// «Возможно, вам подойдут».
  int get matchedShown {
    final matched = _matchedTotal;
    if (matched == null) return _smartResults.length;
    return matched.clamp(0, _smartResults.length);
  }
  String? get errorMessage => _errorMessage;
  String get lastQuery => _lastQuery;
  bool get hasResults => _state == SmartSearchState.results && _smartResults.isNotEmpty;

  /// Execute smart search with AI intent parsing.
  ///
  /// Координаты и фильтры экрана приходят от вызывающего: они живут в
  /// `EstablishmentsProvider` и общие для приложения. Превью ОБЯЗАНО считаться
  /// с ними — иначе «Показать все (N)» обещает N, посчитанное без фильтров, а
  /// следующий экран их применяет и показывает меньше. / The screen's filters
  /// live in EstablishmentsProvider and must reach the preview too, or the
  /// "show all (N)" count promises a number the next screen will not deliver.
  Future<void> executeSmartSearch(
    String query, {
    double? latitude,
    double? longitude,
    ScreenFilters? filters,
  }) async {
    if (query.trim().isEmpty) return;

    _lastQuery = query.trim();
    _state = SmartSearchState.loading;
    _errorMessage = null;
    notifyListeners();

    final generation = _generation;
    try {
      final result = await _service.searchSmart(
        query: _lastQuery,
        latitude: latitude,
        longitude: longitude,
        city: filters?.city,
        categories: filters?.categories,
        cuisines: filters?.cuisines,
        priceRanges: filters?.priceRanges,
        maxDistance: filters?.maxDistance,
        // Та же оговорка, что на экране результатов: сортировка уходит только
        // выбранная человеком, иначе умолчание побьёт сортировку из фразы.
        sortBy: filters?.explicitSortBy,
        hoursFilter: filters?.hoursFilter,
        features: filters?.features,
        limit: 3,
      );
      if (generation != _generation) return; // account switched mid-flight

      _smartResults = result.results;
      _totalResults = result.total;
      _parsedIntent = result.intent;
      _isFallback = result.fallback;
      _matchedTotal = result.matchedTotal;
      _state = SmartSearchState.results;
    } catch (e) {
      if (generation != _generation) return;
      _state = SmartSearchState.error;
      _errorMessage = 'Не удалось выполнить поиск';
      _smartResults = [];
      _totalResults = 0;
      _parsedIntent = null;
      _matchedTotal = null;
    }

    notifyListeners();
  }

  /// Clear state back to idle
  void clear() {
    _state = SmartSearchState.idle;
    _smartResults = [];
    _totalResults = 0;
    _parsedIntent = null;
    _isFallback = false;
    _matchedTotal = null;
    _errorMessage = null;
    _lastQuery = '';
    notifyListeners();
  }
}
