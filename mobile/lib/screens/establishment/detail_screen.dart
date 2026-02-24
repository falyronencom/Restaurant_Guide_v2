import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';
import 'package:restaurant_guide_mobile/services/location_service.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/screens/reviews/write_review_screen.dart';
import 'package:restaurant_guide_mobile/screens/reviews/reviews_list_screen.dart';
import 'package:restaurant_guide_mobile/screens/map/map_screen.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';

/// Establishment detail screen displaying full information
/// Figma design: Hero image with overlay, menu carousel, attributes, map, reviews
class EstablishmentDetailScreen extends StatefulWidget {
  final String establishmentId;

  const EstablishmentDetailScreen({
    super.key,
    required this.establishmentId,
  });

  @override
  State<EstablishmentDetailScreen> createState() =>
      _EstablishmentDetailScreenState();
}

class _EstablishmentDetailScreenState extends State<EstablishmentDetailScreen> {
  // Services
  final EstablishmentsService _establishmentsService = EstablishmentsService();
  final ReviewsService _reviewsService = ReviewsService();

  // State
  Establishment? _establishment;
  List<Review> _reviews = [];
  int _totalReviews = 0;
  bool _isLoading = true;
  String? _error;

  // Gallery state
  int _currentPhotoIndex = 0;
  final PageController _galleryController = PageController();

  // Description collapsed by default
  bool _isDescriptionExpanded = false;

  // Mini-map marker generator (shared singleton)
  final MapMarkerGenerator _markerGenerator = MapMarkerGenerator();

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _secondaryOrange = AppTheme.primaryOrange;
  static const Color _greenStatus = AppTheme.statusGreen;
  static const Color _navyBlue = AppTheme.accentNavy;
  static const Color _greyText = AppTheme.textGrey;

  @override
  void initState() {
    super.initState();
    _loadData();
    _initMarkers();
    // Request user location for distance calculation
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        context.read<EstablishmentsProvider>().fetchUserLocation();
      } catch (e) {
        // Silently handle - location is optional feature
      }
    });
  }

  @override
  void dispose() {
    _galleryController.dispose();
    super.dispose();
  }

  /// Load establishment and reviews data
  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // Fetch establishment details
      final establishment = await _establishmentsService.getEstablishmentById(
        widget.establishmentId,
      );

      // Fetch reviews
      final reviewsResponse = await _reviewsService.getReviewsForEstablishment(
        widget.establishmentId,
        perPage: 5,
      );

      setState(() {
        _establishment = establishment;
        _reviews = reviewsResponse.data;
        _totalReviews = reviewsResponse.meta.total;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Не удалось загрузить данные';
        _isLoading = false;
      });
    }
  }

  /// Toggle favorite status
  void _toggleFavorite() {
    final authProvider = context.read<AuthProvider>();

    if (!authProvider.isAuthenticated) {
      _showLoginPrompt();
      return;
    }

    final provider = context.read<EstablishmentsProvider>();
    provider.toggleFavorite(widget.establishmentId);
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

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return _buildLoadingState();
    }

    if (_error != null || _establishment == null) {
      return _buildErrorState();
    }

    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Hero section with photo and overlay info
            _buildHeroSection(),

            // Description section (shown when present)
            _buildDescriptionSection(),

            // Menu section
            _buildMenuSection(),

            // Divider
            _buildDivider(),

            // Attributes section
            _buildAttributesSection(),

            // Divider
            _buildDivider(),

            // Map section
            _buildMapSection(),

            // Reviews section (dark background)
            _buildReviewsSection(),

            // Bottom padding
            const SizedBox(height: 34),
          ],
        ),
      ),
    );
  }

  /// Build loading state
  Widget _buildLoadingState() {
    return const Scaffold(
      backgroundColor: _backgroundColor,
      body: Center(
        child: CircularProgressIndicator(color: _primaryOrange),
      ),
    );
  }

  /// Build error state
  Widget _buildErrorState() {
    return Scaffold(
      backgroundColor: _backgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: _buildBackButton(dark: true),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: AppDimensions.spacingM),
            const Text(
              'Ошибка загрузки',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: AppDimensions.spacingS),
            Text(
              _error ?? 'Неизвестная ошибка',
              style: const TextStyle(color: _greyText),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppDimensions.spacingL),
            ElevatedButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh),
              label: const Text('Повторить'),
              style: ElevatedButton.styleFrom(
                backgroundColor: _primaryOrange,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Build hero section with photo and overlay info
  Widget _buildHeroSection() {
    // Filter only establishment photos (not menu)
    final photos = (_establishment!.media ?? [])
        .where((m) => m.type == 'photo' || m.type == 'interior')
        .toList();

    // Use thumbnailUrl (primary_image_url) as fallback if no media
    final hasPrimaryImage = _establishment!.thumbnailUrl != null;
    final hasPhotos = photos.isNotEmpty || hasPrimaryImage;

    return SizedBox(
      height: 657,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Photo gallery
          hasPhotos
              ? (photos.isNotEmpty
                  ? _buildPhotoGallery(photos)
                  : _buildPrimaryImageFallback())
              : _buildNoPhotoPlaceholder(),

          // Gradient overlay at bottom
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            height: 333,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.6),
                  ],
                ),
              ),
            ),
          ),

          // Page indicator dots (only if multiple photos in media array)
          if (photos.length > 1)
            Positioned(
              top: 640,
              left: 0,
              right: 0,
              child: _buildPageIndicator(photos.length),
            ),

          // Back button
          Positioned(
            top: MediaQuery.of(context).padding.top + 36,
            left: 0,
            child: _buildBackButton(),
          ),

          // Share button — centered with rating badge & favorite (center at 49px from right)
          Positioned(
            top: MediaQuery.of(context).padding.top + 4,
            right: 35,
            child: _buildShareButton(),
          ),

          // Info overlay
          Positioned(
            bottom: 60,
            left: 17,
            right: 17,
            child: _buildInfoOverlay(),
          ),

          // Rating badge
          Positioned(
            top: 500,
            right: 24,
            child: _buildRatingBadge(),
          ),

          // Favorite button (below rating badge)
          Positioned(
            top: 585,
            right: 34,
            child: _buildFavoriteButton(),
          ),
        ],
      ),
    );
  }

  /// Build photo gallery PageView
  Widget _buildPhotoGallery(List<EstablishmentMedia> photos) {
    return PageView.builder(
      controller: _galleryController,
      itemCount: photos.length,
      onPageChanged: (index) {
        setState(() => _currentPhotoIndex = index);
      },
      itemBuilder: (context, index) {
        final photo = photos[index];
        final imageUrl = photo.url ?? photo.previewUrl ?? photo.thumbnailUrl;

        if (imageUrl == null) {
          return _buildNoPhotoPlaceholder();
        }

        return GestureDetector(
          onTap: () => _openFullscreenGallery(index),
          child: CachedNetworkImage(
            imageUrl: imageUrl,
            fit: BoxFit.cover,
            placeholder: (context, url) => Container(
              color: Colors.grey[300],
              child: const Center(
                child: CircularProgressIndicator(color: _primaryOrange),
              ),
            ),
            errorWidget: (context, url, error) => Container(
              color: Colors.grey[300],
              child: const Icon(Icons.error, size: 48),
            ),
          ),
        );
      },
    );
  }

  /// Build no photo placeholder
  Widget _buildNoPhotoPlaceholder() {
    return Container(
      color: Colors.grey[300],
      child: const Center(
        child: Icon(
          Icons.restaurant,
          size: 64,
          color: Colors.grey,
        ),
      ),
    );
  }

  /// Build primary image fallback when no media array but has thumbnailUrl
  Widget _buildPrimaryImageFallback() {
    return CachedNetworkImage(
      imageUrl: _establishment!.thumbnailUrl!,
      fit: BoxFit.cover,
      placeholder: (context, url) => Container(
        color: Colors.grey[300],
        child: const Center(
          child: CircularProgressIndicator(color: _primaryOrange),
        ),
      ),
      errorWidget: (context, url, error) => Container(
        color: Colors.grey[300],
        child: const Icon(Icons.error, size: 48),
      ),
    );
  }

  /// Build page indicator dots
  Widget _buildPageIndicator(int count) {
    final displayCount = count > 5 ? 5 : count;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(displayCount, (index) {
        return Container(
          width: index == _currentPhotoIndex % displayCount ? 12 : 6,
          height: 6,
          margin: const EdgeInsets.symmetric(horizontal: 2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(3),
            color: index == _currentPhotoIndex % displayCount
                ? AppTheme.backgroundPrimary
                : Colors.white.withValues(alpha: 0.5),
          ),
        );
      }),
    );
  }

  /// Build back button (Figma style)
  Widget _buildBackButton({bool dark = false}) {
    return GestureDetector(
      onTap: () => Navigator.of(context).pop(),
      child: Container(
        width: 55,
        height: 42,
        decoration: const BoxDecoration(
          color: AppTheme.textPrimary,
          borderRadius: BorderRadius.only(
            topRight: Radius.circular(8),
            bottomRight: Radius.circular(8),
          ),
        ),
        child: const Center(
          child: Icon(
            Icons.chevron_left,
            color: AppTheme.textOnPrimary,
            size: 28,
          ),
        ),
      ),
    );
  }

  /// Build share button (Figma style - no padding)
  Widget _buildShareButton() {
    return GestureDetector(
      onTap: () {
        // TODO: Implement share functionality
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Поделиться')),
        );
      },
      child: const Icon(
        Icons.ios_share,
        color: _backgroundColor,
        size: 28,
      ),
    );
  }

  /// Build favorite button
  Widget _buildFavoriteButton() {
    return Consumer<EstablishmentsProvider>(
      builder: (context, provider, child) {
        final isFavorite = provider.isFavorite(widget.establishmentId);

        return GestureDetector(
          onTap: _toggleFavorite,
          child: Icon(
            isFavorite ? Icons.favorite : Icons.favorite_border,
            color: isFavorite ? _primaryOrange : _backgroundColor,
            size: 30,
          ),
        );
      },
    );
  }

  /// Build info overlay on hero image
  Widget _buildInfoOverlay() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Name
        Text(
          _establishment!.name,
          style: TextStyle(
            fontFamily: AppTheme.fontDisplayFamily,
            fontSize: 50,
            fontWeight: FontWeight.w400,
            color: _backgroundColor,
          ),
        ),

        // Category
        Text(
          _establishment!.category.toLowerCase(),
          style: const TextStyle(
            fontSize: 20,
            color: _backgroundColor,
          ),
        ),

        // Cuisine
        if (_establishment!.cuisine != null)
          Opacity(
            opacity: 0.7,
            child: Text(
              '{${_establishment!.cuisine!.toLowerCase()}}',
              style: const TextStyle(
                fontSize: 18,
                color: _backgroundColor,
              ),
            ),
          ),

        const SizedBox(height: 16),

        // Status (Open/Closed)
        _buildStatusLine(),

        const SizedBox(height: 8),

        // Address
        GestureDetector(
          onTap: () {
            // TODO: Open in maps
          },
          child: Text(
            _establishment!.address,
            style: const TextStyle(
              fontSize: 16,
              color: _backgroundColor,
              decoration: TextDecoration.underline,
            ),
          ),
        ),

        const SizedBox(height: 8),

        // Phone
        if (_establishment!.attributes != null &&
            _establishment!.attributes!['phone'] != null)
          GestureDetector(
            onTap: () {
              // TODO: Call phone
            },
            child: Text(
              _establishment!.attributes!['phone'].toString(),
              style: const TextStyle(
                fontSize: 16,
                color: _backgroundColor,
              ),
            ),
          ),

        // Instagram
        if (_establishment!.attributes != null &&
            _establishment!.attributes!['instagram'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              '@${_establishment!.attributes!['instagram']}',
              style: const TextStyle(
                fontSize: 16,
                color: _backgroundColor,
              ),
            ),
          ),
      ],
    );
  }

  /// Build status line (Open/Closed with time)
  Widget _buildStatusLine() {
    final isOpen = _establishment!.isCurrentlyOpen;
    final closingTime = _establishment!.todayClosingTime;

    return RichText(
      text: TextSpan(
        style: const TextStyle(fontSize: 18),
        children: [
          TextSpan(
            text: isOpen ? 'Открыто' : 'Закрыто',
            style: TextStyle(
              color: isOpen ? _greenStatus : Colors.red,
              fontWeight: FontWeight.w500,
            ),
          ),
          if (closingTime != null && isOpen)
            TextSpan(
              text: '/до $closingTime',
              style: const TextStyle(color: _backgroundColor),
            ),
        ],
      ),
    );
  }

  /// Build rating badge (green square) - Figma: 50x50 with 12px radius
  Widget _buildRatingBadge() {
    return Column(
      children: [
        // Rating
        Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: _greenStatus,
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          child: Center(
            child: Text(
              _establishment!.rating?.toStringAsFixed(1) ?? '—',
              style: const TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w400,
                color: _backgroundColor,
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Price
        Text(
          _getPriceSymbol(_establishment!.priceRange ?? ''),
          style: const TextStyle(
            fontSize: 20,
            color: _backgroundColor,
          ),
        ),
      ],
    );
  }

  /// Get price symbol
  String _getPriceSymbol(String priceRange) {
    switch (priceRange.toLowerCase()) {
      case 'budget':
      case 'low':
        return '\$';
      case 'moderate':
      case 'medium':
        return '\$\$';
      case 'expensive':
      case 'high':
        return '\$\$\$';
      default:
        return '\$\$';
    }
  }

  /// Get distance text for display
  String? _getDistanceText() {
    if (_establishment == null) {
      return null;
    }

    // Try backend-provided distance first
    if (_establishment!.distance != null) {
      return _formatDistance(_establishment!.distance!);
    }

    // Fallback: calculate client-side if we have user location
    final provider = context.read<EstablishmentsProvider>();

    if (provider.hasRealLocation &&
        _establishment!.latitude != null &&
        _establishment!.longitude != null) {
      final distance = LocationService().calculateDistance(
        provider.userLatitude!,
        provider.userLongitude!,
        _establishment!.latitude!,
        _establishment!.longitude!,
      );
      return _formatDistance(distance);
    }

    return null; // Hide if no location available
  }

  /// Format distance for display
  String _formatDistance(double km) {
    if (km < 1) {
      return '${(km * 1000).round()} м от вас';
    }
    return '${km.toStringAsFixed(1)} км от вас';
  }

  /// Build menu section
  Widget _buildMenuSection() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title
          Text(
            'Меню',
            style: TextStyle(
              fontFamily: AppTheme.fontDisplayFamily,
              fontSize: 30,
              fontWeight: FontWeight.w400,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 19),

          // Working hours
          _buildWorkingHours(),

          const SizedBox(height: 30),

          // Menu photo carousel
          if (_establishment!.media != null &&
              _establishment!.media!.length > 1)
            _buildMenuCarousel(),
        ],
      ),
    );
  }

  /// Build working hours from real data with day grouping
  Widget _buildWorkingHours() {
    final workingHours = _establishment!.workingHours;

    if (workingHours == null) {
      return const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _WorkingHoursRow(label: 'График не указан', time: ''),
        ],
      );
    }

    const dayKeys = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday'
    ];
    const shortDayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    final todayIndex = DateTime.now().weekday - 1;

    // Parse each day's hours
    final dayEntries = <Map<String, dynamic>>[];
    for (int i = 0; i < 7; i++) {
      final parsed = Establishment.parseDayHours(workingHours[dayKeys[i]]);
      dayEntries.add({
        'dayName': shortDayNames[i],
        'hours': parsed,
        'isToday': i == todayIndex,
      });
    }

    // Group consecutive days with identical hours
    final groups = <Map<String, dynamic>>[];
    int i = 0;
    while (i < dayEntries.length) {
      final currentTime = _formatDayHours(dayEntries[i]['hours']);
      int j = i + 1;
      bool groupContainsToday = dayEntries[i]['isToday'] as bool;

      while (j < dayEntries.length) {
        if (_formatDayHours(dayEntries[j]['hours']) == currentTime) {
          if (dayEntries[j]['isToday'] as bool) groupContainsToday = true;
          j++;
        } else {
          break;
        }
      }

      final startDay = dayEntries[i]['dayName'] as String;
      final endDay = dayEntries[j - 1]['dayName'] as String;
      final label = i == j - 1 ? '$startDay:' : '$startDay-$endDay:';

      groups.add({
        'label': label,
        'time': currentTime,
        'isToday': groupContainsToday,
      });

      i = j;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: groups
          .map((g) => _WorkingHoursRow(
                label: g['label'] as String,
                time: g['time'] as String,
                isHighlighted: g['isToday'] as bool,
              ))
          .toList(),
    );
  }

  /// Format parsed day hours into display string
  String _formatDayHours(Map<String, dynamic>? hours) {
    if (hours == null) return 'Выходной';
    if (hours['is_open'] == false) return 'Выходной';
    final open = hours['open'] as String?;
    final close = hours['close'] as String?;
    if (open == null || close == null) return 'Выходной';
    return '$open - $close';
  }

  /// Build menu carousel
  Widget _buildMenuCarousel() {
    // Filter only menu photos
    final menuPhotos =
        _establishment!.media!.where((m) => m.type == 'menu').toList();

    if (menuPhotos.isEmpty) {
      return const SizedBox.shrink();
    }

    return SizedBox(
      height: 275,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: menuPhotos.length > 4 ? 4 : menuPhotos.length,
        itemBuilder: (context, index) {
          final photo = menuPhotos[index];
          final imageUrl = photo.previewUrl ?? photo.url ?? photo.thumbnailUrl;
          final maxIndex = (menuPhotos.length > 4 ? 4 : menuPhotos.length) - 1;

          return GestureDetector(
            onTap: () => _openMenuGallery(index),
            child: Container(
              width: 165,
              margin: EdgeInsets.only(right: index < maxIndex ? 10 : 0),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.only(
                  topLeft: index == 0
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                  topRight: const Radius.circular(10),
                  bottomLeft: const Radius.circular(10),
                  bottomRight: index == maxIndex
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(4, 4),
                  ),
                  BoxShadow(
                    color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(-4, -4),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.only(
                  topLeft: index == 0
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                  topRight: const Radius.circular(10),
                  bottomLeft: const Radius.circular(10),
                  bottomRight: index == maxIndex
                      ? const Radius.circular(30)
                      : const Radius.circular(10),
                ),
                child: imageUrl != null
                    ? CachedNetworkImage(
                        imageUrl: imageUrl,
                        fit: BoxFit.cover,
                        placeholder: (context, url) => Container(
                          color: Colors.grey[200],
                        ),
                        errorWidget: (context, url, error) => Container(
                          color: Colors.grey[200],
                          child: const Icon(Icons.error),
                        ),
                      )
                    : Container(color: Colors.grey[200]),
              ),
            ),
          );
        },
      ),
    );
  }

  /// Build collapsible description section
  Widget _buildDescriptionSection() {
    final description = _establishment?.description;
    if (description == null || description.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Tappable header
          GestureDetector(
            onTap: () {
              setState(() {
                _isDescriptionExpanded = !_isDescriptionExpanded;
              });
            },
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Row(
                children: [
                  Text(
                    'Описание',
                    style: TextStyle(
                      fontFamily: AppTheme.fontDisplayFamily,
                      fontSize: 30,
                      fontWeight: FontWeight.w400,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  AnimatedRotation(
                    turns: _isDescriptionExpanded ? 0.5 : 0.0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(
                      Icons.keyboard_arrow_down,
                      size: 28,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Collapsible body
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
            alignment: Alignment.topCenter,
            child: _isDescriptionExpanded
                ? Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      description,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w400,
                        color: Colors.black87,
                        height: 1.5,
                      ),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }

  Widget _buildDivider() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: const Divider(
        color: AppTheme.strokeGrey,
        height: 1,
      ),
    );
  }

  /// Build attributes section
  Widget _buildAttributesSection() {
    final attributes = _establishment!.attributes;

    // Extract available amenities
    final amenities = <Map<String, dynamic>>[];

    if (attributes != null) {
      if (attributes['delivery'] == true) {
        amenities.add({'name': 'Доставка еды', 'svg': 'Доставка еды'});
      }
      if (attributes['wifi'] == true) {
        amenities.add({'name': 'Wi-Fi', 'svg': 'Wifi'});
      }
      if (attributes['terrace'] == true) {
        amenities.add({'name': 'Терасса', 'svg': 'Терасса'});
      }
      if (attributes['parking'] == true) {
        amenities.add({'name': 'Парковка', 'svg': 'Парковка'});
      }
      if (attributes['live_music'] == true) {
        amenities.add({'name': 'Живая музыка', 'svg': 'Живая музыка'});
      }
      if (attributes['kids_zone'] == true) {
        amenities.add({'name': 'Детская зона', 'svg': 'Детская зона'});
      }
      if (attributes['banquet'] == true) {
        amenities.add({'name': 'Банкет', 'svg': 'Банкет'});
      }
      if (attributes['pets_allowed'] == true) {
        amenities.add({'name': 'Животные', 'svg': 'Животные'});
      }
      if (attributes['smoking'] == true) {
        amenities.add({'name': 'Курение', 'svg': 'Курение'});
      }
    }

    // If no amenities, show default set
    if (amenities.isEmpty) {
      amenities.addAll([
        {'name': 'Доставка еды', 'svg': 'Доставка еды'},
        {'name': 'Wi-Fi', 'svg': 'Wifi'},
        {'name': 'Терасса', 'svg': 'Терасса'},
      ]);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Атрибуты',
              style: TextStyle(
                fontFamily: AppTheme.fontDisplayFamily,
                fontSize: 30,
                fontWeight: FontWeight.w400,
                color: AppTheme.textPrimary,
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Amenities horizontal carousel
          SizedBox(
            height: 130,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: amenities.length,
              itemBuilder: (context, index) {
                final amenity = amenities[index];
                return Padding(
                  padding: EdgeInsets.only(
                    right: index < amenities.length - 1 ? 24 : 0,
                  ),
                  child: _buildAmenityItem(
                    amenity['name'] as String,
                    amenity['svg'] as String,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// Build amenity item (SVG already contains circle background + white icon)
  Widget _buildAmenityItem(String label, String svgFileName) {
    return Column(
      children: [
        // SVG is a full circle badge with icon inside
        SvgPicture.asset(
          'assets/icons/$svgFileName.svg',
          width: 80,
          height: 80,
        ),
        const SizedBox(height: 8),
        // Label
        Text(
          label,
          style: const TextStyle(
            fontSize: 15,
            color: AppTheme.textPrimary,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  /// Pre-generate marker bitmaps (reuses shared singleton cache)
  Future<void> _initMarkers() async {
    final dpr = WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    await _markerGenerator.ensureInitialized(dpr);
    if (mounted) setState(() {});
  }

  /// Build map section
  Widget _buildMapSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header with address
        Container(
          padding: const EdgeInsets.all(20),
          decoration: const BoxDecoration(
            color: _backgroundColor,
            borderRadius: BorderRadius.only(
              bottomLeft: Radius.circular(30),
              bottomRight: Radius.circular(30),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title
              Text(
                'Карта',
                style: TextStyle(
                  fontFamily: AppTheme.fontDisplayFamily,
                  fontSize: 30,
                  fontWeight: FontWeight.w400,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 14),

              // Distance (dynamic) - uses Consumer to rebuild when location updates
              Consumer<EstablishmentsProvider>(
                builder: (context, provider, _) {
                  final distanceText = _getDistanceText();
                  if (distanceText == null) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Text(
                      distanceText,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                        color: _secondaryOrange,
                      ),
                    ),
                  );
                },
              ),

              // Address
              Text(
                '${_establishment!.address},\n${_establishment!.city}',
                style: const TextStyle(
                  fontSize: 16,
                  color: AppTheme.textPrimary,
                ),
              ),
            ],
          ),
        ),

        // Mini-map with establishment marker (tap to explore)
        GestureDetector(
          onTap: _establishment!.latitude != null &&
                  _establishment!.longitude != null
              ? () => _openMapExplorer()
              : null,
          child: Container(
            height: 384,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              color: Colors.grey[300],
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(30),
                topRight: Radius.circular(30),
                bottomLeft: Radius.circular(30),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: const Offset(4, 4),
                ),
              ],
            ),
            child: _establishment!.latitude != null &&
                    _establishment!.longitude != null
                ? Stack(
                    children: [
                      ClipRRect(
                        borderRadius: const BorderRadius.only(
                          topLeft: Radius.circular(30),
                          topRight: Radius.circular(30),
                          bottomLeft: Radius.circular(30),
                        ),
                        child: AbsorbPointer(
                          // Prevent map gestures, only allow tap on container
                          child: YandexMap(
                            onMapCreated: (YandexMapController controller) {
                              controller.moveCamera(
                                CameraUpdate.newCameraPosition(
                                  CameraPosition(
                                    target: Point(
                                      latitude: _establishment!.latitude!,
                                      longitude: _establishment!.longitude!,
                                    ),
                                    zoom: 16.0,
                                  ),
                                ),
                              );
                            },
                            mapObjects: [
                              PlacemarkMapObject(
                                mapId:
                                    const MapObjectId('establishment_marker'),
                                point: Point(
                                  latitude: _establishment!.latitude!,
                                  longitude: _establishment!.longitude!,
                                ),
                                icon: _markerGenerator.getMarkerImage(
                                            isOpen: _establishment?.isCurrentlyOpen ?? true,
                                          ) !=
                                          null
                                    ? PlacemarkIcon.single(
                                        PlacemarkIconStyle(
                                          image: BitmapDescriptor.fromBytes(
                                              _markerGenerator.getMarkerImage(
                                                  isOpen: _establishment?.isCurrentlyOpen ?? true)!),
                                          scale: 1.0,
                                        ),
                                      )
                                    : PlacemarkIcon.single(
                                        PlacemarkIconStyle(
                                          image: BitmapDescriptor.fromAssetImage(
                                              'packages/yandex_mapkit/assets/place.png'),
                                          scale: 2.0,
                                        ),
                                      ),
                                opacity: 1.0,
                              ),
                            ],
                          ),
                        ),
                      ),
                      // Tap hint overlay
                      Positioned(
                        bottom: 16,
                        left: 0,
                        right: 0,
                        child: Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 8),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.6),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.touch_app,
                                    color: AppTheme.textOnPrimary, size: 16),
                                SizedBox(width: 6),
                                Text(
                                  'Нажмите для исследования',
                                  style: TextStyle(
                                    color: AppTheme.textOnPrimary,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  )
                : const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.map, size: 64, color: Colors.grey),
                        SizedBox(height: 16),
                        Text(
                          'Координаты недоступны',
                          style: TextStyle(color: Colors.grey),
                        ),
                      ],
                    ),
                  ),
          ),
        ),
      ],
    );
  }

  /// Build reviews section (dark background)
  Widget _buildReviewsSection() {
    return Container(
      color: AppTheme.textPrimary,
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text(
                  'Отзывы',
                  style: TextStyle(
                    fontFamily: AppTheme.fontDisplayFamily,
                    fontSize: 30,
                    fontWeight: FontWeight.w400,
                    color: _backgroundColor,
                  ),
                ),
                const Spacer(),
                // Reviews count with arrow
                GestureDetector(
                  onTap: () {
                    // Navigate to all reviews screen
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => ReviewsListScreen(
                          establishment: _establishment!,
                        ),
                      ),
                    );
                  },
                  child: Row(
                    children: [
                      Text(
                        '$_totalReviews отзывов',
                        style: const TextStyle(
                          fontSize: 14,
                          color: _backgroundColor,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(
                        Icons.chevron_right,
                        color: _backgroundColor,
                        size: 20,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Reviews carousel
          if (_reviews.isNotEmpty)
            _buildReviewsCarousel()
          else
            _buildNoReviewsState(),

          const SizedBox(height: 24),

          // Write review button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SizedBox(
              width: double.infinity,
              height: 44,
              child: ElevatedButton(
                onPressed: () {
                  // Check authentication before navigating to write review
                  final authProvider = context.read<AuthProvider>();
                  if (!authProvider.isAuthenticated) {
                    _showLoginPrompt();
                    return;
                  }
                  // Navigate to write review screen
                  Navigator.of(context)
                      .push(
                    MaterialPageRoute(
                      builder: (context) => WriteReviewScreen(
                        establishment: _establishment!,
                      ),
                    ),
                  )
                      .then((result) {
                    // Refresh reviews if a new review was submitted
                    if (result == true) {
                      _loadData();
                    }
                  });
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: _secondaryOrange,
                  foregroundColor: _backgroundColor,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                  ),
                  elevation: 0,
                ),
                child: const Text(
                  'Написать отзыв',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build reviews carousel
  Widget _buildReviewsCarousel() {
    return SizedBox(
      height: 220,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _reviews.length,
        itemBuilder: (context, index) {
          return GestureDetector(
            onTap: () {
              // Navigate to all reviews screen when tapping a review card
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => ReviewsListScreen(
                    establishment: _establishment!,
                  ),
                ),
              );
            },
            child: Container(
              width: 348,
              margin:
                  EdgeInsets.only(right: index < _reviews.length - 1 ? 10 : 0),
              child: _buildReviewCard(_reviews[index]),
            ),
          );
        },
      ),
    );
  }

  /// Build review card (Figma style)
  Widget _buildReviewCard(Review review) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        border: Border.all(color: _backgroundColor),
        borderRadius: BorderRadius.circular(15),
        boxShadow: [
          BoxShadow(
            color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
            blurRadius: 15,
            spreadRadius: 2,
            offset: const Offset(4, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              // Avatar
              Container(
                width: 42,
                height: 42,
                decoration: const BoxDecoration(
                  color: _navyBlue,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    review.userName.isNotEmpty
                        ? review.userName[0].toUpperCase()
                        : 'A',
                    style: TextStyle(
                      fontFamily: AppTheme.fontDisplayFamily,
                      fontSize: 25,
                      color: _backgroundColor,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              // Name
              Text(
                review.userName,
                style: const TextStyle(
                  fontSize: 16,
                  color: _backgroundColor,
                ),
              ),
              const Spacer(),
              // Stars and date
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _buildStarRating(review.rating),
                  const SizedBox(height: 4),
                  Text(
                    _formatDate(review.createdAt),
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[500],
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 11),
          // Review text
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    review.text ?? '',
                    style: const TextStyle(
                      fontSize: 12,
                      color: _backgroundColor,
                      height: 1.67,
                    ),
                    maxLines: review.partnerResponse != null ? 3 : 6,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                // Partner response indicator
                if (review.partnerResponse != null &&
                    review.partnerResponse!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: _primaryOrange.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.reply,
                          size: 12,
                          color: _primaryOrange,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            'Ответ: ${review.partnerResponse!}',
                            style: TextStyle(
                              fontSize: 10,
                              color: _backgroundColor.withValues(alpha: 0.8),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Build star rating
  Widget _buildStarRating(int rating) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        return Icon(
          index < rating ? Icons.star : Icons.star_border,
          color: index < rating ? _primaryOrange : Colors.grey,
          size: 15,
        );
      }),
    );
  }

  /// Build no reviews state
  Widget _buildNoReviewsState() {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 16),
      child: Text(
        'Пока нет отзывов. Станьте первым!',
        style: TextStyle(
          fontSize: 14,
          color: _backgroundColor,
        ),
      ),
    );
  }

  /// Format date for display
  String _formatDate(DateTime date) {
    final months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря'
    ];
    return '${date.day} ${months[date.month - 1]}';
  }

  /// Open fullscreen gallery for establishment photos
  void _openFullscreenGallery(int initialIndex) {
    final photos = (_establishment!.media ?? [])
        .where((m) => m.type == 'photo' || m.type == 'interior')
        .toList();
    if (photos.isEmpty) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => _FullscreenGallery(
          photos: photos,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  /// Open fullscreen gallery for menu photos
  void _openMenuGallery(int initialIndex) {
    final menuPhotos =
        (_establishment!.media ?? []).where((m) => m.type == 'menu').toList();
    if (menuPhotos.isEmpty) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => _FullscreenGallery(
          photos: menuPhotos,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  /// Open map explorer centered on this establishment (Booking-style exploration)
  void _openMapExplorer() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => MapScreen(
          focusedEstablishment: _establishment,
        ),
      ),
    );
  }
}

/// Working hours row widget
class _WorkingHoursRow extends StatelessWidget {
  final String label;
  final String time;
  final bool isHighlighted;

  const _WorkingHoursRow({
    required this.label,
    required this.time,
    this.isHighlighted = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          SizedBox(
            width: 180,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 16,
                fontWeight: isHighlighted ? FontWeight.w700 : FontWeight.w500,
                color: isHighlighted
                    ? AppTheme.primaryOrange
                    : AppTheme.textPrimary,
              ),
            ),
          ),
          Text(
            time,
            style: TextStyle(
              fontSize: 16,
              fontWeight: isHighlighted ? FontWeight.w600 : FontWeight.w400,
              color:
                  isHighlighted ? AppTheme.primaryOrange : AppTheme.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Fullscreen gallery screen
class _FullscreenGallery extends StatefulWidget {
  final List<EstablishmentMedia> photos;
  final int initialIndex;

  const _FullscreenGallery({
    required this.photos,
    required this.initialIndex,
  });

  @override
  State<_FullscreenGallery> createState() => _FullscreenGalleryState();
}

class _FullscreenGalleryState extends State<_FullscreenGallery> {
  late PageController _pageController;
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Photos
          PageView.builder(
            controller: _pageController,
            itemCount: widget.photos.length,
            onPageChanged: (index) {
              setState(() => _currentIndex = index);
            },
            itemBuilder: (context, index) {
              final photo = widget.photos[index];
              final imageUrl =
                  photo.url ?? photo.previewUrl ?? photo.thumbnailUrl;

              if (imageUrl == null) {
                return const Center(
                  child: Icon(Icons.error,
                      color: AppTheme.textOnPrimary, size: 48),
                );
              }

              return InteractiveViewer(
                minScale: 0.5,
                maxScale: 4.0,
                child: CachedNetworkImage(
                  imageUrl: imageUrl,
                  fit: BoxFit.contain,
                  placeholder: (context, url) => const Center(
                    child: CircularProgressIndicator(
                        color: AppTheme.textOnPrimary),
                  ),
                  errorWidget: (context, url, error) => const Center(
                    child: Icon(Icons.error,
                        color: AppTheme.textOnPrimary, size: 48),
                  ),
                ),
              );
            },
          ),

          // Close button
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            right: 16,
            child: IconButton(
              icon: const Icon(Icons.close,
                  color: AppTheme.textOnPrimary, size: 28),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),

          // Counter
          Positioned(
            bottom: MediaQuery.of(context).padding.bottom + 16,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
                ),
                child: Text(
                  '${_currentIndex + 1} / ${widget.photos.length}',
                  style: const TextStyle(
                    color: AppTheme.textOnPrimary,
                    fontSize: 14,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
