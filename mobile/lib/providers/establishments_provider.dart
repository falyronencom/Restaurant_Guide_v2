import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';

/// Sort options for establishment list
enum SortOption {
  distance,
  rating,
  priceAsc,
  priceDesc;

  /// Convert to API parameter value
  String toApiValue() {
    switch (this) {
      case SortOption.distance:
        return 'distance';
      case SortOption.rating:
        return 'rating';
      case SortOption.priceAsc:
        return 'price_asc';
      case SortOption.priceDesc:
        return 'price_desc';
    }
  }

  /// Display label in Russian
  String get displayLabel {
    switch (this) {
      case SortOption.distance:
        return 'По расстоянию';
      case SortOption.rating:
        return 'По рейтингу';
      case SortOption.priceAsc:
        return 'По цене ↑';
      case SortOption.priceDesc:
        return 'По цене ↓';
    }
  }
}

/// Establishments state provider
/// Manages search results, filters, and establishment details
class EstablishmentsProvider with ChangeNotifier {
  final EstablishmentsService _service;

  // Search results state
  List<Establishment> _establishments = [];
  PaginationMeta? _paginationMeta;
  bool _isLoading = false;
  bool _isLoadingMore = false;
  String? _error;

  // Sort state
  SortOption _currentSort = SortOption.rating;

  // Current filters (simple)
  String? _selectedCity;
  String? _searchQuery;

  // Advanced filters (Phase 3.2)
  DistanceOption _distanceFilter = DistanceOption.all;
  Set<PriceRange> _priceFilters = {};
  HoursFilter? _hoursFilter;
  Set<String> _categoryFilters = {};
  Set<String> _cuisineFilters = {};
  Set<String> _amenityFilters = {};

  // Detail view state
  Establishment? _selectedEstablishment;
  bool _isLoadingDetail = false;

  // Favorites state
  Set<int> _favoriteIds = {};
  List<Establishment> _favoriteEstablishments = [];
  bool _isFavoritesLoading = false;
  String? _favoritesError;

  EstablishmentsProvider({EstablishmentsService? service})
      : _service = service ?? EstablishmentsService();

  // ============================================================================
  // Getters - Search Results
  // ============================================================================

  /// List of establishments from current search
  List<Establishment> get establishments => _establishments;

  /// Pagination metadata
  PaginationMeta? get paginationMeta => _paginationMeta;

  /// Whether establishments are being loaded (initial load)
  bool get isLoading => _isLoading;

  /// Whether more establishments are being loaded (pagination)
  bool get isLoadingMore => _isLoadingMore;

  /// Current error message, if any
  String? get error => _error;

  /// Current sort option
  SortOption get currentSort => _currentSort;

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
  String? get searchQuery => _searchQuery;

  // Advanced filter getters
  DistanceOption get distanceFilter => _distanceFilter;
  Set<PriceRange> get priceFilters => Set.unmodifiable(_priceFilters);
  HoursFilter? get hoursFilter => _hoursFilter;
  Set<String> get categoryFilters => Set.unmodifiable(_categoryFilters);
  Set<String> get cuisineFilters => Set.unmodifiable(_cuisineFilters);
  Set<String> get amenityFilters => Set.unmodifiable(_amenityFilters);

  /// Whether any filters are active
  bool get hasActiveFilters {
    return _selectedCity != null ||
        (_searchQuery != null && _searchQuery!.isNotEmpty) ||
        _distanceFilter != DistanceOption.all ||
        _priceFilters.isNotEmpty ||
        _hoursFilter != null ||
        _categoryFilters.isNotEmpty ||
        _cuisineFilters.isNotEmpty ||
        _amenityFilters.isNotEmpty;
  }

  /// Count of active filter categories (for badge)
  int get activeFilterCount {
    int count = 0;
    if (_distanceFilter != DistanceOption.all) count++;
    if (_priceFilters.isNotEmpty) count++;
    if (_hoursFilter != null) count++;
    if (_categoryFilters.isNotEmpty) count++;
    if (_cuisineFilters.isNotEmpty) count++;
    if (_amenityFilters.isNotEmpty) count++;
    return count;
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

  /// List of favorite establishments with full data
  List<Establishment> get favoriteEstablishments => _favoriteEstablishments;

  /// Whether favorites are being loaded
  bool get isFavoritesLoading => _isFavoritesLoading;

  /// Error message for favorites loading
  String? get favoritesError => _favoritesError;

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
    if (append) {
      if (_isLoadingMore) return;
      _isLoadingMore = true;
    } else {
      if (_isLoading) return;
      _isLoading = true;
      _establishments = [];
    }

    _error = null;
    notifyListeners();

    try {
      final result = await _service.searchEstablishments(
        page: page,
        city: _selectedCity,
        category: _categoryFilters.isNotEmpty ? _categoryFilters.join(',') : null,
        cuisine: _cuisineFilters.isNotEmpty ? _cuisineFilters.join(',') : null,
        priceRange: _priceFilters.isNotEmpty
            ? _priceFilters.map((p) => p.apiValue).join(',')
            : null,
        maxDistance: _distanceFilter.toMeters()?.toDouble(),
        search: _searchQuery,
        sortBy: _currentSort.toApiValue(),
      );

      if (append) {
        _establishments.addAll(result.data);
        _isLoadingMore = false;
      } else {
        _establishments = result.data;
        _isLoading = false;
      }

      _paginationMeta = result.meta;
      notifyListeners();
    } catch (e) {
      _error = _extractErrorMessage(e);
      if (append) {
        _isLoadingMore = false;
      } else {
        _isLoading = false;
      }
      notifyListeners();
    }
  }

  /// Load next page of results
  Future<void> loadMore() async {
    if (!hasMorePages || _isLoading || _isLoadingMore) return;

    await searchEstablishments(
      page: currentPage + 1,
      append: true,
    );
  }

  /// Refresh current search
  Future<void> refresh() async {
    await searchEstablishments(page: 1, append: false);
  }

  /// Set sort option and refresh results
  void setSort(SortOption sort) {
    if (_currentSort == sort) return;
    _currentSort = sort;
    notifyListeners();
    // Trigger new search with updated sort
    searchEstablishments(page: 1, append: false);
  }

  // ============================================================================
  // Filter Management
  // ============================================================================

  /// Set city filter
  void setCity(String? city) {
    _selectedCity = city;
    notifyListeners();
  }

  /// Set search query
  void setSearchQuery(String? query) {
    _searchQuery = query;
    notifyListeners();
  }

  // --- Distance Filter (single selection) ---

  /// Set distance filter
  void setDistanceFilter(DistanceOption option) {
    if (_distanceFilter == option) return;
    _distanceFilter = option;
    notifyListeners();
  }

  // --- Price Range Filter (multi-selection) ---

  /// Toggle price range filter
  void togglePriceFilter(PriceRange range) {
    if (_priceFilters.contains(range)) {
      _priceFilters.remove(range);
    } else {
      _priceFilters.add(range);
    }
    notifyListeners();
  }

  /// Set all price filters at once
  void setPriceFilters(Set<PriceRange> ranges) {
    _priceFilters = Set.from(ranges);
    notifyListeners();
  }

  /// Clear price filters
  void clearPriceFilters() {
    _priceFilters.clear();
    notifyListeners();
  }

  // --- Hours Filter (single selection) ---

  /// Set hours filter
  void setHoursFilter(HoursFilter? filter) {
    _hoursFilter = filter;
    notifyListeners();
  }

  // --- Category Filter (multi-selection) ---

  /// Toggle category filter
  void toggleCategoryFilter(String category) {
    if (_categoryFilters.contains(category)) {
      _categoryFilters.remove(category);
    } else {
      _categoryFilters.add(category);
    }
    notifyListeners();
  }

  /// Set all categories (for "Все" toggle)
  void setAllCategories(bool selectAll) {
    if (selectAll) {
      _categoryFilters = Set.from(FilterConstants.categories);
    } else {
      _categoryFilters.clear();
    }
    notifyListeners();
  }

  /// Check if all categories are selected
  bool get allCategoriesSelected =>
      _categoryFilters.length == FilterConstants.categories.length;

  // --- Cuisine Filter (multi-selection) ---

  /// Toggle cuisine filter
  void toggleCuisineFilter(String cuisine) {
    if (_cuisineFilters.contains(cuisine)) {
      _cuisineFilters.remove(cuisine);
    } else {
      _cuisineFilters.add(cuisine);
    }
    notifyListeners();
  }

  /// Set all cuisines (for "Все" toggle)
  void setAllCuisines(bool selectAll) {
    if (selectAll) {
      _cuisineFilters = Set.from(FilterConstants.cuisines);
    } else {
      _cuisineFilters.clear();
    }
    notifyListeners();
  }

  /// Check if all cuisines are selected
  bool get allCuisinesSelected =>
      _cuisineFilters.length == FilterConstants.cuisines.length;

  // --- Amenity Filter (multi-selection) ---

  /// Toggle amenity filter
  void toggleAmenityFilter(String amenityCode) {
    if (_amenityFilters.contains(amenityCode)) {
      _amenityFilters.remove(amenityCode);
    } else {
      _amenityFilters.add(amenityCode);
    }
    notifyListeners();
  }

  // --- Clear and Apply ---

  /// Clear all filters (reset to defaults)
  void clearFilters() {
    _selectedCity = null;
    _searchQuery = null;
    _distanceFilter = DistanceOption.all;
    _priceFilters.clear();
    _hoursFilter = null;
    _categoryFilters.clear();
    _cuisineFilters.clear();
    _amenityFilters.clear();
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

    // Store removed establishment for potential revert
    Establishment? removedEstablishment;
    if (wasFavorite) {
      removedEstablishment = _favoriteEstablishments
          .where((e) => e.id == establishmentId)
          .firstOrNull;
    }

    // Optimistic update
    if (wasFavorite) {
      _favoriteIds.remove(establishmentId);
      _removeFromFavoritesList(establishmentId);
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
        // Restore removed establishment to list
        if (removedEstablishment != null) {
          _favoriteEstablishments.add(removedEstablishment);
        }
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
    _isFavoritesLoading = true;
    _favoritesError = null;
    notifyListeners();

    try {
      final favorites = await _service.getFavorites();
      _favoriteEstablishments = favorites;
      _favoriteIds = favorites.map((e) => e.id).toSet();
      _isFavoritesLoading = false;
      notifyListeners();
    } catch (e) {
      _favoritesError = _extractErrorMessage(e);
      _isFavoritesLoading = false;
      notifyListeners();
    }
  }

  /// Refresh favorites list (for pull-to-refresh)
  Future<void> refreshFavorites() async {
    await loadFavorites();
  }

  /// Remove establishment from favorites list (optimistic update)
  void _removeFromFavoritesList(int establishmentId) {
    _favoriteEstablishments.removeWhere((e) => e.id == establishmentId);
    notifyListeners();
  }

  /// Clear favorites error
  void clearFavoritesError() {
    _favoritesError = null;
    notifyListeners();
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
