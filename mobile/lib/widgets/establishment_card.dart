import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Reusable card component for displaying establishment information
/// Figma design implementation with image on left, content on right
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

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _greenColor = AppTheme.statusGreen;
  static const Color _orangeHeart = AppTheme.primaryOrange;
  static const Color _greyText = Color(0xFFAAAAAA);

  // Figma dimensions
  static const double _cardHeight = 291.0;
  static const double _imageWidth = 172.0;
  static const double _ratingSize = 31.0;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: _cardHeight,
        margin: const EdgeInsets.symmetric(horizontal: 13, vertical: 15),
        child: Row(
          children: [
            // Left: Image with custom shape
            _buildImage(),
            // Right: Content area
            Expanded(child: _buildContentArea()),
          ],
        ),
      ),
    );
  }

  /// Build image with rounded corners mask (Figma design)
  Widget _buildImage() {
    return ClipPath(
      clipper: _ImageClipper(),
      child: SizedBox(
        width: _imageWidth,
        height: _cardHeight,
        child: establishment.thumbnailUrl != null
            ? CachedNetworkImage(
                imageUrl: establishment.thumbnailUrl!,
                fit: BoxFit.cover,
                placeholder: (context, url) => Container(
                  color: Colors.grey[300],
                  child: const Center(
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
                errorWidget: (context, url, error) => Container(
                  color: Colors.grey[300],
                  child: const Icon(Icons.restaurant, size: 48, color: Colors.grey),
                ),
              )
            : Container(
                color: Colors.grey[300],
                child: const Icon(Icons.restaurant, size: 48, color: Colors.grey),
              ),
      ),
    );
  }

  /// Build content area with beige background (Figma design)
  Widget _buildContentArea() {
    return Container(
      decoration: const BoxDecoration(
        color: _backgroundColor,
        borderRadius: BorderRadius.only(
          topRight: Radius.circular(10),
          bottomRight: Radius.circular(40),
        ),
        boxShadow: [
          BoxShadow(
            color: Color(0x0AD35620),
            offset: Offset(4, 4),
            blurRadius: 15,
            spreadRadius: 2,
          ),
          BoxShadow(
            color: Color(0x0AD35620),
            offset: Offset(-4, -4),
            blurRadius: 15,
            spreadRadius: 2,
          ),
        ],
      ),
      padding: const EdgeInsets.fromLTRB(14, 38, 15, 16),
      child: Stack(
        children: [
          // Main content column
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Name
              _buildName(),
              const SizedBox(height: 2),
              // Category (type)
              _buildCategory(),
              // Cuisine in brackets
              _buildCuisine(),
              const SizedBox(height: 20),
              // Status with closing time
              _buildStatus(),
              const SizedBox(height: 17),
              // Distance
              if (distanceKm != null) _buildDistance(),
              // Address
              _buildAddress(),
            ],
          ),
          // Rating badge (top right)
          Positioned(
            top: 0,
            right: 0,
            child: _buildRatingAndPrice(),
          ),
          // Favorite button (bottom right)
          Positioned(
            bottom: 0,
            right: 0,
            child: _buildFavoriteButton(),
          ),
        ],
      ),
    );
  }

  /// Build establishment name (Unbounded font, 18px)
  Widget _buildName() {
    return Text(
      establishment.name,
      style: AppTheme.unbounded(
        fontSize: 18,
        fontWeight: FontWeight.w400,
        color: Colors.black,
        height: 25 / 18,
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }

  /// Build category/type (Avenir Next, 13px)
  Widget _buildCategory() {
    return Text(
      _getCategoryLabel(establishment.category),
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: Colors.black,
        height: 20 / 13,
      ),
    );
  }

  /// Build cuisine in brackets (Avenir Next, 13px, grey)
  Widget _buildCuisine() {
    if (establishment.cuisine == null) return const SizedBox.shrink();

    return Text(
      '{${establishment.cuisine}}',
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: _greyText,
        height: 20 / 13,
      ),
    );
  }

  /// Build rating badge and price (Figma design)
  Widget _buildRatingAndPrice() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Rating badge
        if (establishment.rating != null)
          Container(
            width: _ratingSize,
            height: _ratingSize,
            decoration: BoxDecoration(
              color: _greenColor,
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
            ),
            alignment: Alignment.center,
            child: Text(
              establishment.rating!.toStringAsFixed(1).replaceAll('.', ','),
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w400,
                color: _backgroundColor,
                height: 25 / 16,
              ),
            ),
          ),
        const SizedBox(height: 6),
        // Price range
        if (establishment.priceRange != null)
          Text(
            establishment.priceRange!,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w400,
              color: Colors.black,
              height: 25 / 15,
            ),
          ),
      ],
    );
  }

  /// Build status with closing time (Figma design)
  Widget _buildStatus() {
    final isOpen = establishment.isCurrentlyOpen;
    final closingTime = establishment.todayClosingTime;

    return RichText(
      text: TextSpan(
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          height: 20 / 14,
        ),
        children: [
          TextSpan(
            text: isOpen ? 'Открыто' : 'Закрыто',
            style: TextStyle(
              color: isOpen ? _greenColor : Colors.red,
            ),
          ),
          if (closingTime != null && isOpen)
            TextSpan(
              text: '/до $closingTime',
              style: const TextStyle(
                color: Colors.black,
                fontWeight: FontWeight.w400,
              ),
            ),
        ],
      ),
    );
  }

  /// Build distance text (Figma design)
  Widget _buildDistance() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(
        '${distanceKm!.toStringAsFixed(1).replaceAll('.', ',')} км от вас',
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: Colors.black,
          height: 20 / 14,
        ),
      ),
    );
  }

  /// Build address with underline (Figma design)
  Widget _buildAddress() {
    return Text(
      establishment.address,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        color: Colors.black,
        decoration: TextDecoration.underline,
        height: 20 / 14,
      ),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
  }

  /// Build favorite button (Figma design - heart icon)
  Widget _buildFavoriteButton() {
    return GestureDetector(
      onTap: onFavoriteToggle,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Icon(
          isFavorite ? Icons.favorite : Icons.favorite_border,
          size: 27,
          color: isFavorite ? _orangeHeart : _orangeHeart,
        ),
      ),
    );
  }

  /// Get category label in Russian
  String _getCategoryLabel(String category) {
    const categoryLabels = {
      'restaurant': 'ресторан',
      'cafe': 'кафе',
      'bar': 'бар',
      'coffee_shop': 'кофейня',
      'fast_food': 'фастфуд',
      'bakery': 'пекарня',
      'pizzeria': 'пиццерия',
    };
    return categoryLabels[category.toLowerCase()] ?? category;
  }

}

/// Custom clipper for image with rounded LEFT corners (Figma design - "bathtub" shape)
/// Top-left and bottom-left corners are rounded, right side is straight
class _ImageClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final path = Path();
    const radius = 40.0;

    // Start from top-left corner (after curve)
    path.moveTo(0, radius);
    // Curve at top-left
    path.quadraticBezierTo(0, 0, radius, 0);
    // Line to top-right (straight)
    path.lineTo(size.width, 0);
    // Line down to bottom-right (straight)
    path.lineTo(size.width, size.height);
    // Line to bottom-left (before curve)
    path.lineTo(radius, size.height);
    // Curve at bottom-left
    path.quadraticBezierTo(0, size.height, 0, size.height - radius);
    // Line back to start
    path.lineTo(0, radius);
    path.close();

    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}
