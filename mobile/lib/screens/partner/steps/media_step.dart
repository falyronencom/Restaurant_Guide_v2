import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
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
  bool _isUploadingPdf = false;

  // Figma colors
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _lightOrange = AppTheme.primaryOrangeLight;
  static const Color _greyStroke = AppTheme.strokeGrey;
  static const Color _greyText = Color(0xFF9D9D9D);

  static const int _maxPhotos = 50;
  static const int _maxMenuPhotos = 20;
  static const int _maxMenuPdfs = 2;

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
            fontSize: 22,
            fontWeight: FontWeight.w500,
            color: AppTheme.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: AppTheme.textPrimary,
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
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.textPrimary,
                ),
              ),
            ),
            Text(
              '*',
              style: TextStyle(
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
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: AppTheme.textPrimary,
          ),
        ),

        const SizedBox(height: 16),

        // Photo count hint
        const Center(
          child: Text(
            'До 50 фото формата PNG/JPG, до 150 мб',
            style: TextStyle(
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
    final menuPdfs = provider.data.menuPdfs;

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
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.textPrimary,
                ),
              ),
            ),
            Text(
              '*',
              style: TextStyle(
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
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: AppTheme.textPrimary,
          ),
        ),

        const SizedBox(height: 16),

        // PDF option hint
        const Center(
          child: Text(
            'Формат PDF, до 60 мб, максимум 2 файла',
            style: TextStyle(
              fontSize: 13,
              color: _greyText,
            ),
          ),
        ),

        const SizedBox(height: 8),

        // PDF list (if any uploaded)
        if (menuPdfs.isNotEmpty) ...[
          ...menuPdfs.map(
            (pdf) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _PdfTile(
                pdf: pdf,
                onRemove: () => provider.removeMenuPdf(pdf.url),
              ),
            ),
          ),
        ],

        // Add PDF button
        _buildAddButton(
          label: '+ Добавить PDF меню',
          isLoading: _isUploadingPdf,
          onTap: menuPdfs.length < _maxMenuPdfs ? () => _pickPdf(provider) : null,
        ),

        const SizedBox(height: 16),

        // Photo option hint
        const Center(
          child: Text(
            'До 20 фото формата PNG/JPG, до 90 мб',
            style: TextStyle(
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
          label: '+ Добавить фото меню',
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
          color: AppTheme.backgroundPrimary,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
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
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: onTap != null ? AppTheme.textPrimary : _greyText,
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

  /// Pick a PDF file and upload it as a menu document
  Future<void> _pickPdf(PartnerRegistrationProvider provider) async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
        withData: false,
      );

      if (result == null || result.files.isEmpty) return;
      final picked = result.files.first;
      final path = picked.path;

      if (path == null) {
        _showSnackBar('Не удалось получить путь к файлу', isError: true);
        return;
      }

      // Client-side guard against oversized file before hitting backend
      if (picked.size > 60 * 1024 * 1024) {
        _showSnackBar('Размер PDF превышает 60 МБ', isError: true);
        return;
      }

      setState(() => _isUploadingPdf = true);

      final uploaded = await _mediaService.uploadPdf(filePath: path);

      final pdf = MenuPdf(
        url: uploaded.url,
        thumbnailUrl: uploaded.thumbnailUrl,
        previewUrl: uploaded.previewUrl,
        fileName: picked.name,
      );

      provider.addMenuPdf(pdf);

      _showSnackBar('PDF меню загружено', isError: false);
    } catch (e) {
      _showSnackBar('Ошибка при загрузке PDF: $e', isError: true);
    } finally {
      if (mounted) {
        setState(() => _isUploadingPdf = false);
      }
    }
  }

  /// Convenience snackbar helper for PDF upload feedback
  void _showSnackBar(String message, {required bool isError}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: isError ? Colors.red : Colors.green,
        duration: const Duration(seconds: 2),
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

  static const Color _lightOrange = AppTheme.primaryOrangeLight;
  static const Color _greyStroke = AppTheme.strokeGrey;

  @override
  Widget build(BuildContext context) {
    final isLocalFile = !photoUrl.startsWith('http');

    return GestureDetector(
      onTap: onSetPrimary,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
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
                            color: AppTheme.backgroundPrimary,
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
                            color: AppTheme.backgroundPrimary,
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
                    borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                  ),
                  child: const Text(
                    'Обложка',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w500,
                      color: AppTheme.textOnPrimary,
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
                    color: AppTheme.textOnPrimary,
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

/// PDF menu tile: first-page thumbnail + filename + delete button
class _PdfTile extends StatelessWidget {
  final MenuPdf pdf;
  final VoidCallback onRemove;

  const _PdfTile({
    required this.pdf,
    required this.onRemove,
  });

  static const Color _greyStroke = AppTheme.strokeGrey;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      decoration: BoxDecoration(
        color: AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(color: _greyStroke),
      ),
      padding: const EdgeInsets.all(8),
      child: Row(
        children: [
          // Thumbnail (first page of PDF rendered by Cloudinary pg_1)
          ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
            child: Image.network(
              pdf.thumbnailUrl,
              width: 56,
              height: 56,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) {
                return Container(
                  width: 56,
                  height: 56,
                  color: _greyStroke,
                  child: const Icon(
                    Icons.picture_as_pdf,
                    color: AppTheme.backgroundPrimary,
                  ),
                );
              },
            ),
          ),
          const SizedBox(width: 12),
          // Filename + PDF label
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  pdf.fileName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'PDF документ',
                  style: TextStyle(
                    fontSize: 13,
                    color: Color(0xFF9D9D9D),
                  ),
                ),
              ],
            ),
          ),
          // Delete button
          IconButton(
            onPressed: onRemove,
            icon: const Icon(
              Icons.delete_outline,
              color: Color(0xFF9D9D9D),
            ),
          ),
        ],
      ),
    );
  }
}