import 'dart:io';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';

/// Preview screen for partner to see how their establishment card will look
/// Based on EstablishmentDetailScreen but with preview mode:
/// - Read-only (no favorites, no reviews)
/// - Shows data from PartnerRegistration
/// - Photo galleries work for preview
/// - No reviews section
class EstablishmentPreviewScreen extends StatefulWidget {
  final PartnerRegistration registrationData;

  const EstablishmentPreviewScreen({
    super.key,
    required this.registrationData,
  });

  @override
  State<EstablishmentPreviewScreen> createState() =>
      _EstablishmentPreviewScreenState();
}

class _EstablishmentPreviewScreenState extends State<EstablishmentPreviewScreen> {
  // Gallery state
  int _currentPhotoIndex = 0;
  final PageController _galleryController = PageController();

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFFD5F1B);
  static const Color _secondaryOrange = Color(0xFFF06B32);
  static const Color _greenStatus = Color(0xFF34C759);
  static const Color _greyBorder = Color(0xFFD2D2D2);

  @override
  void dispose() {
    _galleryController.dispose();
    super.dispose();
  }

  PartnerRegistration get data => widget.registrationData;

  @override
  Widget build(BuildContext context) {
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

            // Map section (simplified)
            _buildMapSection(),

            // Preview notice (instead of reviews)
            _buildPreviewNotice(),

            // Bottom padding
            const SizedBox(height: 34),
          ],
        ),
      ),
    );
  }

  /// Build hero section with photo and overlay info
  Widget _buildHeroSection() {
    final photos = data.interiorPhotos;
    final hasPhotos = photos.isNotEmpty;

    return SizedBox(
      height: 657,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Photo gallery
          hasPhotos ? _buildPhotoGallery(photos) : _buildNoPhotoPlaceholder(),

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

          // Preview badge
          Positioned(
            top: MediaQuery.of(context).padding.top + 42,
            right: 16,
            child: _buildPreviewBadge(),
          ),

          // Info overlay
          Positioned(
            bottom: 190,
            left: 17,
            right: 17,
            child: _buildInfoOverlay(),
          ),

          // Rating badge (placeholder)
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
  Widget _buildPhotoGallery(List<String> photos) {
    return PageView.builder(
      controller: _galleryController,
      itemCount: photos.length,
      onPageChanged: (index) {
        setState(() => _currentPhotoIndex = index);
      },
      itemBuilder: (context, index) {
        final photoPath = photos[index];

        return GestureDetector(
          onTap: () => _openFullscreenGallery(index, photos),
          child: _buildPhotoWidget(photoPath),
        );
      },
    );
  }

  /// Build photo widget (handles both local files and URLs)
  Widget _buildPhotoWidget(String photoPath) {
    // Check if it's a local file path or URL
    if (photoPath.startsWith('http')) {
      return Image.network(
        photoPath,
        fit: BoxFit.cover,
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return Container(
            color: Colors.grey[300],
            child: const Center(
              child: CircularProgressIndicator(color: _primaryOrange),
            ),
          );
        },
        errorBuilder: (context, error, stackTrace) {
          return Container(
            color: Colors.grey[300],
            child: const Icon(Icons.error, size: 48),
          );
        },
      );
    } else {
      // Local file
      return Image.file(
        File(photoPath),
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) {
          return Container(
            color: Colors.grey[300],
            child: const Icon(Icons.error, size: 48),
          );
        },
      );
    }
  }

  /// Build no photo placeholder
  Widget _buildNoPhotoPlaceholder() {
    return Container(
      color: Colors.grey[300],
      child: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.restaurant,
              size: 64,
              color: Colors.grey,
            ),
            SizedBox(height: 16),
            Text(
              'Нет фотографий',
              style: TextStyle(
                color: Colors.grey,
                fontSize: 16,
              ),
            ),
          ],
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
  Widget _buildBackButton() {
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

  /// Build preview badge
  Widget _buildPreviewBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _primaryOrange,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Text(
        'ПРЕВЬЮ',
        style: TextStyle(
          fontFamily: 'Avenir Next',
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: Colors.white,
        ),
      ),
    );
  }

  /// Build info overlay on hero image
  Widget _buildInfoOverlay() {
    // Get category and cuisine names
    final categoryNames = data.categories
        .map((id) => CategoryOptions.items
            .firstWhere((c) => c.id == id,
                orElse: () => const CategoryItem(id: '', name: '', icon: ''))
            .name)
        .where((name) => name.isNotEmpty)
        .join(', ');

    final cuisineNames = data.cuisineTypes
        .map((id) => CuisineOptions.items
            .firstWhere((c) => c.id == id,
                orElse: () => const CuisineItem(id: '', name: '', icon: ''))
            .name)
        .where((name) => name.isNotEmpty)
        .join(', ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Name
        Text(
          data.name ?? 'Название заведения',
          style: const TextStyle(
            fontFamily: 'Unbounded',
            fontSize: 40,
            fontWeight: FontWeight.w400,
            color: _backgroundColor,
          ),
        ),

        // Category
        if (categoryNames.isNotEmpty)
          Text(
            categoryNames.toLowerCase(),
            style: const TextStyle(
              fontSize: 20,
              color: _backgroundColor,
            ),
          ),

        // Cuisine
        if (cuisineNames.isNotEmpty)
          Opacity(
            opacity: 0.7,
            child: Text(
              '{${cuisineNames.toLowerCase()}}',
              style: const TextStyle(
                fontSize: 18,
                color: _backgroundColor,
              ),
            ),
          ),

        const SizedBox(height: 16),

        // Status (working hours preview)
        _buildStatusLine(),

        const SizedBox(height: 8),

        // Address
        Text(
          '${data.street ?? ''}, ${data.building ?? ''}, ${data.city ?? ''}',
          style: const TextStyle(
            fontSize: 16,
            color: _backgroundColor,
          ),
        ),

        const SizedBox(height: 8),

        // Phone
        if (data.phone != null && data.phone!.isNotEmpty)
          Text(
            data.phone!,
            style: const TextStyle(
              fontSize: 16,
              color: _backgroundColor,
            ),
          ),
      ],
    );
  }

  /// Build status line (Open/Closed with time)
  Widget _buildStatusLine() {
    final hours = data.weeklyWorkingHours;
    String statusText = 'Время работы не указано';

    if (hours != null && hours.hasAnyHours) {
      // Find first open day
      for (int i = 0; i < 7; i++) {
        final day = hours.getDay(i);
        if (day.isOpen && day.openTime != null && day.closeTime != null) {
          statusText = 'Открыто/до ${day.closeTime}';
          break;
        }
      }
    }

    return RichText(
      text: TextSpan(
        style: const TextStyle(fontSize: 18),
        children: [
          TextSpan(
            text: statusText.split('/').first,
            style: const TextStyle(
              color: _greenStatus,
              fontWeight: FontWeight.w500,
            ),
          ),
          if (statusText.contains('/'))
            TextSpan(
              text: '/${statusText.split('/').last}',
              style: const TextStyle(color: _backgroundColor),
            ),
        ],
      ),
    );
  }

  /// Build rating badge (placeholder for preview)
  Widget _buildRatingBadge() {
    return Column(
      children: [
        // Rating placeholder
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: _greenStatus,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Center(
            child: Text(
              '—',
              style: TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w400,
                color: _backgroundColor,
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        // Price
        Text(
          data.priceRange ?? '\$\$',
          style: const TextStyle(
            fontSize: 20,
            color: _backgroundColor,
          ),
        ),
      ],
    );
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
          if (data.menuPhotos.isNotEmpty) _buildMenuCarousel(),
        ],
      ),
    );
  }

  /// Build working hours display
  Widget _buildWorkingHours() {
    final hours = data.weeklyWorkingHours;

    if (hours == null || !hours.hasAnyHours) {
      return const Text(
        'Время работы не указано',
        style: TextStyle(
          fontSize: 16,
          color: Colors.grey,
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: List.generate(7, (index) {
        final day = hours.getDay(index);
        final dayName = DayNames.days[index];

        if (!day.isOpen) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Row(
            children: [
              SizedBox(
                width: 120,
                child: Text(
                  '$dayName:',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: Colors.black,
                  ),
                ),
              ),
              Text(
                '${day.openTime ?? ''} - ${day.closeTime ?? ''}',
                style: const TextStyle(
                  fontSize: 16,
                  color: Colors.black,
                ),
              ),
            ],
          ),
        );
      }),
    );
  }

  /// Build menu carousel
  Widget _buildMenuCarousel() {
    final menuPhotos = data.menuPhotos;

    return SizedBox(
      height: 275,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: menuPhotos.length > 4 ? 4 : menuPhotos.length,
        itemBuilder: (context, index) {
          final photoPath = menuPhotos[index];
          final maxIndex =
              (menuPhotos.length > 4 ? 4 : menuPhotos.length) - 1;

          return GestureDetector(
            onTap: () => _openFullscreenGallery(index, menuPhotos),
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
                    color: const Color(0xFFD35620).withValues(alpha: 0.04),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(4, 4),
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
                child: _buildPhotoWidget(photoPath),
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
        color: _greyBorder,
        height: 1,
      ),
    );
  }

  /// Build attributes section
  Widget _buildAttributesSection() {
    // Map attribute IDs to display info
    final amenities = data.attributes.map((id) {
      final item = AttributeOptions.items.firstWhere(
        (a) => a.id == id,
        orElse: () => AttributeItem(id: id, name: id),
      );
      return {
        'name': item.name,
        'icon': _getAttributeIcon(id),
      };
    }).toList();

    if (amenities.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Text(
          'Атрибуты не указаны',
          style: TextStyle(color: Colors.grey),
        ),
      );
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

  /// Get icon for attribute
  IconData _getAttributeIcon(String id) {
    switch (id) {
      case 'delivery':
        return Icons.delivery_dining;
      case 'wifi':
        return Icons.wifi;
      case 'banquets':
        return Icons.celebration;
      case 'terrace':
        return Icons.deck;
      case 'smoking':
        return Icons.smoking_rooms;
      case 'kids':
        return Icons.child_friendly;
      case 'pets':
        return Icons.pets;
      case 'parking':
        return Icons.local_parking;
      default:
        return Icons.check_circle;
    }
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
        SizedBox(
          width: 80,
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              color: Colors.black,
            ),
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  /// Build map section (simplified for preview)
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

              // Address
              Text(
                '${data.street ?? ''}, ${data.building ?? ''},\n${data.city ?? ''}',
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
          height: 200,
          margin: const EdgeInsets.symmetric(horizontal: 4),
          decoration: BoxDecoration(
            color: Colors.grey[300],
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(30),
              topRight: Radius.circular(30),
              bottomLeft: Radius.circular(30),
            ),
          ),
          child: const Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.map, size: 48, color: Colors.grey),
                SizedBox(height: 8),
                Text(
                  'Карта будет отображена после публикации',
                  style: TextStyle(color: Colors.grey, fontSize: 14),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Build preview notice (instead of reviews section)
  Widget _buildPreviewNotice() {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: _primaryOrange.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _primaryOrange.withValues(alpha: 0.3)),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.visibility,
            size: 32,
            color: _primaryOrange,
          ),
          SizedBox(height: 12),
          Text(
            'Это превью вашей карточки',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: Colors.black,
            ),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: 8),
          Text(
            'После отправки на верификацию и одобрения модератором, '
            'ваше заведение появится в каталоге и пользователи смогут '
            'оставлять отзывы.',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 14,
              color: Colors.black87,
              height: 1.5,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  /// Open fullscreen gallery
  void _openFullscreenGallery(int initialIndex, List<String> photos) {
    if (photos.isEmpty) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => _PreviewFullscreenGallery(
          photos: photos,
          initialIndex: initialIndex,
        ),
      ),
    );
  }
}

/// Fullscreen gallery for preview
class _PreviewFullscreenGallery extends StatefulWidget {
  final List<String> photos;
  final int initialIndex;

  const _PreviewFullscreenGallery({
    required this.photos,
    required this.initialIndex,
  });

  @override
  State<_PreviewFullscreenGallery> createState() =>
      _PreviewFullscreenGalleryState();
}

class _PreviewFullscreenGalleryState extends State<_PreviewFullscreenGallery> {
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
              final photoPath = widget.photos[index];

              return InteractiveViewer(
                minScale: 0.5,
                maxScale: 4.0,
                child: _buildPhoto(photoPath),
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
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

  Widget _buildPhoto(String photoPath) {
    if (photoPath.startsWith('http')) {
      return Image.network(
        photoPath,
        fit: BoxFit.contain,
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return const Center(
            child: CircularProgressIndicator(color: Colors.white),
          );
        },
        errorBuilder: (context, error, stackTrace) {
          return const Center(
            child: Icon(Icons.error, color: Colors.white, size: 48),
          );
        },
      );
    } else {
      return Image.file(
        File(photoPath),
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) {
          return const Center(
            child: Icon(Icons.error, color: Colors.white, size: 48),
          );
        },
      );
    }
  }
}
