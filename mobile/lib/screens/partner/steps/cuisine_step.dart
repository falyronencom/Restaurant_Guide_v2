import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';

/// Step 2: Cuisine Type Selection
/// Allows user to select up to 3 cuisine types
/// Based on Figma design: Choose cuisine frame
class CuisineStep extends StatelessWidget {
  const CuisineStep({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<PartnerRegistrationProvider>(
      builder: (context, provider, child) {
        return SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 8),

              // Title
              const Text(
                'Категория кухни',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 22,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),

              const SizedBox(height: 4),

              // Subtitle (two lines as in Figma)
              const Text(
                'Допускается выбрать три категории:\nодна основная и две дополнительные',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 15,
                  fontWeight: FontWeight.w400,
                  color: Colors.black,
                  height: 1.5,
                ),
              ),

              const SizedBox(height: 16),

              // Selection counter
              Center(
                child: Text(
                  '${provider.selectedCuisineCount}/${CuisineOptions.maxSelection}',
                  style: const TextStyle(
                    fontFamily: 'Avenir Next',
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    color: Colors.black,
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Cuisine grid
              _buildCuisineGrid(provider),

              const SizedBox(height: 100), // Bottom padding for navigation
            ],
          ),
        );
      },
    );
  }

  /// Build grid of cuisine cards
  Widget _buildCuisineGrid(PartnerRegistrationProvider provider) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 1.0,
      ),
      itemCount: CuisineOptions.items.length,
      itemBuilder: (context, index) {
        final cuisine = CuisineOptions.items[index];
        final isSelected = provider.isCuisineSelected(cuisine.id);

        return _CuisineCard(
          cuisine: cuisine,
          isSelected: isSelected,
          onTap: () => provider.toggleCuisineType(cuisine.id),
        );
      },
    );
  }
}

/// Individual cuisine card widget
class _CuisineCard extends StatelessWidget {
  final CuisineItem cuisine;
  final bool isSelected;
  final VoidCallback onTap;

  const _CuisineCard({
    required this.cuisine,
    required this.isSelected,
    required this.onTap,
  });

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _selectedBorder = Color(0xFFEC723D);
  static const Color _iconOrange = Color(0xFFEC723D);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        decoration: BoxDecoration(
          color: _backgroundColor,
          borderRadius: BorderRadius.circular(10),
          border: isSelected
              ? Border.all(color: _selectedBorder, width: 2)
              : null,
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFD35620).withValues(alpha: 0.08),
              blurRadius: 15,
              spreadRadius: 2,
              offset: const Offset(4, 4),
            ),
            BoxShadow(
              color: const Color(0xFFD35620).withValues(alpha: 0.01),
              blurRadius: 15,
              spreadRadius: 2,
              offset: const Offset(-4, -4),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Icon
            SizedBox(
              height: 94,
              width: 87,
              child: _buildCuisineIcon(cuisine.icon),
            ),

            const SizedBox(height: 8),

            // Name
            Text(
              cuisine.name,
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 17,
                fontWeight: FontWeight.w400,
                color: Colors.black,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  /// Build cuisine icon based on icon name
  Widget _buildCuisineIcon(String iconName) {
    // Map icon names to Flutter icons
    // In production, these would be custom SVG icons from assets
    IconData iconData;

    switch (iconName) {
      case 'national':
        iconData = Icons.restaurant_menu;
        break;
      case 'author':
        iconData = Icons.auto_awesome;
        break;
      case 'asian':
        iconData = Icons.ramen_dining;
        break;
      case 'american':
        iconData = Icons.lunch_dining;
        break;
      case 'italian':
        iconData = Icons.local_pizza;
        break;
      case 'japanese':
        iconData = Icons.set_meal;
        break;
      case 'georgian':
        iconData = Icons.kebab_dining;
        break;
      case 'vegetarian':
        iconData = Icons.eco;
        break;
      case 'mixed':
        iconData = Icons.dining;
        break;
      case 'continental':
        iconData = Icons.brunch_dining;
        break;
      default:
        iconData = Icons.restaurant;
    }

    return Icon(
      iconData,
      size: 64,
      color: _iconOrange,
    );
  }
}
