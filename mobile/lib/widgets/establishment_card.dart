import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';

/// Reusable card component for displaying establishment information
/// Used in search results, favorites list, and other establishment lists
class EstablishmentCard extends StatelessWidget {
  final Establishment establishment;
  final bool isFavorite;
  final VoidCallback? onTap;
  final VoidCallback? onFavoriteToggle;
  final double? distanceKm;

  const EstablishmentCard({
    super.key,
    required this.establishment,
    this.isFavorite = false,
    this.onTap,
    this.onFavoriteToggle,
    this.distanceKm,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.symmetric(
        horizontal: AppDimensions.paddingM,
        vertical: AppDimensions.paddingS,
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppDimensions.radiusM),
        child: Container(
          height: AppDimensions.establishmentCardHeight,
          padding: const EdgeInsets.all(AppDimensions.paddingS),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Thumbnail image
              _buildThumbnail(),

              const SizedBox(width: AppDimensions.spacingM),

              // Information column
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Name and rating
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: _buildName(theme)),
                        if (establishment.rating != null)
                          _buildRatingBadge(theme),
                      ],
                    ),

                    const SizedBox(height: AppDimensions.spacingXs),

                    // Category and cuisine
                    _buildCategoryAndCuisine(theme),

                    const SizedBox(height: AppDimensions.spacingXs),

                    // Price range and status
                    Row(
                      children: [
                        if (establishment.priceRange != null)
                          _buildPriceRange(theme),
                        const Spacer(),
                        _buildStatus(theme),
                      ],
                    ),

                    const Spacer(),

                    // Distance and address
                    Row(
                      children: [
                        Expanded(child: _buildAddress(theme)),
                        if (distanceKm != null) _buildDistance(theme),
                      ],
                    ),
                  ],
                ),
              ),

              // Favorite button
              _buildFavoriteButton(),
            ],
          ),
        ),
      ),
    );
  }

  /// Build thumbnail image widget
  Widget _buildThumbnail() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppDimensions.radiusS),
      child: SizedBox(
        width: AppDimensions.cardThumbnailWidth,
        height: AppDimensions.cardThumbnailHeight,
        child: establishment.thumbnailUrl != null
            ? CachedNetworkImage(
                imageUrl: establishment.thumbnailUrl!,
                fit: BoxFit.cover,
                placeholder: (context, url) => Container(
                  color: Colors.grey[200],
                  child: const Center(
                    child: CircularProgressIndicator(),
                  ),
                ),
                errorWidget: (context, url, error) => Container(
                  color: Colors.grey[200],
                  child: const Icon(Icons.restaurant, size: 40),
                ),
              )
            : Container(
                color: Colors.grey[200],
                child: const Icon(Icons.restaurant, size: 40),
              ),
      ),
    );
  }

  /// Build establishment name
  Widget _buildName(ThemeData theme) {
    return Text(
      establishment.name,
      style: theme.textTheme.headlineSmall,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }

  /// Build rating badge
  Widget _buildRatingBadge(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.paddingS,
        vertical: AppDimensions.paddingXs,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.tertiary,
        borderRadius: BorderRadius.circular(AppDimensions.radiusS),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.star,
            size: AppDimensions.iconS,
            color: theme.colorScheme.onTertiary,
          ),
          const SizedBox(width: AppDimensions.spacingXs),
          Text(
            establishment.rating!.toStringAsFixed(1),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onTertiary,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  /// Build category and cuisine
  Widget _buildCategoryAndCuisine(ThemeData theme) {
    final parts = <String>[];
    parts.add(establishment.category);
    if (establishment.cuisine != null) {
      parts.add(establishment.cuisine!);
    }

    return Text(
      parts.join(' • '),
      style: theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.secondary,
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }

  /// Build price range indicator
  Widget _buildPriceRange(ThemeData theme) {
    return Text(
      establishment.priceRange!,
      style: theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.secondary,
        fontWeight: FontWeight.w600,
      ),
    );
  }

  /// Build status (open/closed)
  Widget _buildStatus(ThemeData theme) {
    // For now, show as open
    // Full working hours logic will be implemented in later phases
    final isOpen = establishment.status == 'active';

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.paddingS,
        vertical: AppDimensions.paddingXs,
      ),
      decoration: BoxDecoration(
        color: isOpen
            ? theme.colorScheme.tertiary.withValues(alpha: 0.1)
            : theme.colorScheme.error.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppDimensions.radiusXs),
      ),
      child: Text(
        isOpen ? 'Открыто' : 'Закрыто',
        style: theme.textTheme.bodySmall?.copyWith(
          color: isOpen ? theme.colorScheme.tertiary : theme.colorScheme.error,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  /// Build address
  Widget _buildAddress(ThemeData theme) {
    return Text(
      establishment.address,
      style: theme.textTheme.bodySmall?.copyWith(
        color: theme.colorScheme.secondary,
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }

  /// Build distance indicator
  Widget _buildDistance(ThemeData theme) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.location_on,
          size: AppDimensions.iconS,
          color: theme.colorScheme.secondary,
        ),
        const SizedBox(width: AppDimensions.spacingXs),
        Text(
          '${distanceKm!.toStringAsFixed(1)} км',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.secondary,
          ),
        ),
      ],
    );
  }

  /// Build favorite button
  /// Orange color when active, grey outline when inactive (per Figma design)
  Widget _buildFavoriteButton() {
    // Orange color from Figma design
    const favoriteColor = Color(0xFFFF6B35);

    return IconButton(
      icon: Icon(
        isFavorite ? Icons.favorite : Icons.favorite_border,
        color: isFavorite ? favoriteColor : Colors.grey,
      ),
      onPressed: onFavoriteToggle,
      iconSize: AppDimensions.iconM,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(),
    );
  }
}
