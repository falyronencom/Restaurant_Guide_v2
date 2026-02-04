import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';

/// Search home screen - main entry point for searching establishments
/// Implements Figma design with background image, city selector, and search
class SearchHomeScreen extends StatefulWidget {
  const SearchHomeScreen({super.key});

  @override
  State<SearchHomeScreen> createState() => _SearchHomeScreenState();
}

class _SearchHomeScreenState extends State<SearchHomeScreen> {
  final TextEditingController _searchController = TextEditingController();

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFFD5F1B);
  static const Color _greyText = Color(0xFFABABAB);
  static const Color _greyStroke = Color(0xFFD2D2D2);

  // Figma colors for City Selector
  static const Color _secondaryOrange = Color(0xFFEC723D);
  static const Color _darkOrange = Color(0xFFDB4F13);

  // Belarus cities with regions (Figma design)
  static const List<Map<String, String>> _citiesWithRegions = [
    {'city': 'Минск', 'region': 'Минская область'},
    {'city': 'Гродно', 'region': 'Гродненская область'},
    {'city': 'Брест', 'region': 'Брестская область'},
    {'city': 'Гомель', 'region': 'Гомельская область'},
    {'city': 'Витебск', 'region': 'Витебская область'},
    {'city': 'Могилёв', 'region': 'Могилёвская область'},
    {'city': 'Бобруйск', 'region': 'Могилёвская область'},
  ];

  @override
  void initState() {
    super.initState();
    // Initialize search query from provider if exists
    final provider = context.read<EstablishmentsProvider>();
    _searchController.text = provider.searchQuery ?? '';

    // Set default city if not set (deferred to avoid calling during build)
    // Also request user location for distance-based features
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (provider.selectedCity == null) {
        provider.setCity('Минск');
      }
      // Request GPS location (shows permission dialog on first launch)
      provider.fetchUserLocation();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// Show city selection bottom sheet (Figma design)
  void _showCityPicker() {
    String? tempSelectedCity;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) {
          final provider = context.read<EstablishmentsProvider>();
          tempSelectedCity ??= provider.selectedCity;

          return SizedBox(
            height: MediaQuery.of(context).size.height * 0.85,
            child: Column(
              children: [
                // Header (Figma: Фильтр/Header)
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    border: Border(
                      bottom: BorderSide(color: _greyStroke, width: 0.5),
                    ),
                  ),
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      // Back button (left)
                      Positioned(
                        left: 16,
                        child: GestureDetector(
                          onTap: () => Navigator.of(context).pop(),
                          child: const Icon(
                            Icons.chevron_left,
                            size: 25,
                            color: Colors.black,
                          ),
                        ),
                      ),
                      // Title (center)
                      const Text(
                        'Местоположение',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: Colors.black,
                        ),
                      ),
                      // Reset button (right)
                      Positioned(
                        right: 16,
                        child: GestureDetector(
                          onTap: () {
                            setModalState(() {
                              tempSelectedCity = 'Минск';
                            });
                          },
                          child: const Text(
                            'Сброс',
                            style: TextStyle(
                              fontSize: 15,
                              color: Colors.black,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                // Section title
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 24, 16, 16),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Ваш город',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                        color: Colors.black,
                      ),
                    ),
                  ),
                ),

                // City list
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    itemCount: _citiesWithRegions.length,
                    itemBuilder: (context, index) {
                      final cityData = _citiesWithRegions[index];
                      final city = cityData['city']!;
                      final region = cityData['region']!;
                      final isSelected = tempSelectedCity == city;

                      return _buildCityOption(
                        city: city,
                        region: region,
                        isSelected: isSelected,
                        onTap: () {
                          setModalState(() {
                            tempSelectedCity = city;
                          });
                        },
                      );
                    },
                  ),
                ),

                // Bottom gradient and Apply button
                Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.white.withValues(alpha: 0),
                        _secondaryOrange.withValues(alpha: 0.1),
                      ],
                    ),
                  ),
                  padding: EdgeInsets.fromLTRB(
                    16,
                    24,
                    16,
                    MediaQuery.of(context).padding.bottom + 24,
                  ),
                  child: SizedBox(
                    width: 136,
                    height: 47,
                    child: ElevatedButton(
                      onPressed: () {
                        if (tempSelectedCity != null) {
                          provider.setCity(tempSelectedCity!);
                        }
                        Navigator.of(context).pop();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _darkOrange,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        elevation: 0,
                      ),
                      child: const Text(
                        'Применить',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /// Build city option tile (Figma design)
  Widget _buildCityOption({
    required String city,
    required String region,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 12,
        ),
        child: Row(
          children: [
            // City name and region
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    city,
                    style: const TextStyle(
                      fontSize: 15,
                      color: Colors.black,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    region,
                    style: const TextStyle(
                      fontSize: 13,
                      color: _greyText,
                    ),
                  ),
                ],
              ),
            ),
            // Checkbox (Figma style - orange when selected)
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: isSelected ? _secondaryOrange : Colors.white,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(
                  color: isSelected ? _secondaryOrange : _greyStroke,
                  width: 1,
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

  /// Navigate to filter screen
  void _openFilters() {
    // Use rootNavigator to navigate outside tab navigator
    Navigator.of(context, rootNavigator: true).pushNamed('/filter');
  }

  /// Execute search and navigate to results
  void _executeSearch() {
    final provider = context.read<EstablishmentsProvider>();
    provider.setSearchQuery(_searchController.text);

    // Clear previous results and search
    provider.searchEstablishments();

    // Navigate to results using rootNavigator to navigate outside tab navigator
    Navigator.of(context, rootNavigator: true).pushNamed('/search/results');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Consumer<EstablishmentsProvider>(
        builder: (context, provider, child) => Stack(
          fit: StackFit.expand,
          children: [
            // Background image with dark overlay
            _buildBackground(),

            // Content
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppDimensions.paddingM,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 120),

                    // Logo
                    _buildLogo(),
                    const SizedBox(height: 16),

                    // Tagline
                    _buildTagline(),
                    const SizedBox(height: 80),

                    // City and Filter buttons row
                    _buildCityFilterRow(provider),
                    const SizedBox(height: 16),

                    // Search bar with button
                    _buildSearchBar(provider),

                    const Spacer(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Build background with image and dark overlay
  Widget _buildBackground() {
    return Stack(
      fit: StackFit.expand,
      children: [
        // Background image
        Image.asset(
          'assets/images/search_background.jpg',
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) {
            // Fallback to gradient if image not found
            return Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0xFF2C1810),
                    Color(0xFF1A0F0A),
                  ],
                ),
              ),
            );
          },
        ),
        // Dark overlay
        Container(
          color: Colors.black.withValues(alpha: 0.6),
        ),
        // Bottom gradient for better readability
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          height: 150,
          child: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  const Color(0xFFC8714B).withValues(alpha: 0.15),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Build logo text
  Widget _buildLogo() {
    return const Text(
      'NYAMA',
      style: TextStyle(
        fontSize: 48,
        fontWeight: FontWeight.w400,
        color: Colors.white,
        letterSpacing: 2,
      ),
    );
  }

  /// Build tagline text
  Widget _buildTagline() {
    return const Text(
      'Мы скажем, куда сходить',
      style: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w400,
        color: Colors.white,
      ),
    );
  }

  /// Build city selector and filter button row
  Widget _buildCityFilterRow(EstablishmentsProvider provider) {
    return Row(
      children: [
        // City button
        GestureDetector(
          onTap: _showCityPicker,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.transparent,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _backgroundColor, width: 1),
            ),
            child: Text(
              provider.selectedCity ?? 'Минск',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: _backgroundColor,
              ),
            ),
          ),
        ),
        const SizedBox(width: 25),
        // Filter button with badge
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _openFilters,
          child: Stack(
            children: [
              Container(
                width: 53,
                height: 43,
                decoration: BoxDecoration(
                  color: Colors.transparent,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: _backgroundColor, width: 1),
                ),
                child: const Icon(
                  Icons.tune,
                  color: _backgroundColor,
                  size: 20,
                ),
              ),
              // Badge for active filters
              if (provider.activeFilterCount > 0)
                Positioned(
                  top: -4,
                  right: -4,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: _primaryOrange,
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
    );
  }

  /// Build search bar with search button
  Widget _buildSearchBar(EstablishmentsProvider provider) {
    return Row(
      children: [
        // Search input field
        Expanded(
          child: Container(
            height: 64,
            decoration: BoxDecoration(
              color: const Color(0xFFF5F5F5),
              borderRadius: BorderRadius.circular(9),
            ),
            child: TextField(
              controller: _searchController,
              style: const TextStyle(
                fontSize: 18,
                color: Colors.black,
              ),
              decoration: const InputDecoration(
                hintText: 'С чего начнем?',
                hintStyle: TextStyle(
                  fontSize: 18,
                  color: _greyText,
                  fontWeight: FontWeight.w400,
                ),
                border: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 20,
                ),
              ),
              onSubmitted: (_) => _executeSearch(),
            ),
          ),
        ),
        // Search button
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _executeSearch,
          child: Container(
            width: 64,
            height: 64,
            margin: const EdgeInsets.only(left: 0),
            decoration: BoxDecoration(
              color: _primaryOrange,
              borderRadius: BorderRadius.circular(9),
            ),
            child: const Center(
              child: Icon(
                Icons.chevron_right,
                color: Colors.white,
                size: 30,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
