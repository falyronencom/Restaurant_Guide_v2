import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';

/// Results list screen displaying search results with pagination
/// Implements ScrollController for infinite scroll pagination
class ResultsListScreen extends StatefulWidget {
  const ResultsListScreen({super.key});

  @override
  State<ResultsListScreen> createState() => _ResultsListScreenState();
}

class _ResultsListScreenState extends State<ResultsListScreen> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);

    // Initial data fetch
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<EstablishmentsProvider>().searchEstablishments();
    });
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// Handle scroll events for pagination
  void _onScroll() {
    if (_isNearBottom) {
      context.read<EstablishmentsProvider>().loadMore();
    }
  }

  /// Check if scroll position is near bottom (within 200 pixels)
  bool get _isNearBottom {
    if (!_scrollController.hasClients) return false;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.position.pixels;
    return maxScroll - currentScroll <= 200;
  }

  /// Navigate to establishment detail screen
  void _navigateToDetail(int establishmentId) {
    // Placeholder navigation - detail screen will be implemented in Phase 3.3
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Detail view for ID: $establishmentId'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  /// Toggle favorite status with authentication check
  void _toggleFavorite(int establishmentId) {
    final authProvider = context.read<AuthProvider>();

    if (!authProvider.isAuthenticated) {
      // Show login prompt for unauthenticated users
      _showLoginPrompt();
      return;
    }

    final provider = context.read<EstablishmentsProvider>();
    final wasFavorite = provider.isFavorite(establishmentId);

    provider.toggleFavorite(establishmentId).then((_) {
      // Show success snackbar
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              wasFavorite
                  ? 'Удалено из избранного'
                  : 'Добавлено в избранное',
            ),
            duration: const Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }).catchError((error) {
      // Show error snackbar on failure
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

  /// Show login prompt dialog
  void _showLoginPrompt() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Требуется авторизация'),
        content: const Text(
          'Для добавления в избранное необходимо войти в аккаунт.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/auth/login');
            },
            child: const Text('Войти'),
          ),
        ],
      ),
    );
  }

  /// Show sort options bottom sheet
  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      builder: (context) => Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.all(AppDimensions.paddingM),
                child: Text(
                  'Сортировка',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              const Divider(height: 1),
              ...SortOption.values.map((option) => _buildSortOption(
                    option: option,
                    isSelected: provider.currentSort == option,
                    onTap: () {
                      provider.setSort(option);
                      Navigator.of(context).pop();
                    },
                  )),
              const SizedBox(height: AppDimensions.paddingM),
            ],
          ),
        ),
      ),
    );
  }

  /// Build single sort option tile
  Widget _buildSortOption({
    required SortOption option,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    final theme = Theme.of(context);

    return ListTile(
      title: Text(
        option.displayLabel,
        style: TextStyle(
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          color: isSelected ? theme.colorScheme.primary : null,
        ),
      ),
      trailing: isSelected
          ? Icon(Icons.check, color: theme.colorScheme.primary)
          : null,
      onTap: onTap,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Результаты поиска'),
        actions: [
          // Sort button
          IconButton(
            icon: const Icon(Icons.sort),
            onPressed: _showSortOptions,
            tooltip: 'Сортировка',
          ),
        ],
      ),
      body: Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) {
          // Initial loading state
          if (provider.isLoading && provider.establishments.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          // Error state with no data
          if (provider.error != null && provider.establishments.isEmpty) {
            return _buildErrorState(theme, provider);
          }

          // Empty state
          if (!provider.isLoading && provider.establishments.isEmpty) {
            return _buildEmptyState(theme);
          }

          // Results list
          return Column(
            children: [
              // Result count header
              _buildResultsHeader(theme, provider),

              // Establishments list
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => provider.refresh(),
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                      vertical: AppDimensions.paddingS,
                    ),
                    // Add 1 for loading indicator if more pages available
                    itemCount: provider.establishments.length +
                        (provider.hasMorePages ? 1 : 0),
                    itemBuilder: (context, index) {
                      // Loading indicator at bottom
                      if (index == provider.establishments.length) {
                        return _buildPaginationLoader(provider);
                      }

                      final establishment = provider.establishments[index];
                      final isFavorite = provider.isFavorite(establishment.id);

                      return EstablishmentCard(
                        establishment: establishment,
                        isFavorite: isFavorite,
                        onTap: () => _navigateToDetail(establishment.id),
                        onFavoriteToggle: () =>
                            _toggleFavorite(establishment.id),
                      );
                    },
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  /// Build results header with count and sort indicator
  Widget _buildResultsHeader(ThemeData theme, EstablishmentsProvider provider) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.paddingM,
        vertical: AppDimensions.paddingS,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        border: Border(
          bottom: BorderSide(
            color: theme.dividerColor,
            width: 1,
          ),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            'Найдено: ${provider.totalResults}',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          // Current sort indicator
          GestureDetector(
            onTap: _showSortOptions,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.sort,
                  size: AppDimensions.iconS,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: AppDimensions.spacingXs),
                Text(
                  provider.currentSort.displayLabel,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Build pagination loading indicator at list bottom
  Widget _buildPaginationLoader(EstablishmentsProvider provider) {
    if (!provider.isLoadingMore) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(AppDimensions.paddingM),
      alignment: Alignment.center,
      child: const CircularProgressIndicator(),
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
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              provider.error!,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.secondary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppDimensions.spacingL),
            FilledButton.icon(
              onPressed: () => provider.refresh(),
              icon: const Icon(Icons.refresh),
              label: const Text('Повторить'),
            ),
          ],
        ),
      ),
    );
  }

  /// Build empty state widget
  Widget _buildEmptyState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppDimensions.paddingL),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.search_off,
              size: 64,
              color: theme.colorScheme.secondary,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            Text(
              'Ничего не найдено',
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              'Попробуйте изменить параметры поиска или выбрать другой город.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.secondary,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
