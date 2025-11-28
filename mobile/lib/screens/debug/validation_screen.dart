import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';

/// Validation screen for testing complete stack integration
/// Fetches real seed data from backend and displays using EstablishmentCard
class ValidationScreen extends StatefulWidget {
  const ValidationScreen({super.key});

  @override
  State<ValidationScreen> createState() => _ValidationScreenState();
}

class _ValidationScreenState extends State<ValidationScreen> {
  @override
  void initState() {
    super.initState();
    // Load establishments from Minsk for validation
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = context.read<EstablishmentsProvider>();
      provider.setCity('Минск');
      provider.searchEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Validation - Backend Integration'),
      ),
      body: Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) {
          // Loading state
          if (provider.isLoading && provider.establishments.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          // Error state
          if (provider.error != null && provider.establishments.isEmpty) {
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
                      'Error Loading Data',
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
                    ElevatedButton.icon(
                      onPressed: () {
                        provider.refresh();
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            );
          }

          // Empty state
          if (provider.establishments.isEmpty) {
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
                      'No Results',
                      style: theme.textTheme.headlineMedium,
                    ),
                    const SizedBox(height: AppDimensions.spacingS),
                    Text(
                      'No establishments found matching your criteria.',
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

          // Success - establishments list
          return Column(
            children: [
              // Header with stats
              Container(
                padding: const EdgeInsets.all(AppDimensions.paddingM),
                color: theme.colorScheme.surfaceContainerHighest,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Backend Integration Test',
                      style: theme.textTheme.headlineSmall,
                    ),
                    const SizedBox(height: AppDimensions.spacingS),
                    Row(
                      children: [
                        _buildStatChip(
                          theme,
                          Icons.check_circle,
                          'API Connected',
                          theme.colorScheme.tertiary,
                        ),
                        const SizedBox(width: AppDimensions.spacingS),
                        _buildStatChip(
                          theme,
                          Icons.storage,
                          '${provider.totalResults} Results',
                          theme.colorScheme.primary,
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // Establishments list
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async {
                    await provider.refresh();
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppDimensions.paddingS,
                    ),
                    itemCount: provider.establishments.length,
                    itemBuilder: (context, index) {
                      final establishment = provider.establishments[index];
                      final isFavorite = provider.isFavorite(establishment.id);

                      return EstablishmentCard(
                        establishment: establishment,
                        isFavorite: isFavorite,
                        onTap: () {
                          // Navigate to detail screen (Phase Four)
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Selected: ${establishment.name}'),
                              duration: const Duration(seconds: 1),
                            ),
                          );
                        },
                        onFavoriteToggle: () {
                          provider.toggleFavorite(establishment.id);
                        },
                      );
                    },
                  ),
                ),
              ),

              // Load more indicator
              if (provider.isLoading && provider.establishments.isNotEmpty)
                Container(
                  padding: const EdgeInsets.all(AppDimensions.paddingM),
                  child: const CircularProgressIndicator(),
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildStatChip(
    ThemeData theme,
    IconData icon,
    String label,
    Color color,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.paddingM,
        vertical: AppDimensions.paddingS,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppDimensions.radiusL),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: AppDimensions.iconS, color: color),
          const SizedBox(width: AppDimensions.spacingS),
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
