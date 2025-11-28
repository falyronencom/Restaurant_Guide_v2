/// Application route definitions
/// Centralized route management for navigation
class AppRoutes {
  // Prevent instantiation
  AppRoutes._();

  // ============================================================================
  // Route Names
  // ============================================================================

  /// Main navigation screen with bottom tabs
  static const String mainNavigation = '/';

  // Search tab routes
  static const String searchHome = '/search';
  static const String searchResults = '/search/results';
  static const String establishmentDetail = '/establishment/:id';
  static const String filterScreen = '/filter';

  // News tab routes
  static const String newsHome = '/news';
  static const String newsDetail = '/news/:id';

  // Map tab routes
  static const String mapHome = '/map';
  static const String mapEstablishmentDetail = '/map/establishment/:id';

  // Favorites tab routes
  static const String favoritesHome = '/favorites';
  static const String favoritesEstablishmentDetail = '/favorites/establishment/:id';

  // Profile tab routes
  static const String profileHome = '/profile';
  static const String profileEdit = '/profile/edit';
  static const String profileSettings = '/profile/settings';

  // Authentication routes (for Phase Two)
  static const String login = '/auth/login';
  static const String register = '/auth/register';
  static const String forgotPassword = '/auth/forgot-password';
  static const String resetPassword = '/auth/reset-password';

  // Review routes (for future phases)
  static const String reviewsList = '/establishment/:id/reviews';
  static const String reviewCreate = '/establishment/:id/review/create';
  static const String reviewEdit = '/review/:id/edit';

  // ============================================================================
  // Route Helper Methods
  // ============================================================================

  /// Generate establishment detail route with ID
  static String establishmentDetailWithId(int id) {
    return establishmentDetail.replaceAll(':id', id.toString());
  }

  /// Generate news detail route with ID
  static String newsDetailWithId(int id) {
    return newsDetail.replaceAll(':id', id.toString());
  }

  /// Generate reviews list route for establishment
  static String reviewsListWithId(int establishmentId) {
    return reviewsList.replaceAll(':id', establishmentId.toString());
  }

  /// Generate review edit route with ID
  static String reviewEditWithId(int reviewId) {
    return reviewEdit.replaceAll(':id', reviewId.toString());
  }
}

/// Tab indices for bottom navigation
enum NavigationTab {
  search,
  news,
  map,
  favorites,
  profile;

  /// Get tab from index
  static NavigationTab fromIndex(int idx) {
    if (idx >= 0 && idx < NavigationTab.values.length) {
      return NavigationTab.values[idx];
    }
    return NavigationTab.search;
  }
}
