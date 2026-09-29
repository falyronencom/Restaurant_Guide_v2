import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_cover.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/services/location_service.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Favorites screen - shows user's favorite establishments
/// Displays different states: loading, empty (unauth/auth), error, data
///
/// Сверху во всех состояниях — обложка [FavoritesCover] (макет `2b`,
/// 29.09.2026). В списке она сжимается при скролле; в остальных состояниях
/// стоит полной, без чипа сортировки — сортировать нечего.
class FavoritesScreen extends StatefulWidget {
  const FavoritesScreen({super.key});

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
  static const Color _backgroundColor = AppTheme.backgroundWarm;

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
    // rootNavigator: маршрут '/auth/login' живёт в таблице корневого навигатора.
    // Без флага запрос уходит во вкладочный навигатор, а тот на любое имя
    // возвращает корневой экран вкладки — экран «Избранное» приезжал сам на себя.
    Navigator.of(context, rootNavigator: true).pushNamed('/auth/login');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Статус-бар лежит на тёмной обложке — значки светлые.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: _backgroundColor,
        body: Consumer<AuthProvider>(
          builder: (context, authProvider, child) {
            // Unauthenticated state - show login prompt
            if (!authProvider.isAuthenticated) {
              return _withStaticCover(_buildUnauthenticatedState());
            }

            // Authenticated - show favorites with provider
            return Consumer<EstablishmentsProvider>(
              builder: (context, provider, child) {
                // Loading state
                if (provider.isFavoritesLoading &&
                    provider.favoriteEstablishments.isEmpty) {
                  return _withStaticCover(
                    const Center(child: CircularProgressIndicator()),
                  );
                }

                // Error state
                if (provider.favoritesError != null &&
                    provider.favoriteEstablishments.isEmpty) {
                  return _withStaticCover(_buildErrorState(theme, provider));
                }

                // Empty state (authenticated)
                if (!provider.isFavoritesLoading &&
                    provider.favoriteEstablishments.isEmpty) {
                  return _withStaticCover(_buildEmptyAuthenticatedState());
                }

                return _buildList(provider);
              },
            );
          },
        ),
      ),
    );
  }

  /// Полная обложка без чипов над телом состояния.
  Widget _withStaticCover(Widget body) {
    final topInset = MediaQuery.paddingOf(context).top;
    return Column(
      children: [
        SizedBox(
          height: topInset + FavoritesCover.expandedBodyHeight,
          child: FavoritesCover(topInset: topInset),
        ),
        Expanded(child: body),
      ],
    );
  }

  /// Data state: сжимающаяся обложка + список карточек.
  ///
  /// Строки «Результаты: N» больше нет — счётчик живёт в подзаголовке
  /// обложки.
  Widget _buildList(EstablishmentsProvider provider) {
    final topInset = MediaQuery.paddingOf(context).top;
    final favorites = provider.favoriteEstablishments;
    final sortedList = _sortedFavorites(favorites, provider);

    return RefreshIndicator(
      // Индикатор тянется из-под полной обложки, а не из-под статус-бара.
      edgeOffset: topInset + FavoritesCover.expandedBodyHeight,
      onRefresh: () => provider.refreshFavorites(),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPersistentHeader(
            pinned: true,
            delegate: FavoritesCoverHeaderDelegate(
              topInset: topInset,
              subtitle: favoritesSubtitle(
                  favorites.map((e) => e.city).toList()),
              sortLabel: _currentSort.displayLabel,
              onSortTap: _showSortOptions,
            ),
          ),
          SliverPadding(
            // Карточка сама несёт внешний отступ 15.
            padding: const EdgeInsets.only(
              top: AppDimensions.paddingXs,
              bottom: AppDimensions.paddingS,
            ),
            sliver: SliverList.builder(
              itemCount: sortedList.length,
              itemBuilder: (context, index) {
                final establishment = sortedList[index];
                return EstablishmentCard(
                  establishment: establishment,
                  isFavorite: provider.isFavorite(establishment.id),
                  onTap: () => _navigateToDetail(establishment.id),
                  onFavoriteToggle: () => _toggleFavorite(establishment.id),
                  distanceKm: _distanceKm(establishment, provider),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// Расстояние до заведения, если известна настоящая позиция пользователя.
  double? _distanceKm(
      Establishment establishment, EstablishmentsProvider provider) {
    final known = establishment.distance;
    if (known != null) return known;
    if (!provider.hasRealLocation ||
        establishment.latitude == null ||
        establishment.longitude == null) {
      return null;
    }
    return LocationService().calculateDistance(
      provider.userLatitude!,
      provider.userLongitude!,
      establishment.latitude!,
      establishment.longitude!,
    );
  }

  /// Гость: пригласить войти.
  Widget _buildUnauthenticatedState() {
    return _buildEmptyMessage(
      subtitle: 'Войдите, чтобы сохранять любимые заведения',
      action: SizedBox(
        width: 136,
        child: ElevatedButton(
          style: AppTheme.canonCtaM(),
          onPressed: _navigateToLogin,
          child: const Text('Войти'),
        ),
      ),
    );
  }

  /// Build empty state for authenticated user
  Widget _buildEmptyAuthenticatedState() {
    return RefreshIndicator(
      onRefresh: () => context.read<EstablishmentsProvider>().refreshFavorites(),
      child: LayoutBuilder(
        builder: (context, constraints) => ListView(
          // Без явного нуля ListView сам прибавит отступ статус-бара (AppBar,
          // который его раньше съедал, заменён обложкой): сердце уезжало бы
          // вниз, а пустой экран — прокручивался.
          padding: EdgeInsets.zero,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(
              height: constraints.maxHeight,
              child: _buildEmptyMessage(
                subtitle:
                    'Нажмите ♡ на карточке заведения,\nчтобы добавить его сюда',
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Сердце, заголовок, подпись и — у гостя — кнопка входа.
  Widget _buildEmptyMessage({required String subtitle, Widget? action}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppDimensions.paddingL),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.favorite,
              size: 64,
              color: AppTheme.primaryOrange,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            const Text(
              'Здесь будут ваши места',
              style: AppTheme.canonSheetTitle,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              subtitle,
              style: const TextStyle(
                fontFamily: AppTheme.fontBodyFamily,
                fontSize: 15,
                color: AppTheme.gray600,
              ),
              textAlign: TextAlign.center,
            ),
            if (action != null) ...[
              const SizedBox(height: AppDimensions.spacingL),
              action,
            ],
          ],
        ),
      ),
    );
  }

  /// Sort favorites locally by selected option
  List<Establishment> _sortedFavorites(
      List<Establishment> favorites, EstablishmentsProvider provider) {
    final sorted = List<Establishment>.from(favorites);
    switch (_currentSort) {
      case SortOption.rating:
        sorted.sort((a, b) => (b.rating ?? 0).compareTo(a.rating ?? 0));
      case SortOption.priceAsc:
        sorted.sort((a, b) => (a.priceRange ?? '').compareTo(b.priceRange ?? ''));
      case SortOption.priceDesc:
        sorted.sort((a, b) => (b.priceRange ?? '').compareTo(a.priceRange ?? ''));
      case SortOption.distance:
        // Чип обложки теперь называет выбранный порядок вслух — «По
        // расстоянию» обязан сортировать. Места без расстояния (нет позиции
        // или координат) — в конце, в прежнем порядке.
        // List.sort нестабилен — прежний порядок держит индекс.
        final keyed = [
          for (var i = 0; i < sorted.length; i++)
            (i, _distanceKm(sorted[i], provider), sorted[i]),
        ];
        keyed.sort((a, b) {
          final (ia, da, _) = a;
          final (ib, db, _) = b;
          if (da != null && db != null && da != db) return da.compareTo(db);
          if (da == null && db != null) return 1;
          if (da != null && db == null) return -1;
          return ia.compareTo(ib);
        });
        return [for (final (_, _, e) in keyed) e];
    }
    return sorted;
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
                color: isSelected ? AppTheme.textPrimary : Colors.transparent,
                borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                border: Border.all(
                  color: isSelected ? AppTheme.textPrimary : Colors.grey.shade400,
                  width: 1.5,
                ),
              ),
              child: isSelected
                  ? const Icon(Icons.check, size: 16, color: AppTheme.textOnPrimary)
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
