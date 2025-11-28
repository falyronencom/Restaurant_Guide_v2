import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';

/// Establishments state provider
/// Manages search results, filters, and establishment details
class EstablishmentsProvider with ChangeNotifier {
  final EstablishmentsService _service;

  // Search results state
  List<Establishment> _establishments = [];
  PaginationMeta? _paginationMeta;
  bool _isLoading = false;
  String? _error;

  // Current filters
  String? _selectedCity;
  String? _selectedCategory;
  String? _selectedCuisine;
  String? _selectedPriceRange;
  double? _minRating;
  String? _searchQuery;

  // Detail view state
  Establishment? _selectedEstablishment;
  bool _isLoadingDetail = false;

  // Favorites state
  Set<int> _favoriteIds = {};

  EstablishmentsProvider({EstablishmentsService? service})
      : _service = service ?? EstablishmentsService();

  // ============================================================================
  // Getters - Search Results
  // ============================================================================

  /// List of establishments from current search
  List<Establishment> get establishments => _establishments;

  /// Pagination metadata
  PaginationMeta? get paginationMeta => _paginationMeta;

  /// Whether establishments are being loaded
  bool get isLoading => _isLoading;

  /// Current error message, if any
  String? get error => _error;

  /// Whether there are more pages to load
  bool get hasMorePages {
    if (_paginationMeta == null) return false;
    return _paginationMeta!.page < _paginationMeta!.totalPages;
  }

  /// Current page number
  int get currentPage => _paginationMeta?.page ?? 0;

  /// Total number of results
  int get totalResults => _paginationMeta?.total ?? 0;

  // ============================================================================
  // Getters - Filters
  // ============================================================================

  String? get selectedCity => _selectedCity;
  String? get selectedCategory => _selectedCategory;
  String? get selectedCuisine => _selectedCuisine;
  String? get selectedPriceRange => _selectedPriceRange;
  double? get minRating => _minRating;
  String? get searchQuery => _searchQuery;

  /// Whether any filters are active
  bool get hasActiveFilters {
    return _selectedCity != null ||
        _selectedCategory != null ||
        _selectedCuisine != null ||
        _selectedPriceRange != null ||
        _minRating != null ||
        (_searchQuery != null && _searchQuery!.isNotEmpty);
  }

  // ============================================================================
  // Getters - Detail View
  // ============================================================================

  Establishment? get selectedEstablishment => _selectedEstablishment;
  bool get isLoadingDetail => _isLoadingDetail;

  // ============================================================================
  // Getters - Favorites
  // ============================================================================

  Set<int> get favoriteIds => _favoriteIds;

  bool isFavorite(int establishmentId) {
    return _favoriteIds.contains(establishmentId);
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  /// Search establishments with current filters
  Future<void> searchEstablishments({
    int page = 1,
    bool append = false,
  }) async {
    // Don't start new search if already loading
    if (_isLoading) return;

    _isLoading = true;
    _error = null;

    if (!append) {
      _establishments = [];
    }

    notifyListeners();

    try {
      final result = await _service.searchEstablishments(
        page: page,
        city: _selectedCity,
        category: _selectedCategory,
        cuisine: _selectedCuisine,
        priceRange: _selectedPriceRange,
        minRating: _minRating,
        search: _searchQuery,
      );

      if (append) {
        _establishments.addAll(result.data);
      } else {
        _establishments = result.data;
      }

      _paginationMeta = result.meta;
      _isLoading = false;

      notifyListeners();
    } catch (e) {
      _error = _extractErrorMessage(e);
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Load next page of results
  Future<void> loadMore() async {
    if (!hasMorePages || _isLoading) return;

    await searchEstablishments(
      page: currentPage + 1,
      append: true,
    );
  }

  /// Refresh current search
  Future<void> refresh() async {
    await searchEstablishments(page: 1, append: false);
  }

  // ============================================================================
  // Filter Management
  // ============================================================================

  /// Set city filter
  void setCity(String? city) {
    _selectedCity = city;
    notifyListeners();
  }

  /// Set category filter
  void setCategory(String? category) {
    _selectedCategory = category;
    notifyListeners();
  }

  /// Set cuisine filter
  void setCuisine(String? cuisine) {
    _selectedCuisine = cuisine;
    notifyListeners();
  }

  /// Set price range filter
  void setPriceRange(String? priceRange) {
    _selectedPriceRange = priceRange;
    notifyListeners();
  }

  /// Set minimum rating filter
  void setMinRating(double? rating) {
    _minRating = rating;
    notifyListeners();
  }

  /// Set search query
  void setSearchQuery(String? query) {
    _searchQuery = query;
    notifyListeners();
  }

  /// Clear all filters
  void clearFilters() {
    _selectedCity = null;
    _selectedCategory = null;
    _selectedCuisine = null;
    _selectedPriceRange = null;
    _minRating = null;
    _searchQuery = null;
    notifyListeners();
  }

  /// Apply filters and search
  Future<void> applyFilters() async {
    await searchEstablishments(page: 1, append: false);
  }

  // ============================================================================
  // Detail View Operations
  // ============================================================================

  /// Load detailed information for specific establishment
  Future<void> loadEstablishmentDetail(int id) async {
    _isLoadingDetail = true;
    _error = null;
    notifyListeners();

    try {
      _selectedEstablishment = await _service.getEstablishmentById(id);
      _isLoadingDetail = false;
      notifyListeners();
    } catch (e) {
      _error = _extractErrorMessage(e);
      _isLoadingDetail = false;
      notifyListeners();
    }
  }

  /// Clear selected establishment
  void clearSelectedEstablishment() {
    _selectedEstablishment = null;
    notifyListeners();
  }

  // ============================================================================
  // Favorites Operations
  // ============================================================================

  /// Toggle favorite status for establishment
  Future<void> toggleFavorite(int establishmentId) async {
    final wasFavorite = _favoriteIds.contains(establishmentId);

    // Optimistic update
    if (wasFavorite) {
      _favoriteIds.remove(establishmentId);
    } else {
      _favoriteIds.add(establishmentId);
    }
    notifyListeners();

    try {
      if (wasFavorite) {
        await _service.removeFromFavorites(establishmentId);
      } else {
        await _service.addToFavorites(establishmentId);
      }
    } catch (e) {
      // Revert on error
      if (wasFavorite) {
        _favoriteIds.add(establishmentId);
      } else {
        _favoriteIds.remove(establishmentId);
      }
      notifyListeners();

      // Show error but don't throw
      _error = 'Failed to update favorites';
      notifyListeners();
    }
  }

  /// Load favorites from server
  Future<void> loadFavorites() async {
    try {
      final favorites = await _service.getFavorites();
      _favoriteIds = favorites.map((e) => e.id).toSet();
      notifyListeners();
    } catch (e) {
      // Silently fail - favorites will be empty
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /// Clear error message
  void clearError() {
    _error = null;
    notifyListeners();
  }

  /// Extract user-friendly error message
  String _extractErrorMessage(Object error) {
    final errorStr = error.toString();

    if (errorStr.contains('Network') || errorStr.contains('Connection')) {
      return 'Network error. Please check your internet connection.';
    }
    if (errorStr.contains('404')) {
      return 'Establishment not found.';
    }
    if (errorStr.contains('500')) {
      return 'Server error. Please try again later.';
    }

    return 'An error occurred. Please try again.';
  }
}
