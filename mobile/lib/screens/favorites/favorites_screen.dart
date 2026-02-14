import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';

/// Favorites screen - shows user's favorite establishments
/// Displays different states: loading, empty (unauth/auth), error, data
class FavoritesScreen extends StatefulWidget {
  const FavoritesScreen({super.key});

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
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
    Navigator.of(context).pushNamed('/establishment/$establishmentId');
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
      appBar: AppBar(
        title: const Text('Избранное'),
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

              // Data state - list of favorites
              return RefreshIndicator(
                onRefresh: () => provider.refreshFavorites(),
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(
                    vertical: AppDimensions.paddingS,
                  ),
                  itemCount: provider.favoriteEstablishments.length,
                  itemBuilder: (context, index) {
                    final establishment =
                        provider.favoriteEstablishments[index];
                    final isFavorite = provider.isFavorite(establishment.id);

                    return EstablishmentCard(
                      establishment: establishment,
                      isFavorite: isFavorite,
                      onTap: () => _navigateToDetail(establishment.id),
                      onFavoriteToggle: () => _toggleFavorite(establishment.id),
                    );
                  },
                ),
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
