import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/services/location_service.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Favorites screen - shows user's favorite establishments
/// Displays different states: loading, empty (unauth/auth), error, data
class FavoritesScreen extends StatefulWidget {
  const FavoritesScreen({super.key});

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
  // Figma colors
  static const Color _orangeMain = AppTheme.primaryOrange;
  static const Color _backgroundColor = Color(0xFFF4F1EC);

  // Local sort state for favorites
  SortOption _currentSort = SortOption.rating;

  @override
  void initState() {
    super.initState();
    // Load favorites when screen initializes (if authenticated)
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadFavoritesIfAuthenticated();
    });
  }

  /// Load favorites only if user is authenticated
  void _loadFavoritesIfAuthenticated() {
    final authProvider = context.read<AuthProvider>();
    if (authProvider.isAuthenticated) {
      context.read<EstablishmentsProvider>().loadFavorites();
    }
  }

  /// Navigate to establishment detail screen
  void _navigateToDetail(String establishmentId) {
    Navigator.of(context, rootNavigator: true).pushNamed('/establishment/$establishmentId');
  }

  /// Toggle favorite status with snackbar feedback
  void _toggleFavorite(String establishmentId) {
    final provider = context.read<EstablishmentsProvider>();
    final wasFavorite = provider.isFavorite(establishmentId);

    provider.toggleFavorite(establishmentId).then((_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              wasFavorite ? 'Удалено из избранного' : 'Добавлено в избранное',
            ),
            duration: const Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }).catchError((error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Не удалось обновить избранное'),
            backgroundColor: Theme.of(context).colorScheme.error,
            duration: const Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    });
  }

  /// Navigate to login screen
  void _navigateToLogin() {
    Navigator.of(context).pushNamed('/auth/login');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: _backgroundColor,
      appBar: AppBar(
        title: const Text(
          'Избранное',
          style: TextStyle(
            color: _orangeMain,
            fontSize: 20,
            fontWeight: FontWeight.w600,
          ),
        ),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(44),
          child: _buildSortRow(),
        ),
      ),
      body: Consumer<AuthProvider>(
        builder: (context, authProvider, child) {
          // Unauthenticated state - show login prompt
          if (!authProvider.isAuthenticated) {
            return _buildUnauthenticatedState(theme);
          }

          // Authenticated - show favorites with provider
          return Consumer<EstablishmentsProvider>(
            builder: (context, provider, child) {
              // Loading state
              if (provider.isFavoritesLoading &&
                  provider.favoriteEstablishments.isEmpty) {
                return const Center(
                  child: CircularProgressIndicator(),
                );
              }

              // Error state
              if (provider.favoritesError != null &&
                  provider.favoriteEstablishments.isEmpty) {
                return _buildErrorState(theme, provider);
              }

              // Empty state (authenticated)
              if (!provider.isFavoritesLoading &&
                  provider.favoriteEstablishments.isEmpty) {
                return _buildEmptyAuthenticatedState(theme);
              }

              // Data state - sort row + count + list of favorites
              final sortedList = _sortedFavorites(provider.favoriteEstablishments);

              return Column(
                children: [
                  // Results count
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Результаты: ${provider.favoriteEstablishments.length}',
                        style: const TextStyle(
                          fontSize: 14,
                          color: Colors.black,
                        ),
                      ),
                    ),
                  ),
                  // List of favorites
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: () => provider.refreshFavorites(),
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(
                          vertical: AppDimensions.paddingS,
                        ),
                        itemCount: sortedList.length,
                        itemBuilder: (context, index) {
                          final establishment = sortedList[index];
                          final isFavorite = provider.isFavorite(establishment.id);

                          // Calculate distance if user location available
                          double? distanceKm = establishment.distance;
                          if (distanceKm == null &&
                              provider.hasRealLocation &&
                              establishment.latitude != null &&
                              establishment.longitude != null) {
                            distanceKm = LocationService().calculateDistance(
                              provider.userLatitude!,
                              provider.userLongitude!,
                              establishment.latitude!,
                              establishment.longitude!,
                            );
                          }

                          return EstablishmentCard(
                            establishment: establishment,
                            isFavorite: isFavorite,
                            onTap: () => _navigateToDetail(establishment.id),
                            onFavoriteToggle: () => _toggleFavorite(establishment.id),
                            distanceKm: distanceKm,
                          );
                        },
                      ),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  /// Build unauthenticated state - login prompt
  Widget _buildUnauthenticatedState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppDimensions.paddingL),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.favorite_border,
              size: 64,
              color: theme.colorScheme.secondary,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            Text(
              'Войдите, чтобы сохранять любимые заведения',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppDimensions.spacingL),
            FilledButton(
              onPressed: _navigateToLogin,
              child: const Text('Войти'),
            ),
          ],
        ),
      ),
    );
  }

  /// Build empty state for authenticated user
  Widget _buildEmptyAuthenticatedState(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: () => context.read<EstablishmentsProvider>().refreshFavorites(),
      child: ListView(
        children: [
          SizedBox(
            height: MediaQuery.of(context).size.height * 0.7,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(AppDimensions.paddingL),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.favorite_border,
                      size: 64,
                      color: theme.colorScheme.secondary,
                    ),
                    const SizedBox(height: AppDimensions.spacingM),
                    Text(
                      'У вас пока нет избранных заведений',
                      style: theme.textTheme.titleMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppDimensions.spacingS),
                    Text(
                      'Нажмите \u2661 на карточке заведения,\nчтобы добавить его сюда',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.secondary,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Sort favorites locally by selected option
  List<Establishment> _sortedFavorites(List<Establishment> favorites) {
    final sorted = List<Establishment>.from(favorites);
    switch (_currentSort) {
      case SortOption.rating:
        sorted.sort((a, b) => (b.rating ?? 0).compareTo(a.rating ?? 0));
      case SortOption.priceAsc:
        sorted.sort((a, b) => (a.priceRange ?? '').compareTo(b.priceRange ?? ''));
      case SortOption.priceDesc:
        sorted.sort((a, b) => (b.priceRange ?? '').compareTo(a.priceRange ?? ''));
      case SortOption.distance:
        break; // No distance data for favorites
    }
    return sorted;
  }

  /// Build sort row (like search results, adapted for light bg)
  Widget _buildSortRow() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
      child: Row(
        children: [
          GestureDetector(
            onTap: _showSortOptions,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Transform.rotate(
                  angle: 1.5708, // 90 degrees
                  child: const Icon(
                    Icons.compare_arrows,
                    size: 22,
                    color: Colors.black,
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  'Сортировка',
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.black,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Show sort options bottom sheet (same design as search results)
  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header with X button and centered title
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppDimensions.paddingM,
                vertical: AppDimensions.paddingS,
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Text(
                    'Сортировка',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).pop(),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            // Sort options with checkboxes
            ...SortOption.values.map((option) => _buildSortOption(
                  option: option,
                  isSelected: _currentSort == option,
                  onTap: () {
                    setState(() {
                      _currentSort = option;
                    });
                    Navigator.of(context).pop();
                  },
                )),
            const SizedBox(height: AppDimensions.paddingM),
          ],
        ),
      ),
    );
  }

  /// Build single sort option with checkbox (same design as search results)
  Widget _buildSortOption({
    required SortOption option,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppDimensions.paddingL,
          vertical: AppDimensions.paddingM,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              option.displayLabel,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: isSelected ? Colors.black : Colors.transparent,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(
                  color: isSelected ? Colors.black : Colors.grey.shade400,
                  width: 1.5,
                ),
              ),
              child: isSelected
                  ? const Icon(Icons.check, size: 16, color: Colors.white)
                  : null,
            ),
          ],
        ),
      ),
    );
  }

  /// Build error state widget
  Widget _buildErrorState(ThemeData theme, EstablishmentsProvider provider) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppDimensions.paddingL),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            Text(
              'Ошибка загрузки',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              'Не удалось загрузить данные. Проверьте интернет-соединение.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.secondary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppDimensions.spacingL),
            FilledButton.icon(
              onPressed: () => provider.refreshFavorites(),
              icon: const Icon(Icons.refresh),
              label: const Text('Повторить'),
            ),
          ],
        ),
      ),
    );
  }
}
