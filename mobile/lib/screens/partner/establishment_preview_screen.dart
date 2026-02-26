import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
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

class _EstablishmentPreviewScreenState
    extends State<EstablishmentPreviewScreen> {
  // Gallery state
  int _currentPhotoIndex = 0;
  final PageController _galleryController = PageController();

  // Description collapsed by default
  bool _isDescriptionExpanded = false;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _greenStatus = AppTheme.statusGreen;
  static const Color _greyBorder = AppTheme.strokeGrey;

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
            bottom: 60,
            left: 17,
            right: 17,
            child: _buildInfoOverlay(),
          ),

          // Rating badge (placeholder)
          Positioned(
            top: 500,
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
                ? AppTheme.backgroundPrimary
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

  /// Build preview badge
  Widget _buildPreviewBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _primaryOrange,
        borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
      ),
      child: const Text(
        'ПРЕВЬЮ',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: AppTheme.textOnPrimary,
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
          style: TextStyle(
            fontFamily: AppTheme.fontDisplayFamily,
            fontSize: 50,
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

        // Social link chip
        if (data.instagram != null && data.instagram!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: _buildSocialChip(data.instagram!),
          ),
      ],
    );
  }

  /// Build collapsible description section (matches detail_screen.dart)
  Widget _buildDescriptionSection() {
    final description = data.description;
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

  /// Build social link chip (Booking-style — visual only in preview)
  Widget _buildSocialChip(String url) {
    final info = _parseSocialLink(url);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(info.$1, size: 16, color: _backgroundColor),
          const SizedBox(width: 6),
          Text(
            info.$2,
            style: const TextStyle(
              fontSize: 14,
              color: _backgroundColor,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  /// Detect social platform from URL
  (IconData, String) _parseSocialLink(String url) {
    final lower = url.toLowerCase();
    if (lower.contains('instagram.com') || lower.contains('instagram')) {
      return (Icons.camera_alt, 'Instagram');
    }
    if (lower.contains('facebook.com') || lower.contains('fb.com')) {
      return (Icons.facebook, 'Facebook');
    }
    if (lower.contains('t.me') || lower.contains('telegram')) {
      return (Icons.telegram, 'Telegram');
    }
    if (lower.contains('vk.com') || lower.contains('vkontakte')) {
      return (Icons.groups, 'VK');
    }
    return (Icons.language, 'Сайт');
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
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
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
                    color: AppTheme.textPrimary,
                  ),
                ),
              ),
              Text(
                '${day.openTime ?? ''} - ${day.closeTime ?? ''}',
                style: const TextStyle(
                  fontSize: 16,
                  color: AppTheme.textPrimary,
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
          final maxIndex = (menuPhotos.length > 4 ? 4 : menuPhotos.length) - 1;

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
                    color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
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
    // Map attribute IDs to display info (matching detail_screen SVG approach)
    final amenities = data.attributes.map((id) {
      final item = AttributeOptions.items.firstWhere(
        (a) => a.id == id,
        orElse: () => AttributeItem(id: id, name: id),
      );
      return {
        'name': item.name,
        'svg': _getAttributeSvg(id),
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

  /// Get SVG file name for attribute (matches detail_screen.dart mapping)
  String _getAttributeSvg(String id) {
    switch (id) {
      case 'delivery':
        return 'Доставка еды';
      case 'wifi':
        return 'Wifi';
      case 'banquets':
        return 'Банкет';
      case 'terrace':
        return 'Терасса';
      case 'smoking':
        return 'Курение';
      case 'kids':
        return 'Детская зона';
      case 'pets':
        return 'Животные';
      case 'parking':
        return 'Парковка';
      case 'live_music':
        return 'Живая музыка';
      default:
        return 'Доставка еды';
    }
  }

  /// Build amenity item (SVG badge with label — matches detail_screen.dart)
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

              // Address
              Text(
                '${data.street ?? ''}, ${data.building ?? ''},\n${data.city ?? ''}',
                style: const TextStyle(
                  fontSize: 16,
                  color: AppTheme.textPrimary,
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
        borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
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
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary,
            ),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: 8),
          Text(
            'После отправки на верификацию и одобрения модератором, '
            'ваше заведение появится в каталоге и пользователи смогут '
            'оставлять отзывы.',
            style: TextStyle(
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

  Widget _buildPhoto(String photoPath) {
    if (photoPath.startsWith('http')) {
      return Image.network(
        photoPath,
        fit: BoxFit.contain,
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return const Center(
            child: CircularProgressIndicator(color: AppTheme.textOnPrimary),
          );
        },
        errorBuilder: (context, error, stackTrace) {
          return const Center(
            child: Icon(Icons.error, color: AppTheme.textOnPrimary, size: 48),
          );
        },
      );
    } else {
      return Image.file(
        File(photoPath),
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) {
          return const Center(
            child: Icon(Icons.error, color: AppTheme.textOnPrimary, size: 48),
          );
        },
      );
    }
  }
}
