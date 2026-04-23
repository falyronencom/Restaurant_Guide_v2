import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
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

  PartnerMenuProvider({PartnerMenuService? service})
      : _service = service ?? PartnerMenuService();

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
    await fetchMenuItems();
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

    try {
      final fetched = await _service.fetchMenuItems(id);
      _items = fetched;
      _error = null;
    } catch (e) {
      if (!silent) {
        _error = 'Не удалось загрузить позиции меню';
      }
      // Silent poll errors are swallowed — existing items remain visible.
    } finally {
      if (!silent) {
        _isLoading = false;
      }
      notifyListeners();
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

    try {
      final updated = await _service.updateMenuItem(
        menuItemId,
        itemName: itemName,
        priceByn: priceByn,
        categoryRaw: categoryRaw,
      );
      _items = List.of(_items)..[index] = updated;
      notifyListeners();
      return true;
    } catch (e) {
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
