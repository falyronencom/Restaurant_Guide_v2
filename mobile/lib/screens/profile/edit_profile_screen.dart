import 'dart:io';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:image_picker/image_picker.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';

/// Edit Profile Screen - allows user to edit their profile
/// Figma design: Edit Profile (third frame)
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  // Form controllers
  final _nameController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  // State
  bool _isSaving = false;
  String? _selectedImagePath;

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _navyBlue = Color(0xFF3631C0);
  static const Color _greyText = Color(0xFFABABAB);
  static const Color _greyDivider = Color(0xFFD2D2D2);

  @override
  void initState() {
    super.initState();
    // Pre-fill form with current user data
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final user = context.read<AuthProvider>().currentUser;
      if (user != null) {
        _nameController.text = user.name ?? '';
      }
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  /// Pick image from gallery or camera
  Future<void> _pickImage() async {
    final picker = ImagePicker();

    // Show bottom sheet to choose source
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: _backgroundColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Выберите источник',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: const Icon(Icons.photo_library, color: _primaryOrange),
                title: const Text(
                  'Галерея',
                  style: TextStyle(),
                ),
                onTap: () => Navigator.pop(context, ImageSource.gallery),
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt, color: _primaryOrange),
                title: const Text(
                  'Камера',
                  style: TextStyle(),
                ),
                onTap: () => Navigator.pop(context, ImageSource.camera),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );

    if (source != null) {
      try {
        final pickedFile = await picker.pickImage(
          source: source,
          maxWidth: 512,
          maxHeight: 512,
          imageQuality: 80,
        );

        if (pickedFile != null) {
          setState(() {
            _selectedImagePath = pickedFile.path;
          });

          // Upload avatar to server
          if (mounted) {
            final success = await context
                .read<AuthProvider>()
                .uploadAvatar(pickedFile.path);

            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    success
                        ? 'Аватар успешно обновлён'
                        : 'Не удалось загрузить аватар',
                  ),
                  backgroundColor: success ? null : Colors.red,
                  behavior: SnackBarBehavior.floating,
                ),
              );
            }
          }
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Не удалось выбрать изображение'),
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      }
    }
  }

  /// Save profile changes
  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSaving = true;
    });

    try {
      final success = await context.read<AuthProvider>().updateProfile(
            name: _nameController.text.trim(),
          );

      if (mounted) {
        if (success) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Профиль успешно обновлён'),
              behavior: SnackBarBehavior.floating,
            ),
          );
          Navigator.of(context).pop();
        } else {
          final error = context.read<AuthProvider>().errorMessage;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(error ?? 'Не удалось обновить профиль'),
              backgroundColor: Colors.red,
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Consumer<AuthProvider>(
          builder: (context, authProvider, child) {
            final user = authProvider.currentUser;

            return Column(
              children: [
                // Header
                _buildHeader(context),

                // Divider
                Container(
                  height: 1,
                  color: _greyDivider,
                ),

                // Content
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        children: [
                          const SizedBox(height: 16),

                          // Avatar section
                          _buildAvatarSection(user),

                          const SizedBox(height: 32),

                          // Form fields
                          _buildFormFields(user),

                          const SizedBox(height: 40),

                          // Save button
                          _buildSaveButton(),

                          const SizedBox(height: 32),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  /// Build header with close button and title
  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          // Close button
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(
              Icons.close,
              size: 28,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 16),
          // Title
          const Expanded(
            child: Text(
              'Редактировать профиль',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w500,
                color: Colors.black,
              ),
              textAlign: TextAlign.center,
            ),
          ),
          // Spacer for balance
          const SizedBox(width: 44),
        ],
      ),
    );
  }

  /// Build avatar section with change photo button
  Widget _buildAvatarSection(dynamic user) {
    return Column(
      children: [
        // Large avatar
        _buildAvatar(user?.fullAvatarUrl, user?.name ?? 'U', 68),

        const SizedBox(height: 16),

        // Change photo button
        GestureDetector(
          onTap: _pickImage,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            decoration: BoxDecoration(
              color: _backgroundColor,
              borderRadius: BorderRadius.circular(8),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFD35620).withValues(alpha: 0.08),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: const Offset(4, 4),
                ),
                BoxShadow(
                  color: const Color(0xFFD35620).withValues(alpha: 0.08),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: const Offset(-4, -4),
                ),
              ],
            ),
            child: const Text(
              'Поменять фото',
              style: TextStyle(
                fontSize: 15,
                color: Colors.black,
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Build avatar widget
  Widget _buildAvatar(String? avatarUrl, String name, double radius) {
    // Show selected image if any
    if (_selectedImagePath != null) {
      return CircleAvatar(
        radius: radius,
        backgroundImage: FileImage(File(_selectedImagePath!)),
        onBackgroundImageError: (_, __) {},
      );
    }

    if (avatarUrl != null && avatarUrl.isNotEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundImage: CachedNetworkImageProvider(avatarUrl),
      );
    }

    return _buildDefaultAvatar(name, radius);
  }

  /// Build default avatar with initial
  Widget _buildDefaultAvatar(String name, double radius) {
    return CircleAvatar(
      radius: radius,
      backgroundColor: _navyBlue,
      child: Text(
        name.isNotEmpty ? name[0].toUpperCase() : '?',
        style: TextStyle(
          fontFamily: AppTheme.fontDisplayFamily,
          fontSize: radius * 0.6,
          color: _backgroundColor,
          fontWeight: FontWeight.w400,
        ),
      ),
    );
  }

  /// Build form fields
  Widget _buildFormFields(dynamic user) {
    return Column(
      children: [
        // Name field (editable)
        _buildTextField(
          label: 'Имя',
          controller: _nameController,
          isEditable: true,
          validator: (value) {
            if (value == null || value.trim().isEmpty) {
              return 'Введите имя';
            }
            return null;
          },
        ),

        const SizedBox(height: 8),

        // Location field (placeholder)
        _buildTextField(
          label: 'Местоположение',
          value: '', // TODO: Add location support
          isEditable: false,
          hint: 'Не указано',
        ),

        const SizedBox(height: 8),

        // Email field (read-only)
        _buildTextField(
          label: 'Почта',
          value: user?.email ?? '',
          isEditable: false,
        ),

        const SizedBox(height: 8),

        // Phone field (read-only)
        _buildTextField(
          label: 'Телефон',
          value: user?.phone ?? '',
          isEditable: false,
        ),
      ],
    );
  }

  /// Build text field with label
  Widget _buildTextField({
    required String label,
    String? value,
    TextEditingController? controller,
    bool isEditable = false,
    String? hint,
    String? Function(String?)? validator,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: _greyDivider,
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    color: Colors.black,
                  ),
                ),
                const SizedBox(height: 8),
                if (controller != null)
                  TextFormField(
                    controller: controller,
                    enabled: isEditable && !_isSaving,
                    validator: validator,
                    style: const TextStyle(
                      fontSize: 15,
                      color: Colors.black,
                    ),
                    decoration: InputDecoration(
                      isDense: false,
                      contentPadding: const EdgeInsets.symmetric(vertical: 8),
                      border: InputBorder.none,
                      hintText: hint,
                      hintStyle: const TextStyle(
                        fontSize: 15,
                        color: _greyText,
                      ),
                    ),
                  )
                else
                  Text(
                    value?.isNotEmpty == true ? value! : (hint ?? 'Не указано'),
                    style: TextStyle(
                      fontSize: 15,
                      color:
                          value?.isNotEmpty == true ? Colors.black : _greyText,
                    ),
                  ),
              ],
            ),
          ),
          if (isEditable)
            const Icon(
              Icons.edit_outlined,
              size: 28,
              color: _greyText,
            ),
        ],
      ),
    );
  }

  /// Build save button
  Widget _buildSaveButton() {
    return SizedBox(
      width: 254,
      height: 48,
      child: ElevatedButton(
        onPressed: _isSaving ? null : _saveProfile,
        style: ElevatedButton.styleFrom(
          backgroundColor: _primaryOrange,
          foregroundColor: _backgroundColor,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          disabledBackgroundColor: _primaryOrange.withValues(alpha: 0.5),
        ),
        child: _isSaving
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  color: Color(0xFFF4F1EC),
                  strokeWidth: 2,
                ),
              )
            : const Text(
                'Сохранить',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                ),
              ),
      ),
    );
  }
}
