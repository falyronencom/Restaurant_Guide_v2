import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_bar.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_suggestions.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_preview.dart';

/// Search home screen - main entry point for searching establishments
/// Implements Figma design with background image, city selector, and search
class SearchHomeScreen extends StatefulWidget {
  const SearchHomeScreen({super.key});

  @override
  State<SearchHomeScreen> createState() => _SearchHomeScreenState();
}

class _SearchHomeScreenState extends State<SearchHomeScreen> {
  final TextEditingController _searchController = TextEditingController();
  bool _isSearchFocused = false;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _greyText = AppTheme.textGrey;
  static const Color _greyStroke = AppTheme.strokeGrey;

  // Figma colors for City Selector
  static const Color _secondaryOrange = AppTheme.primaryOrangeLight;
  static const Color _darkOrange = AppTheme.primaryOrangeDark;

  @override
  void initState() {
    super.initState();
    final provider = context.read<EstablishmentsProvider>();
    _searchController.text = provider.searchQuery ?? '';

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      // 1. Load persisted city or set default
      if (provider.selectedCity == null) {
        final hasSaved = await provider.loadPersistedCity();
        if (!hasSaved) {
          provider.setCity(BelarusCities.defaultCity);
        }
      }

      // 2. Request GPS location
      if (!mounted) return;
      final gpsGranted = await provider.fetchUserLocation();

      // 3. If GPS denied and no city was persisted, show city picker
      if (!gpsGranted && mounted) {
        final hadSavedCity = await provider.loadPersistedCity();
        if (!hadSavedCity) {
          _showCityPicker();
        }
      }
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
      backgroundColor: AppTheme.backgroundPrimary,
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
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  decoration: const BoxDecoration(
                    color: AppTheme.backgroundPrimary,
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
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ),
                      // Title (center)
                      Text(
                        'Местоположение',
                        style: GoogleFonts.nunitoSans(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary,
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
                              color: AppTheme.textPrimary,
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
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ),
                ),

                // City list
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    itemCount: BelarusCities.citiesWithRegions.length,
                    itemBuilder: (context, index) {
                      final cityData = BelarusCities.citiesWithRegions[index];
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

                // Apply button
                Container(
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
                        foregroundColor: AppTheme.textOnPrimary,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
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
                      color: AppTheme.textPrimary,
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
                color: isSelected ? _secondaryOrange : AppTheme.backgroundPrimary,
                borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                border: Border.all(
                  color: isSelected ? _secondaryOrange : _greyStroke,
                  width: 1,
                ),
              ),
              child: isSelected
                  ? const Icon(
                      Icons.check,
                      size: 16,
                      color: AppTheme.textOnPrimary,
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

  /// Execute search and navigate to results (existing flow — chevron without text)
  void _executeSearch() {
    final provider = context.read<EstablishmentsProvider>();
    provider.setSearchQuery(_searchController.text);

    // Clear previous results and search
    provider.searchEstablishments();

    // Navigate to results using rootNavigator to navigate outside tab navigator
    Navigator.of(context, rootNavigator: true).pushNamed('/search/results');
  }

  /// Execute smart search (AI intent parsing path)
  void _executeSmartSearch() {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;

    final estProvider = context.read<EstablishmentsProvider>();
    final smartProvider = context.read<SmartSearchProvider>();

    smartProvider.executeSmartSearch(
      query,
      latitude: estProvider.userLatitude,
      longitude: estProvider.userLongitude,
      city: estProvider.selectedCity,
    );
  }

  /// Handle suggestion chip tap
  void _onChipTap(String text) {
    _searchController.text = text;
    setState(() => _isSearchFocused = false);
    _executeSmartSearch();
  }

  /// Navigate to establishment detail
  void _onEstablishmentTap(String id) {
    Navigator.of(context, rootNavigator: true).pushNamed(
      '/establishment/$id',
    );
  }

  /// "Show all" from preview → navigate to results with current query
  void _onShowAll() {
    final provider = context.read<EstablishmentsProvider>();
    final smartProvider = context.read<SmartSearchProvider>();
    final intent = smartProvider.parsedIntent;

    // Transfer parsed intent filters to EstablishmentsProvider
    if (intent != null && !smartProvider.isFallback) {
      if (intent.category != null) {
        provider.setSearchQuery(null);
      }
    }
    provider.setSearchQuery(_searchController.text);
    provider.searchEstablishments();
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

            // Dark overlay when search focused (BEFORE content so it doesn't block taps)
            if (_isSearchFocused)
              Positioned.fill(
                child: AnimatedOpacity(
                  opacity: _isSearchFocused ? 0.3 : 0.0,
                  duration: const Duration(milliseconds: 200),
                  child: Container(color: Colors.black),
                ),
              ),

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

                    // Smart Search bar (refactored from inline)
                    SmartSearchBar(
                      controller: _searchController,
                      onSubmit: _executeSmartSearch,
                      onChevronTap: _executeSearch,
                      onFocusChanged: (focused) {
                        setState(() => _isSearchFocused = focused);
                        if (!focused) return;
                        // Clear previous smart results when re-focusing
                        context.read<SmartSearchProvider>().clear();
                      },
                    ),
                    const SizedBox(height: 12),

                    // Suggestion chips (visible when focused, hidden when results shown)
                    SmartSearchSuggestions(
                      visible: _isSearchFocused &&
                          context.watch<SmartSearchProvider>().state !=
                              SmartSearchState.results,
                      onChipTap: _onChipTap,
                    ),

                    // Smart Search preview (results from AI)
                    SmartSearchPreview(
                      onShowAll: _onShowAll,
                      onEstablishmentTap: _onEstablishmentTap,
                    ),

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
    return Text(
      'NIRIVIO',
      style: GoogleFonts.josefinSans(
        fontSize: 48,
        fontWeight: FontWeight.w600,
        color: AppTheme.textOnPrimary,
        letterSpacing: 48 * 0.3,
      ),
    );
  }

  /// Build tagline text
  Widget _buildTagline() {
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: Text(
        'Вкусное рядом',
        style: GoogleFonts.josefinSans(
          fontSize: 16,
          fontWeight: FontWeight.w200,
          color: Colors.white.withValues(alpha: 0.85),
          letterSpacing: 16 * 0.3,
        ),
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
              borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
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
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
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
                        color: AppTheme.textOnPrimary,
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
}