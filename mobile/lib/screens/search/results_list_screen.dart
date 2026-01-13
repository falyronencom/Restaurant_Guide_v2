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

  /// Show sort options bottom sheet (Figma design)
  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) => SafeArea(
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
                    // Centered title
                    Text(
                      'Сортировка',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    // X button on the left
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

  /// Build single sort option with checkbox (Figma design)
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
            // Checkbox style indicator
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
                  ? const Icon(
                      Icons.check,
                      size: 16,
                      color: Colors.white,
                    )
                  : null,
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Результаты поиска'),
        actions: [
          // Filter button with badge
          Consumer<EstablishmentsProvider>(
            builder: (context, provider, child) => Stack(
              alignment: Alignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.tune),
                  onPressed: () => Navigator.of(context).pushNamed('/filter'),
                  tooltip: 'Фильтры',
                ),
                if (provider.activeFilterCount > 0)
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                        color: Colors.red,
                        shape: BoxShape.circle,
                      ),
                      constraints: const BoxConstraints(
                        minWidth: 18,
                        minHeight: 18,
                      ),
                      child: Text(
                        '${provider.activeFilterCount}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
              ],
            ),
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

  /// Build results header with sort and map buttons (Figma design)
  Widget _buildResultsHeader(ThemeData theme, EstablishmentsProvider provider) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Sort and Map buttons row
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppDimensions.paddingM,
            vertical: AppDimensions.paddingS,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Sort button
              GestureDetector(
                onTap: _showSortOptions,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.swap_vert,
                      size: 22,
                    ),
                    const SizedBox(width: AppDimensions.spacingS),
                    Text(
                      'Сортировка',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              // Map button (placeholder for Phase 3.3)
              GestureDetector(
                onTap: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Карта будет доступна в следующем обновлении'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                },
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.map_outlined,
                      size: 22,
                    ),
                    const SizedBox(width: AppDimensions.spacingS),
                    Text(
                      'Карта',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        // Results count
        Padding(
          padding: const EdgeInsets.only(
            left: AppDimensions.paddingM,
            bottom: AppDimensions.paddingS,
          ),
          child: Text(
            'Результаты: ${provider.totalResults}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.secondary,
            ),
          ),
        ),
      ],
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
