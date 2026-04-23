import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';

enum HiddenStatusFilter { all, hidden, notHidden }

/// State for the admin "Позиции меню" dashboard.
///
/// Loads a page of flagged items from the server (max per_page=50) and
/// applies client-side filters on top: city + hidden-status.
/// Backend endpoint only supports `reason` filter in Phase 1; the directive's
/// city/status filters are implemented locally — acceptable for current
/// dataset size (flagged items are a small minority of all menu items).
class MenuItemsModerationProvider with ChangeNotifier {
  final AdminMenuItemService _service;

  List<FlaggedMenuItem> _allItems = [];
  FlaggedMenuItem? _selected;

  bool _isLoading = false;
  String? _error;
  int _totalFromServer = 0;

  // Filters (client-side)
  String? _cityFilter;
  String _searchFilter = '';
  HiddenStatusFilter _statusFilter = HiddenStatusFilter.all;

  // Action state
  bool _isSubmittingAction = false;
  String? _actionError;

  MenuItemsModerationProvider({AdminMenuItemService? service})
      : _service = service ?? AdminMenuItemService();

  // ============================================================================
  // Getters
  // ============================================================================

  List<FlaggedMenuItem> get items {
    return _allItems.where((item) {
      if (_cityFilter != null && _cityFilter!.isNotEmpty) {
        if (item.establishmentCity != _cityFilter) return false;
      }
      if (_searchFilter.isNotEmpty) {
        final q = _searchFilter.toLowerCase();
        final matchesName =
            item.establishmentName.toLowerCase().contains(q) ||
                item.itemName.toLowerCase().contains(q);
        if (!matchesName) return false;
      }
      switch (_statusFilter) {
        case HiddenStatusFilter.hidden:
          if (!item.isHiddenByAdmin) return false;
          break;
        case HiddenStatusFilter.notHidden:
          if (item.isHiddenByAdmin) return false;
          break;
        case HiddenStatusFilter.all:
          break;
      }
      return true;
    }).toList();
  }

  FlaggedMenuItem? get selected => _selected;
  bool get isLoading => _isLoading;
  String? get error => _error;
  int get totalFromServer => _totalFromServer;

  String? get cityFilter => _cityFilter;
  String get searchFilter => _searchFilter;
  HiddenStatusFilter get statusFilter => _statusFilter;

  bool get isSubmittingAction => _isSubmittingAction;
  String? get actionError => _actionError;

  /// Unique cities observed in the currently fetched page (for dropdown).
  List<String> get availableCities {
    final cities = <String>{};
    for (final item in _allItems) {
      if (item.establishmentCity != null &&
          item.establishmentCity!.isNotEmpty) {
        cities.add(item.establishmentCity!);
      }
    }
    final sorted = cities.toList()..sort();
    return sorted;
  }

  // ============================================================================
  // Load
  // ============================================================================

  Future<void> loadFlaggedItems() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _service.getFlaggedItems(perPage: 50);
      _allItems = response.items;
      _totalFromServer = response.total;

      // Preserve selection if item still present
      if (_selected != null) {
        final stillThere = _allItems.where((i) => i.id == _selected!.id);
        _selected = stillThere.isEmpty ? null : stillThere.first;
      }
    } catch (e) {
      _error = 'Не удалось загрузить список позиций';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // ============================================================================
  // Selection
  // ============================================================================

  void selectItem(FlaggedMenuItem item) {
    _selected = item;
    _actionError = null;
    notifyListeners();
  }

  void clearSelection() {
    _selected = null;
    notifyListeners();
  }

  // ============================================================================
  // Filter setters
  // ============================================================================

  void setCityFilter(String? city) {
    _cityFilter = city;
    notifyListeners();
  }

  void setSearchFilter(String q) {
    _searchFilter = q;
    notifyListeners();
  }

  void setStatusFilter(HiddenStatusFilter status) {
    _statusFilter = status;
    notifyListeners();
  }

  // ============================================================================
  // Actions
  // ============================================================================

  Future<bool> hideItem(String menuItemId, String reason) async {
    return _runAction(() async {
      final updated = await _service.hideItem(
        menuItemId: menuItemId,
        reason: reason,
      );
      _applyUpdate(menuItemId, updated);
    });
  }

  Future<bool> unhideItem(String menuItemId) async {
    return _runAction(() async {
      final updated = await _service.unhideItem(menuItemId);
      _applyUpdate(menuItemId, updated);
    });
  }

  Future<bool> dismissFlag(String menuItemId) async {
    return _runAction(() async {
      final updated = await _service.dismissFlag(menuItemId);
      // dismissFlag clears sanity_flag — item typically drops from the list.
      final clearedFlag = updated['sanity_flag'] == null;
      if (clearedFlag) {
        _allItems = _allItems.where((i) => i.id != menuItemId).toList();
        if (_selected?.id == menuItemId) {
          _selected = null;
        }
      } else {
        _applyUpdate(menuItemId, updated);
      }
    });
  }

  Future<bool> _runAction(Future<void> Function() action) async {
    _isSubmittingAction = true;
    _actionError = null;
    notifyListeners();
    try {
      await action();
      return true;
    } catch (e) {
      _actionError = 'Не удалось выполнить действие';
      return false;
    } finally {
      _isSubmittingAction = false;
      notifyListeners();
    }
  }

  void _applyUpdate(String menuItemId, Map<String, dynamic> updated) {
    final idx = _allItems.indexWhere((i) => i.id == menuItemId);
    if (idx == -1) return;
    final next = _allItems[idx].copyWithAdminUpdate(updated);
    _allItems = List.of(_allItems)..[idx] = next;
    if (_selected?.id == menuItemId) {
      _selected = next;
    }
  }
}
