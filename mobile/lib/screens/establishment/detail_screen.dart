import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';
import 'package:restaurant_guide_mobile/config/dimensions.dart';
import 'package:restaurant_guide_mobile/screens/reviews/write_review_screen.dart';
import 'package:restaurant_guide_mobile/screens/reviews/reviews_list_screen.dart';

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

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFFD5F1B);
  static const Color _secondaryOrange = Color(0xFFF06B32);
  static const Color _greenStatus = Color(0xFF34C759);
  static const Color _navyBlue = Color(0xFF3631C0);
  static const Color _greyText = Color(0xFFABABAB);

  @override
  void initState() {
    super.initState();
    _loadData();
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
        .where((m) => m.type == 'photo')
        .toList();
    final hasPhotos = photos.isNotEmpty;

    return SizedBox(
      height: 657,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Photo gallery
          hasPhotos
              ? _buildPhotoGallery(photos)
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

          // Page indicator dots
          if (hasPhotos && photos.length > 1)
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

          // Share button (Figma: right ~24px, near top)
          Positioned(
            top: MediaQuery.of(context).padding.top + 4,
            right: 24,
            child: _buildShareButton(),
          ),

          // Favorite button (Figma: right ~69px, below share)
          Positioned(
            top: MediaQuery.of(context).padding.top + 42,
            right: 69,
            child: _buildFavoriteButton(),
          ),

          // Info overlay
          Positioned(
            bottom: 190,
            left: 17,
            right: 17,
            child: _buildInfoOverlay(),
          ),

          // Rating badge
          Positioned(
            top: 370,
            right: 24,
            child: _buildRatingBadge(),
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
                ? Colors.white
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
          color: Colors.black,
          borderRadius: BorderRadius.only(
            topRight: Radius.circular(8),
            bottomRight: Radius.circular(8),
          ),
        ),
        child: const Center(
          child: Icon(
            Icons.chevron_left,
            color: Colors.white,
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
          style: const TextStyle(
            fontFamily: 'Unbounded',
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
    // Simplified - in production would check actual hours
    return RichText(
      text: const TextSpan(
        style: TextStyle(fontSize: 18),
        children: [
          TextSpan(
            text: 'Открыто',
            style: TextStyle(
              color: _greenStatus,
              fontWeight: FontWeight.w500,
            ),
          ),
          TextSpan(
            text: '/до 23:00',
            style: TextStyle(color: _backgroundColor),
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
            borderRadius: BorderRadius.circular(12),
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

  /// Build menu section
  Widget _buildMenuSection() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title
          const Text(
            'Меню',
            style: TextStyle(
              fontFamily: 'Unbounded',
              fontSize: 30,
              fontWeight: FontWeight.w400,
              color: Colors.black,
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

  /// Build working hours
  Widget _buildWorkingHours() {
    final workingHours = _establishment!.workingHours;

    // If no working hours data, show default
    if (workingHours == null) {
      return const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _WorkingHoursRow(label: 'Пон - Вос:', time: '10:00 - 23:00'),
        ],
      );
    }

    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _WorkingHoursRow(
          label: 'Пон - Вос:',
          time: '10:00 - 23:00',
        ),
        _WorkingHoursRow(
          label: 'Завтраки {ежедневно}:',
          time: '10:00 - 16:00',
        ),
        _WorkingHoursRow(
          label: 'Специальное меню:',
          time: '10:00 - 22:30',
        ),
      ],
    );
  }

  /// Build menu carousel
  Widget _buildMenuCarousel() {
    // Filter only menu photos
    final menuPhotos = _establishment!.media!
        .where((m) => m.type == 'menu')
        .toList();

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
                  topLeft: index == 0 ? const Radius.circular(30) : const Radius.circular(10),
                  topRight: const Radius.circular(10),
                  bottomLeft: const Radius.circular(10),
                  bottomRight: index == maxIndex ? const Radius.circular(30) : const Radius.circular(10),
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFD35620).withValues(alpha: 0.04),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(4, 4),
                  ),
                  BoxShadow(
                    color: const Color(0xFFD35620).withValues(alpha: 0.04),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(-4, -4),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.only(
                  topLeft: index == 0 ? const Radius.circular(30) : const Radius.circular(10),
                  topRight: const Radius.circular(10),
                  bottomLeft: const Radius.circular(10),
                  bottomRight: index == maxIndex ? const Radius.circular(30) : const Radius.circular(10),
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

  /// Build divider
  Widget _buildDivider() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: const Divider(
        color: Color(0xFFD2D2D2),
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
        amenities.add({'name': 'Доставка еды', 'icon': Icons.delivery_dining});
      }
      if (attributes['wifi'] == true) {
        amenities.add({'name': 'Wi-Fi', 'icon': Icons.wifi});
      }
      if (attributes['terrace'] == true) {
        amenities.add({'name': 'Терасса', 'icon': Icons.deck});
      }
      if (attributes['parking'] == true) {
        amenities.add({'name': 'Парковка', 'icon': Icons.local_parking});
      }
      if (attributes['live_music'] == true) {
        amenities.add({'name': 'Живая музыка', 'icon': Icons.music_note});
      }
      if (attributes['kids_zone'] == true) {
        amenities.add({'name': 'Детская зона', 'icon': Icons.child_friendly});
      }
    }

    // If no amenities, show default set
    if (amenities.isEmpty) {
      amenities.addAll([
        {'name': 'Доставка еды', 'icon': Icons.delivery_dining},
        {'name': 'Wi-Fi', 'icon': Icons.wifi},
        {'name': 'Терасса', 'icon': Icons.deck},
      ]);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Атрибуты',
              style: TextStyle(
                fontFamily: 'Unbounded',
                fontSize: 30,
                fontWeight: FontWeight.w400,
                color: Colors.black,
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Amenities horizontal carousel
          SizedBox(
            height: 120,
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
                    amenity['icon'] as IconData,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// Build amenity item (icon in circle with label)
  Widget _buildAmenityItem(String label, IconData icon) {
    return Column(
      children: [
        // Circle with icon
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: _secondaryOrange.withValues(alpha: 0.3),
              width: 2,
            ),
          ),
          child: Center(
            child: Icon(
              icon,
              size: 36,
              color: _secondaryOrange,
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Label
        Text(
          label,
          style: const TextStyle(
            fontSize: 15,
            color: Colors.black,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
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
              const Text(
                'Карта',
                style: TextStyle(
                  fontFamily: 'Unbounded',
                  fontSize: 30,
                  fontWeight: FontWeight.w400,
                  color: Colors.black,
                ),
              ),
              const SizedBox(height: 14),

              // Distance
              const Text(
                '0,3 км от вас',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  color: _secondaryOrange,
                ),
              ),
              const SizedBox(height: 14),

              // Address
              Text(
                '${_establishment!.address},\n${_establishment!.city}',
                style: const TextStyle(
                  fontSize: 16,
                  color: Colors.black,
                ),
              ),
            ],
          ),
        ),

        // Map placeholder
        Container(
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
                color: const Color(0xFFD35620).withValues(alpha: 0.04),
                blurRadius: 15,
                spreadRadius: 2,
                offset: const Offset(4, 4),
              ),
            ],
          ),
          child: const Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.map, size: 64, color: Colors.grey),
                SizedBox(height: 16),
                Text(
                  'Карта в разработке',
                  style: TextStyle(color: Colors.grey),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Build reviews section (dark background)
  Widget _buildReviewsSection() {
    return Container(
      color: Colors.black,
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Text(
                  'Отзывы',
                  style: TextStyle(
                    fontFamily: 'Unbounded',
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
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (context) => WriteReviewScreen(
                        establishment: _establishment!,
                      ),
                    ),
                  ).then((result) {
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
                    borderRadius: BorderRadius.circular(8),
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
              margin: EdgeInsets.only(right: index < _reviews.length - 1 ? 10 : 0),
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
            color: const Color(0xFFD35620).withValues(alpha: 0.04),
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
                    review.userName.isNotEmpty ? review.userName[0].toUpperCase() : 'A',
                    style: const TextStyle(
                      fontFamily: 'Unbounded',
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
            child: Text(
              review.text ?? '',
              style: const TextStyle(
                fontSize: 12,
                color: _backgroundColor,
                height: 1.67,
              ),
              maxLines: 6,
              overflow: TextOverflow.ellipsis,
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
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    return '${date.day} ${months[date.month - 1]}';
  }

  /// Open fullscreen gallery for establishment photos
  void _openFullscreenGallery(int initialIndex) {
    final photos = (_establishment!.media ?? [])
        .where((m) => m.type == 'photo')
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
    final menuPhotos = (_establishment!.media ?? [])
        .where((m) => m.type == 'menu')
        .toList();
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
}

/// Working hours row widget
class _WorkingHoursRow extends StatelessWidget {
  final String label;
  final String time;

  const _WorkingHoursRow({
    required this.label,
    required this.time,
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
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w500,
                color: Colors.black,
              ),
            ),
          ),
          Text(
            time,
            style: const TextStyle(
              fontSize: 16,
              color: Colors.black,
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
              final imageUrl = photo.url ?? photo.previewUrl ?? photo.thumbnailUrl;

              if (imageUrl == null) {
                return const Center(
                  child: Icon(Icons.error, color: Colors.white, size: 48),
                );
              }

              return InteractiveViewer(
                minScale: 0.5,
                maxScale: 4.0,
                child: CachedNetworkImage(
                  imageUrl: imageUrl,
                  fit: BoxFit.contain,
                  placeholder: (context, url) => const Center(
                    child: CircularProgressIndicator(color: Colors.white),
                  ),
                  errorWidget: (context, url, error) => const Center(
                    child: Icon(Icons.error, color: Colors.white, size: 48),
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
              icon: const Icon(Icons.close, color: Colors.white, size: 28),
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
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  '${_currentIndex + 1} / ${widget.photos.length}',
                  style: const TextStyle(
                    color: Colors.white,
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
