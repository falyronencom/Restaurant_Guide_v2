import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/menu_recognition.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/partner_menu_service.dart';

/// Polling interval aligned with notifications polling (Segment C Block 1).
const Duration _pollingInterval = Duration(seconds: 30);

/// Partner-facing state for the "Меню" section of an establishment.
///
/// States:
///   - SUCCESS:   items present
///   - EMPTY:     items empty — told apart by [recognition] (from 24.10.2026,
///                finding 3 of the Railway incident): not uploaded / being
///                read / failed with the server's reason. A server without
///                the field leaves [recognition] null, and the screen shows
///                the one empty state it always did (Segment C directive,
///                Option A) — retry button surfaces 400 NO_PDF_MENUS if
///                applicable.
class PartnerMenuProvider with ChangeNotifier {
  final PartnerMenuService _service;

  String? _currentEstablishmentId;
  List<PartnerMenuItem> _items = [];
  MenuRecognition? _recognition;
  bool _isLoading = false;
  String? _error;
  Timer? _pollingTimer;

  /// Растёт на каждой загрузке и на каждой остановке опроса: загрузка,
  /// пережившая остановку, видит чужой номер и опрос не включает.
  int _pollingSession = 0;

  /// Заведения открытых сейчас экранов «Меню», верхний — последним.
  /// Провайдер один на приложение (main.dart), и рисуют его все экраны меню;
  /// нажатие на push или на уведомление открывает экран меню поверх
  /// открытого (main_navigation, notification_list_screen). Верхний
  /// переключает провайдер на свою карточку — нижнему, когда он снова сверху,
  /// нужна своя, и опрос тоже (ревью 24.10.2026, линза: иначе нижний экран
  /// показывал чужую карточку или застывал без опроса).
  final List<String> _openScreens = [];

  PartnerMenuProvider({PartnerMenuService? service})
      : _service = service ?? PartnerMenuService() {
    AccountScope.register(resetAccountScope);
  }

  /// Bumped on every account-scope reset; a request started under the
  /// previous account captured an older value and drops its write, so a late
  /// answer can never show the previous account's data (pack 1 of the critics'
  /// findings, point 4 — Codex C2; the pattern of PartnerDashboardProvider).
  int _generation = 0;

  /// Clears cached menu state and stops polling; registered in
  /// [AccountScope], runs on logout / account switch.
  void resetAccountScope() {
    _generation++;
    stopPolling();
    _openScreens.clear();
    _currentEstablishmentId = null;
    _items = [];
    _recognition = null;
    _isLoading = false;
    _error = null;
    notifyListeners();
  }

  // Getters
  List<PartnerMenuItem> get items => _items;

  /// State of the menu's recognition from the last answer; `null` — not
  /// loaded yet, or a server that does not send it.
  MenuRecognition? get recognition => _recognition;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get hasItems => _items.isNotEmpty;

  /// Items grouped by category_raw, preserving insertion order.
  /// Uncategorized items collected under the empty-string key.
  Map<String, List<PartnerMenuItem>> get itemsByCategory {
    final groups = <String, List<PartnerMenuItem>>{};
    for (final item in _items) {
      final key = item.categoryRaw ?? '';
      groups.putIfAbsent(key, () => []).add(item);
    }
    return groups;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /// Initial fetch and start polling for the given establishment.
  /// Safe to call multiple times — switching establishment resets state.
  Future<void> loadForEstablishment(String establishmentId) async {
    if (_currentEstablishmentId != establishmentId) {
      _currentEstablishmentId = establishmentId;
      _items = [];
      _recognition = null;
      _error = null;
    }
    // Two guards, one answer each: the account changed while the fetch was in
    // flight (generation, pack 1 of the critics' findings, point 4) or the
    // screen was closed / polling stopped (session) — in both cases the timer
    // must not come back.
    final generation = _generation;
    final session = ++_pollingSession;
    await fetchMenuItems();
    if (generation != _generation || session != _pollingSession) return;
    _startPolling();
  }

  /// Экран «Меню» заведения [establishmentId] открылся: загрузить и опрашивать.
  void attachScreen(String establishmentId) {
    _openScreens.add(establishmentId);
    loadForEstablishment(establishmentId);
  }

  /// Экран «Меню» заведения [establishmentId] закрылся. Последний — опрос
  /// останавливается. Верхний, а под ним другой — провайдер возвращается к
  /// карточке нижнего и опрашивает её. Зовётся из `dispose` экрана, поэтому
  /// загрузка ждёт микрозадачи: дерево в это время собирается, перестраивать
  /// его нельзя.
  void detachScreen(String establishmentId) {
    final index = _openScreens.lastIndexOf(establishmentId);
    if (index == -1) return;
    final wasTop = index == _openScreens.length - 1;
    _openScreens.removeAt(index);
    if (_openScreens.isEmpty) {
      stopPolling();
      return;
    }
    if (!wasTop) return;
    final below = _openScreens.last;
    final generation = _generation;
    scheduleMicrotask(() {
      if (generation != _generation ||
          _openScreens.isEmpty ||
          _openScreens.last != below) {
        return;
      }
      loadForEstablishment(below);
    });
  }

  void _startPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = Timer.periodic(_pollingInterval, (_) {
      if (_currentEstablishmentId != null) {
        fetchMenuItems(silent: true);
      }
    });
  }

  void stopPolling() {
    _pollingSession++;
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    super.dispose();
  }

  // ============================================================================
  // Data fetch
  // ============================================================================

  /// Fetch menu items. `silent` suppresses isLoading flag (for background polls).
  Future<void> fetchMenuItems({bool silent = false}) async {
    final id = _currentEstablishmentId;
    if (id == null) return;

    if (!silent) {
      _isLoading = true;
      _error = null;
      notifyListeners();
    }

    final generation = _generation;
    try {
      final fetched = await _service.fetchMenu(id);
      // Account switched mid-flight, or the provider moved to another card
      // (another menu screen opened): the answer is not this card's to show.
      if (generation != _generation || id != _currentEstablishmentId) return;
      _items = fetched.items;
      _recognition = fetched.recognition;
      _error = null;
    } catch (e) {
      if (generation != _generation || id != _currentEstablishmentId) return;
      if (!silent) {
        _error = 'Не удалось загрузить позиции меню';
      }
      // Silent poll errors are swallowed — existing items remain visible.
    } finally {
      if (generation == _generation && id == _currentEstablishmentId) {
        if (!silent) {
          _isLoading = false;
        }
        notifyListeners();
      }
    }
  }

  // ============================================================================
  // Inline edit with optimistic update + rollback
  // ============================================================================

  /// Optimistic update: patch local item immediately, send PATCH, rollback on
  /// failure. Returns true if backend accepted the change.
  Future<bool> updateItem(
    String menuItemId, {
    String? itemName,
    double? priceByn,
    String? categoryRaw,
  }) async {
    final index = _items.indexWhere((item) => item.id == menuItemId);
    if (index == -1) return false;

    final original = _items[index];
    // Partner edit clears sanity_flag (backend also does this, mirror locally).
    final optimistic = original.copyWith(
      itemName: itemName,
      priceByn: priceByn,
      categoryRaw: categoryRaw,
      sanityFlag: null,
    );
    _items = List.of(_items)..[index] = optimistic;
    notifyListeners();

    final generation = _generation;
    try {
      final updated = await _service.updateMenuItem(
        menuItemId,
        itemName: itemName,
        priceByn: priceByn,
        categoryRaw: categoryRaw,
      );
      // Account switched mid-flight: the list is another partner's (or empty)
      // and `index` points nowhere — neither the answer nor a rollback belongs.
      if (generation != _generation) return false;
      _items = List.of(_items)..[index] = updated;
      notifyListeners();
      return true;
    } catch (e) {
      if (generation != _generation) return false;
      // Rollback
      _items = List.of(_items)..[index] = original;
      _error = 'Не удалось сохранить изменения';
      notifyListeners();
      return false;
    }
  }

  // ============================================================================
  // Retry OCR
  // ============================================================================

  Future<RetryOcrResult> retryOcr() async {
    final id = _currentEstablishmentId;
    if (id == null) {
      return RetryOcrResult.failure(
        code: 'NO_ESTABLISHMENT',
        message: 'Заведение не выбрано',
      );
    }
    return _service.retryOcr(id);
  }

  /// Clear transient error (call after snackbar shown).
  void clearError() {
    if (_error != null) {
      _error = null;
      notifyListeners();
    }
  }
}
