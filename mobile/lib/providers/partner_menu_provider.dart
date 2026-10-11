import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/partner_menu_service.dart';

/// Polling interval aligned with notifications polling (Segment C Block 1).
const Duration _pollingInterval = Duration(seconds: 30);

/// Partner-facing state for the "Меню" section of an establishment.
///
/// States (see Segment C directive, Option A simplification):
///   - SUCCESS:   items present
///   - EMPTY:     items empty (covers both "no PDF" and "OCR in progress" —
///                retry button surfaces 400 NO_PDF_MENUS if applicable)
class PartnerMenuProvider with ChangeNotifier {
  final PartnerMenuService _service;

  String? _currentEstablishmentId;
  List<PartnerMenuItem> _items = [];
  bool _isLoading = false;
  String? _error;
  Timer? _pollingTimer;

  /// Растёт на каждой загрузке и на каждой остановке опроса: загрузка,
  /// пережившая остановку, видит чужой номер и опрос не включает.
  int _pollingSession = 0;

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
    _currentEstablishmentId = null;
    _items = [];
    _isLoading = false;
    _error = null;
    notifyListeners();
  }

  // Getters
  List<PartnerMenuItem> get items => _items;
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
      final fetched = await _service.fetchMenuItems(id);
      if (generation != _generation) return; // account switched mid-flight
      _items = fetched;
      _error = null;
    } catch (e) {
      if (generation != _generation) return;
      if (!silent) {
        _error = 'Не удалось загрузить позиции меню';
      }
      // Silent poll errors are swallowed — existing items remain visible.
    } finally {
      if (generation == _generation) {
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
