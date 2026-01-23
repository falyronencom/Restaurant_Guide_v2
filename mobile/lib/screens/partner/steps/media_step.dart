import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/services/media_service.dart';

/// Step 4: Media Upload
/// Allows user to upload establishment photos and menu
/// Based on Figma design: Media/Menu files frame
class MediaStep extends StatefulWidget {
  const MediaStep({super.key});

  @override
  State<MediaStep> createState() => _MediaStepState();
}

class _MediaStepState extends State<MediaStep> {
  final ImagePicker _picker = ImagePicker();
  final MediaService _mediaService = MediaService();
  bool _isUploadingPhoto = false;
  bool _isUploadingMenu = false;

  // Figma colors
  static const Color _primaryOrange = Color(0xFFDB4F13);
  static const Color _lightOrange = Color(0xFFEC723D);
  static const Color _greyStroke = Color(0xFFD2D2D2);
  static const Color _greyText = Color(0xFF9D9D9D);

  static const int _maxPhotos = 50;
  static const int _maxMenuPhotos = 20;

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

              // Section header
              _buildSectionHeader(
                'Медиа',
                'Загрузите фотографии интерьера, экстерьера, атмосферы, а так же меню и фото блюд',
              ),

              const SizedBox(height: 24),

              // Photos section
              _buildPhotosSection(provider),

              // Menu section
              _buildMenuSection(provider),

              const SizedBox(height: 100), // Bottom padding for navigation
            ],
          ),
        );
      },
    );
  }

  /// Build section header with title and subtitle
  Widget _buildSectionHeader(String title, String subtitle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 22,
            fontWeight: FontWeight.w500,
            color: Colors.black,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: Colors.black,
          ),
        ),
        const SizedBox(height: 8),
        const Divider(color: _greyStroke, height: 1),
      ],
    );
  }

  /// Build photos section
  Widget _buildPhotosSection(PartnerRegistrationProvider provider) {
    final photos = provider.data.interiorPhotos;
    final primaryPhoto = provider.data.primaryPhotoUrl;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 24),

        // Title with required marker
        const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                'Фото',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
            ),
            Text(
              '*',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 17,
                fontWeight: FontWeight.w500,
                color: _lightOrange,
              ),
            ),
          ],
        ),

        const SizedBox(height: 8),

        const Text(
          'Добавьте фото вашего заведения, первая фотография будет обложкой карточки',
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: Colors.black,
          ),
        ),

        const SizedBox(height: 16),

        // Photo count hint
        const Center(
          child: Text(
            'До 50 фото формата PNG/JPG, до 150 мб',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: _greyText,
            ),
          ),
        ),

        const SizedBox(height: 8),

        // Photo grid (if any photos uploaded)
        if (photos.isNotEmpty) ...[
          _buildPhotoGrid(
            photos: photos,
            primaryPhoto: primaryPhoto,
            onRemove: (url) => provider.removeInteriorPhoto(url),
            onSetPrimary: (url) => provider.setPrimaryPhoto(url),
          ),
          const SizedBox(height: 12),
        ],

        // Add photo button
        _buildAddButton(
          label: '+ Добавить фото',
          isLoading: _isUploadingPhoto,
          onTap: photos.length < _maxPhotos ? () => _pickPhoto(provider) : null,
        ),

        const SizedBox(height: 16),
        const Divider(color: _greyStroke, height: 1),
      ],
    );
  }

  /// Build menu section
  Widget _buildMenuSection(PartnerRegistrationProvider provider) {
    final menuPhotos = provider.data.menuPhotos;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 24),

        // Title with required marker
        const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                'Меню',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
            ),
            Text(
              '*',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 17,
                fontWeight: FontWeight.w500,
                color: _lightOrange,
              ),
            ),
          ],
        ),

        const SizedBox(height: 8),

        const Text(
          'Добавьте меню вашего заведения, предпочтительнее единый файл PDF',
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: Colors.black,
          ),
        ),

        const SizedBox(height: 16),

        // PDF option hint
        const Center(
          child: Text(
            'Формат PDF, до 60 мб',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: _greyText,
            ),
          ),
        ),

        const SizedBox(height: 8),

        // Add PDF button (placeholder - PDF upload will be implemented later)
        _buildAddButton(
          label: '+ Добавить меню',
          isLoading: false,
          onTap: () => _showPdfPlaceholder(),
        ),

        const SizedBox(height: 16),

        // Photo option hint
        const Center(
          child: Text(
            'До 20 фото формата PNG/JPG, до 90 мб',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: _greyText,
            ),
          ),
        ),

        const SizedBox(height: 8),

        // Menu photo grid (if any photos uploaded)
        if (menuPhotos.isNotEmpty) ...[
          _buildMenuPhotoGrid(
            photos: menuPhotos,
            onRemove: (url) => provider.removeMenuPhoto(url),
          ),
          const SizedBox(height: 12),
        ],

        // Add menu photo button
        _buildAddButton(
          label: '+ Добавить меню',
          isLoading: _isUploadingMenu,
          onTap: menuPhotos.length < _maxMenuPhotos
              ? () => _pickMenuPhoto(provider)
              : null,
        ),

        const SizedBox(height: 16),
        const Divider(color: _greyStroke, height: 1),
      ],
    );
  }

  /// Build photo grid with uploaded photos
  Widget _buildPhotoGrid({
    required List<String> photos,
    required String? primaryPhoto,
    required ValueChanged<String> onRemove,
    required ValueChanged<String> onSetPrimary,
  }) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 1.0,
      ),
      itemCount: photos.length,
      itemBuilder: (context, index) {
        final photo = photos[index];
        final isPrimary = photo == primaryPhoto;

        return _PhotoTile(
          photoUrl: photo,
          isPrimary: isPrimary,
          onRemove: () => onRemove(photo),
          onSetPrimary: () => onSetPrimary(photo),
        );
      },
    );
  }

  /// Build menu photo grid
  Widget _buildMenuPhotoGrid({
    required List<String> photos,
    required ValueChanged<String> onRemove,
  }) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 1.0,
      ),
      itemCount: photos.length,
      itemBuilder: (context, index) {
        final photo = photos[index];

        return _PhotoTile(
          photoUrl: photo,
          isPrimary: false,
          onRemove: () => onRemove(photo),
          onSetPrimary: null,
        );
      },
    );
  }

  /// Build add button
  Widget _buildAddButton({
    required String label,
    required bool isLoading,
    required VoidCallback? onTap,
  }) {
    return GestureDetector(
      onTap: isLoading ? null : onTap,
      child: Container(
        width: double.infinity,
        height: 48,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: _greyStroke),
        ),
        alignment: Alignment.center,
        child: isLoading
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(_primaryOrange),
                ),
              )
            : Text(
                label,
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: onTap != null ? Colors.black : _greyText,
                ),
              ),
      ),
    );
  }

  /// Pick photo from gallery and upload to Cloudinary
  Future<void> _pickPhoto(PartnerRegistrationProvider provider) async {
    try {
      final XFile? image = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );

      if (image == null) return;

      setState(() => _isUploadingPhoto = true);

      // Upload to Cloudinary via backend API
      final uploadedMedia = await _mediaService.uploadImage(
        filePath: image.path,
        type: 'interior',
      );

      // Store Cloudinary URL instead of local path
      provider.addInteriorPhoto(uploadedMedia.url);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Фото успешно загружено'),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.green,
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Ошибка при загрузке фото: $e'),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isUploadingPhoto = false);
      }
    }
  }

  /// Pick menu photo from gallery and upload to Cloudinary
  Future<void> _pickMenuPhoto(PartnerRegistrationProvider provider) async {
    try {
      final XFile? image = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );

      if (image == null) return;

      setState(() => _isUploadingMenu = true);

      // Upload to Cloudinary via backend API
      final uploadedMedia = await _mediaService.uploadImage(
        filePath: image.path,
        type: 'menu',
      );

      // Store Cloudinary URL instead of local path
      provider.addMenuPhoto(uploadedMedia.url);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Фото меню успешно загружено'),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.green,
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Ошибка при загрузке фото: $e'),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isUploadingMenu = false);
      }
    }
  }

  /// Show PDF upload placeholder
  void _showPdfPlaceholder() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Загрузка PDF будет доступна в следующей версии'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

/// Individual photo tile widget
class _PhotoTile extends StatelessWidget {
  final String photoUrl;
  final bool isPrimary;
  final VoidCallback onRemove;
  final VoidCallback? onSetPrimary;

  const _PhotoTile({
    required this.photoUrl,
    required this.isPrimary,
    required this.onRemove,
    this.onSetPrimary,
  });

  static const Color _lightOrange = Color(0xFFEC723D);
  static const Color _greyStroke = Color(0xFFD2D2D2);

  @override
  Widget build(BuildContext context) {
    final isLocalFile = !photoUrl.startsWith('http');

    return GestureDetector(
      onTap: onSetPrimary,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isPrimary ? _lightOrange : _greyStroke,
            width: isPrimary ? 2 : 1,
          ),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Photo
            ClipRRect(
              borderRadius: BorderRadius.circular(7),
              child: isLocalFile
                  ? Image.file(
                      File(photoUrl),
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) {
                        return Container(
                          color: _greyStroke,
                          child: const Icon(
                            Icons.broken_image,
                            color: Colors.white,
                          ),
                        );
                      },
                    )
                  : Image.network(
                      photoUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) {
                        return Container(
                          color: _greyStroke,
                          child: const Icon(
                            Icons.broken_image,
                            color: Colors.white,
                          ),
                        );
                      },
                    ),
            ),

            // Primary badge
            if (isPrimary)
              Positioned(
                left: 4,
                bottom: 4,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: _lightOrange,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text(
                    'Обложка',
                    style: TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 10,
                      fontWeight: FontWeight.w500,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),

            // Remove button
            Positioned(
              right: 4,
              top: 4,
              child: GestureDetector(
                onTap: onRemove,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.6),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.close,
                    size: 16,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
