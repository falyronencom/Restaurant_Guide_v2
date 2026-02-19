import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';

/// Step 1: Category Selection
/// Allows user to select up to 2 establishment categories
/// Based on Figma design: Choose type frame
class CategoryStep extends StatelessWidget {
  const CategoryStep({super.key});

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
                'Категория заведения',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),

              const SizedBox(height: 4),

              // Subtitle
              const Text(
                'Допускается выбрать две категории',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w400,
                  color: Colors.black,
                ),
              ),

              const SizedBox(height: 16),

              // Selection counter
              Center(
                child: Text(
                  '${provider.selectedCategoriesCount}/${CategoryOptions.maxSelection}',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    color: Colors.black,
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Category grid
              _buildCategoryGrid(provider),

              const SizedBox(height: 100), // Bottom padding for navigation
            ],
          ),
        );
      },
    );
  }

  /// Build grid of category cards
  Widget _buildCategoryGrid(PartnerRegistrationProvider provider) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 1.0,
      ),
      itemCount: CategoryOptions.items.length,
      itemBuilder: (context, index) {
        final category = CategoryOptions.items[index];
        final isSelected = provider.isCategorySelected(category.id);

        return _CategoryCard(
          category: category,
          isSelected: isSelected,
          onTap: () => provider.toggleCategory(category.id),
        );
      },
    );
  }
}

/// Individual category card widget
class _CategoryCard extends StatelessWidget {
  final CategoryItem category;
  final bool isSelected;
  final VoidCallback onTap;

  const _CategoryCard({
    required this.category,
    required this.isSelected,
    required this.onTap,
  });

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _selectedBorder = AppTheme.primaryOrangeLight;

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
              child: _buildCategoryIcon(category.icon),
            ),

            const SizedBox(height: 8),

            // Name
            Text(
              category.name,
              style: const TextStyle(
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

  /// Build category icon from SVG asset
  Widget _buildCategoryIcon(String iconName) {
    const iconToFile = {
      'restaurant': 'Ресторан',
      'cafe': 'Кафе',
      'coffee': 'Кофейня',
      'fastfood': 'ФастФуд',
      'bar': 'Бар',
      'cake': 'Кондитерская',
      'pizza': 'Пиццерия',
      'bakery': 'Пекарня',
      'pub': 'Паб',
      'canteen': 'Столовая',
      'hookah': 'Кальянная',
      'bowling': 'Боулинг',
      'karaoke': 'Караоке',
      'billiards': 'Бильярд',
    };
    final fileName = iconToFile[iconName] ?? 'Ресторан';
    return SvgPicture.asset(
      'assets/icons/$fileName.svg',
      width: 64,
      height: 64,
      colorFilter: ColorFilter.mode(
        AppTheme.primaryOrangeLight,
        BlendMode.srcIn,
      ),
    );
  }
}
