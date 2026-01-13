import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';

/// Filter screen for establishment search
/// Figma design: long scrollable panel with fixed Apply button
class FilterScreen extends StatelessWidget {
  const FilterScreen({super.key});

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFFD5F1B);
  static const Color _selectedOrange = Color(0xFFDB4F13);
  static const Color _greyStroke = Color(0xFFD2D2D2);
  static const Color _greyText = Color(0xFFABABAB);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            _buildHeader(context),
            const Divider(height: 1, color: _greyStroke),

            // Scrollable content
            Expanded(
              child: Consumer<EstablishmentsProvider>(
                builder: (context, provider, child) => SingleChildScrollView(
                  padding: const EdgeInsets.only(
                    bottom: 100, // Space for fixed button
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Distance section
                      _buildDistanceSection(context, provider),
                      const _SectionDivider(),

                      // Price section
                      _buildPriceSection(context, provider),
                      const _SectionDivider(),

                      // Hours section
                      _buildHoursSection(context, provider),
                      const _SectionDivider(),

                      // Categories section
                      _buildCategoriesSection(context, provider),
                      const _SectionDivider(),

                      // Cuisines section
                      _buildCuisinesSection(context, provider),
                      const _SectionDivider(),

                      // Amenities section
                      _buildAmenitiesSection(context, provider),
                    ],
                  ),
                ),
              ),
            ),

            // Fixed Apply button
            _buildApplyButton(context),
          ],
        ),
      ),
    );
  }

  /// Header with back button, title, and reset
  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.paddingM,
        vertical: AppDimensions.paddingS,
      ),
      child: Row(
        children: [
          // Back button
          IconButton(
            icon: const Icon(Icons.arrow_back_ios, size: 20),
            onPressed: () => Navigator.of(context).pop(),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
          const Spacer(),
          // Title
          const Text(
            'Фильтр',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w500,
              color: Colors.black,
            ),
          ),
          const Spacer(),
          // Reset button
          TextButton(
            onPressed: () {
              context.read<EstablishmentsProvider>().clearFilters();
            },
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text(
              'Сброс',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w400,
                color: Colors.black,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Distance filter section (single selection with checkboxes)
  Widget _buildDistanceSection(
      BuildContext context, EstablishmentsProvider provider) {
    return _FilterSection(
      title: 'Расстояние от вас',
      child: Column(
        children: DistanceOption.values.map((option) {
          final isSelected = provider.distanceFilter == option;
          return _DistanceOptionTile(
            label: option.displayLabel,
            isSelected: isSelected,
            onTap: () => provider.setDistanceFilter(option),
          );
        }).toList(),
      ),
    );
  }

  /// Price range section (multi-selection cards)
  Widget _buildPriceSection(
      BuildContext context, EstablishmentsProvider provider) {
    return _FilterSection(
      title: 'Средний чек',
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: PriceRange.values.map((range) {
          final isSelected = provider.priceFilters.contains(range);
          return _PriceCard(
            symbol: range.symbol,
            description: range.description,
            isSelected: isSelected,
            onTap: () => provider.togglePriceFilter(range),
          );
        }).toList(),
      ),
    );
  }

  /// Operating hours section (single selection buttons)
  Widget _buildHoursSection(
      BuildContext context, EstablishmentsProvider provider) {
    return _FilterSection(
      title: 'Время работы',
      child: Row(
        children: HoursFilter.values.map((filter) {
          final isSelected = provider.hoursFilter == filter;
          return Expanded(
            child: Padding(
              padding: EdgeInsets.only(
                right: filter != HoursFilter.hours24 ? 10 : 0,
              ),
              child: _HoursButton(
                label: filter.displayLabel,
                isSelected: isSelected,
                onTap: () {
                  if (isSelected) {
                    provider.setHoursFilter(null);
                  } else {
                    provider.setHoursFilter(filter);
                  }
                },
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  /// Categories section (grid with "Все" toggle)
  Widget _buildCategoriesSection(
      BuildContext context, EstablishmentsProvider provider) {
    return _FilterSection(
      title: 'Категория заведения',
      child: Column(
        children: [
          // "Все" toggle
          _AllToggleRow(
            isAllSelected: provider.allCategoriesSelected,
            onToggle: (value) => provider.setAllCategories(value),
          ),
          const SizedBox(height: AppDimensions.spacingM),
          // Categories grid
          _CategoryGrid(
            items: FilterConstants.categories,
            selectedItems: provider.categoryFilters,
            onToggle: (category) => provider.toggleCategoryFilter(category),
          ),
        ],
      ),
    );
  }

  /// Cuisines section (grid with "Все" toggle)
  Widget _buildCuisinesSection(
      BuildContext context, EstablishmentsProvider provider) {
    return _FilterSection(
      title: 'Категория кухни',
      child: Column(
        children: [
          // "Все" toggle
          _AllToggleRow(
            isAllSelected: provider.allCuisinesSelected,
            onToggle: (value) => provider.setAllCuisines(value),
          ),
          const SizedBox(height: AppDimensions.spacingM),
          // Cuisines grid
          _CategoryGrid(
            items: FilterConstants.cuisines,
            selectedItems: provider.cuisineFilters,
            onToggle: (cuisine) => provider.toggleCuisineFilter(cuisine),
          ),
        ],
      ),
    );
  }

  /// Amenities section (checkbox list)
  Widget _buildAmenitiesSection(
      BuildContext context, EstablishmentsProvider provider) {
    return _FilterSection(
      title: 'Дополнительно',
      child: Column(
        children: FilterConstants.amenities.entries.map((entry) {
          final isSelected = provider.amenityFilters.contains(entry.key);
          return _AmenityTile(
            label: entry.value,
            isSelected: isSelected,
            onTap: () => provider.toggleAmenityFilter(entry.key),
          );
        }).toList(),
      ),
    );
  }

  /// Fixed Apply button at bottom
  Widget _buildApplyButton(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppDimensions.paddingM),
      decoration: const BoxDecoration(
        color: _backgroundColor,
        boxShadow: [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 8,
            offset: Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: double.infinity,
          height: 47,
          child: ElevatedButton(
            onPressed: () {
              context.read<EstablishmentsProvider>().applyFilters();
              Navigator.of(context).pop();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: _primaryOrange,
              foregroundColor: _backgroundColor,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              elevation: 0,
            ),
            child: const Text(
              'Применить',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// Helper Widgets
// =============================================================================

/// Section divider between filter groups
class _SectionDivider extends StatelessWidget {
  const _SectionDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: AppDimensions.paddingM),
      child: const Divider(
        height: 1,
        color: FilterScreen._greyStroke,
      ),
    );
  }
}

/// Filter section wrapper with title
class _FilterSection extends StatelessWidget {
  final String title;
  final Widget child;

  const _FilterSection({
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppDimensions.paddingM),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w500,
              color: Colors.black,
            ),
          ),
          const SizedBox(height: AppDimensions.spacingM),
          child,
        ],
      ),
    );
  }
}

/// Distance option tile with checkbox
class _DistanceOptionTile extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _DistanceOptionTile({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppDimensions.paddingS),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 15,
                color: Colors.black,
              ),
            ),
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: isSelected ? Colors.black : FilterScreen._backgroundColor,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(
                  color: isSelected ? Colors.black : FilterScreen._greyStroke,
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
}

/// Price range card
class _PriceCard extends StatelessWidget {
  final String symbol;
  final String description;
  final bool isSelected;
  final VoidCallback onTap;

  const _PriceCard({
    required this.symbol,
    required this.description,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 107,
        height: 107,
        decoration: BoxDecoration(
          color: FilterScreen._backgroundColor,
          borderRadius: BorderRadius.circular(6),
          border: isSelected
              ? Border.all(color: FilterScreen._selectedOrange, width: 2)
              : null,
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFD35620).withValues(alpha: 0.08),
              blurRadius: 9,
              offset: const Offset(2, 2),
            ),
            BoxShadow(
              color: const Color(0xFFD35620).withValues(alpha: 0.01),
              blurRadius: 9,
              offset: const Offset(-2, -2),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              symbol,
              style: TextStyle(
                fontSize: 45,
                fontWeight: FontWeight.w400,
                color: isSelected
                    ? FilterScreen._selectedOrange
                    : const Color(0xFFD24F16),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              description,
              style: const TextStyle(
                fontSize: 9,
                color: Colors.black,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Hours filter button
class _HoursButton extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _HoursButton({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 45,
        decoration: BoxDecoration(
          color: isSelected ? FilterScreen._selectedOrange : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          border: isSelected
              ? null
              : Border.all(color: FilterScreen._greyStroke, width: 1.3),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 15,
            color: isSelected
                ? FilterScreen._backgroundColor
                : FilterScreen._greyText,
          ),
        ),
      ),
    );
  }
}

/// "Все" toggle row with switch
class _AllToggleRow extends StatelessWidget {
  final bool isAllSelected;
  final ValueChanged<bool> onToggle;

  const _AllToggleRow({
    required this.isAllSelected,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.paddingM,
        vertical: AppDimensions.paddingS,
      ),
      decoration: BoxDecoration(
        color: FilterScreen._backgroundColor,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: FilterScreen._greyStroke),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            'Все',
            style: TextStyle(
              fontSize: 15,
              color: Colors.black,
            ),
          ),
          Switch(
            value: isAllSelected,
            onChanged: onToggle,
            activeTrackColor: FilterScreen._primaryOrange,
            activeThumbColor: Colors.white,
          ),
        ],
      ),
    );
  }
}

/// Category/Cuisine grid with cards
/// Uses outline selection style per coordinator request
class _CategoryGrid extends StatelessWidget {
  final List<String> items;
  final Set<String> selectedItems;
  final ValueChanged<String> onToggle;

  const _CategoryGrid({
    required this.items,
    required this.selectedItems,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: items.map((item) {
        final isSelected = selectedItems.contains(item);
        return _CategoryCard(
          label: item,
          isSelected: isSelected,
          onTap: () => onToggle(item),
        );
      }).toList(),
    );
  }
}

/// Individual category card with outline selection
class _CategoryCard extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _CategoryCard({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 107,
        height: 107,
        decoration: BoxDecoration(
          color: FilterScreen._backgroundColor,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: isSelected
                ? FilterScreen._selectedOrange
                : FilterScreen._greyStroke,
            width: isSelected ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFD35620).withValues(alpha: 0.08),
              blurRadius: 9,
              offset: const Offset(2, 2),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Placeholder icon - can be replaced with actual icons
            Icon(
              _getCategoryIcon(label),
              size: 40,
              color: isSelected
                  ? FilterScreen._selectedOrange
                  : const Color(0xFFD24F16),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                color: isSelected ? FilterScreen._selectedOrange : Colors.black,
              ),
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  /// Get icon for category/cuisine
  IconData _getCategoryIcon(String label) {
    switch (label) {
      // Categories
      case 'Ресторан':
        return Icons.restaurant;
      case 'Кофейня':
        return Icons.coffee;
      case 'Фаст-фуд':
        return Icons.fastfood;
      case 'Пиццерия':
        return Icons.local_pizza;
      case 'Бар':
        return Icons.local_bar;
      case 'Паб':
        return Icons.sports_bar;
      case 'Кондитерская':
        return Icons.cake;
      case 'Пекарня':
        return Icons.bakery_dining;
      case 'Караоке':
        return Icons.mic;
      case 'Столовая':
        return Icons.lunch_dining;
      case 'Кальянная':
        return Icons.smoking_rooms;
      case 'Боулинг':
        return Icons.sports_baseball;
      case 'Бильярд':
        return Icons.sports;
      // Cuisines
      case 'Народная':
        return Icons.home;
      case 'Американская':
        return Icons.flag;
      case 'Азиатская':
        return Icons.ramen_dining;
      case 'Вегетарианская':
        return Icons.eco;
      case 'Итальянская':
        return Icons.local_pizza;
      case 'Смешанная':
        return Icons.restaurant_menu;
      case 'Грузинская':
        return Icons.kebab_dining;
      case 'Европейская':
        return Icons.dinner_dining;
      case 'Японская':
        return Icons.set_meal;
      case 'Авторская':
        return Icons.auto_awesome;
      default:
        return Icons.restaurant;
    }
  }
}

/// Amenity checkbox tile
class _AmenityTile extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _AmenityTile({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppDimensions.paddingS),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 15,
                color: Colors.black,
              ),
            ),
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: isSelected ? Colors.black : FilterScreen._backgroundColor,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(
                  color: isSelected ? Colors.black : FilterScreen._greyStroke,
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
}
