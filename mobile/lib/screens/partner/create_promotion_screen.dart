import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/canon_app_bar.dart';

/// Create or edit a promotion
/// In edit mode, pre-fills fields from existingPromotion
class CreatePromotionScreen extends StatefulWidget {
  final String establishmentId;
  final Promotion? existingPromotion;

  const CreatePromotionScreen({
    super.key,
    required this.establishmentId,
    this.existingPromotion,
  });

  @override
  State<CreatePromotionScreen> createState() => _CreatePromotionScreenState();
}

class _CreatePromotionScreenState extends State<CreatePromotionScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();

  DateTime? _validFrom;
  DateTime? _validUntil;
  String? _imagePath;
  bool _isSaving = false;

  bool get _isEditMode => widget.existingPromotion != null;

  @override
  void initState() {
    super.initState();
    if (_isEditMode) {
      final p = widget.existingPromotion!;
      _titleController.text = p.title;
      _descriptionController.text = p.description ?? '';
      _validFrom = p.validFrom;
      _validUntil = p.validUntil;
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: CanonAppBar(
        title: _isEditMode ? 'Изменить акцию' : 'Новая акция',
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Title
            _buildLabel('Название *'),
            const SizedBox(height: 6),
            TextFormField(
              controller: _titleController,
              maxLength: 80,
              decoration: _inputDecoration('Например: Скидка 20% на все блюда'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Введите название' : null,
            ),

            const SizedBox(height: 16),

            // Description
            _buildLabel('Описание'),
            const SizedBox(height: 6),
            TextFormField(
              controller: _descriptionController,
              maxLines: 3,
              decoration: _inputDecoration('Условия акции, подробности...'),
            ),

            const SizedBox(height: 16),

            // Image
            _buildLabel('Изображение'),
            const SizedBox(height: 6),
            _buildImagePicker(),

            const SizedBox(height: 16),

            // Valid from
            _buildLabel('Начало'),
            const SizedBox(height: 6),
            _buildDatePicker(
              value: _validFrom,
              hint: 'Сегодня (по умолчанию)',
              onPick: (d) => setState(() => _validFrom = d),
            ),

            const SizedBox(height: 16),

            // Valid until
            _buildLabel('Окончание'),
            const SizedBox(height: 6),
            _buildDatePicker(
              value: _validUntil,
              hint: 'Бессрочно (по умолчанию)',
              onPick: (d) => setState(() => _validUntil = d),
              onClear: () => setState(() => _validUntil = null),
            ),

            const SizedBox(height: 32),

            // Save button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSaving ? null : _save,
                style: AppTheme.canonCtaL(),
                // Фиксированная высота контента: без скачка при смене
                // текст ↔ спиннер
                child: SizedBox(
                  height: 24,
                  child: Center(
                    child: _isSaving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(_isEditMode ? 'Сохранить' : 'Создать акцию'),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: AppTheme.textDark,
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: AppTheme.textGrey),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
        borderSide: const BorderSide(color: AppTheme.strokeGrey),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
        borderSide: const BorderSide(color: AppTheme.strokeGrey),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
        borderSide: const BorderSide(color: AppTheme.primaryOrange),
      ),
    );
  }

  Widget _buildImagePicker() {
    return GestureDetector(
      onTap: _pickImage,
      child: Container(
        height: 150,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          border: Border.all(color: AppTheme.strokeGrey),
        ),
        child: _imagePath != null
            ? Stack(
                fit: StackFit.expand,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.file(
                      File(_imagePath!),
                      fit: BoxFit.cover,
                    ),
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: GestureDetector(
                      onTap: () => setState(() => _imagePath = null),
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.5),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.close, color: Colors.white, size: 18),
                      ),
                    ),
                  ),
                ],
              )
            : (_isEditMode && widget.existingPromotion!.hasImage)
                ? ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.network(
                      widget.existingPromotion!.previewUrl ??
                          widget.existingPromotion!.imageUrl!,
                      fit: BoxFit.cover,
                    ),
                  )
                : const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate_outlined,
                          size: 40, color: AppTheme.textGrey),
                      SizedBox(height: 8),
                      Text(
                        'Добавить фото',
                        style: TextStyle(color: AppTheme.textGrey),
                      ),
                    ],
                  ),
      ),
    );
  }

  Widget _buildDatePicker({
    required DateTime? value,
    required String hint,
    required ValueChanged<DateTime> onPick,
    VoidCallback? onClear,
  }) {
    return GestureDetector(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? DateTime.now(),
          firstDate: DateTime.now().subtract(const Duration(days: 1)),
          lastDate: DateTime.now().add(const Duration(days: 365)),
        );
        if (picked != null) onPick(picked);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppTheme.gray50,
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          border: Border.all(color: AppTheme.strokeGrey),
        ),
        child: Row(
          children: [
            const Icon(Icons.calendar_today,
                size: 18, color: AppTheme.textGrey),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                value != null
                    ? '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year}'
                    : hint,
                style: TextStyle(
                  color: value != null
                      ? AppTheme.textPrimary
                      : AppTheme.textGrey,
                  fontSize: 15,
                ),
              ),
            ),
            if (value != null && onClear != null)
              GestureDetector(
                onTap: onClear,
                child: const Icon(Icons.clear,
                    size: 18, color: AppTheme.textGrey),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final image = await picker.pickImage(source: ImageSource.gallery, maxWidth: 1920);
    if (image != null) {
      setState(() => _imagePath = image.path);
    }
  }

  String _formatDateForApi(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    final provider = context.read<PromotionProvider>();
    bool success;

    if (_isEditMode) {
      success = await provider.updatePromotion(
        promotionId: widget.existingPromotion!.id,
        establishmentId: widget.establishmentId,
        title: _titleController.text.trim(),
        description: _descriptionController.text.trim(),
        imagePath: _imagePath,
        validFrom: _validFrom != null ? _formatDateForApi(_validFrom!) : null,
        validUntil: _validUntil != null ? _formatDateForApi(_validUntil!) : null,
      );
    } else {
      success = await provider.createPromotion(
        establishmentId: widget.establishmentId,
        title: _titleController.text.trim(),
        description: _descriptionController.text.trim(),
        imagePath: _imagePath,
        validFrom: _validFrom != null ? _formatDateForApi(_validFrom!) : null,
        validUntil: _validUntil != null ? _formatDateForApi(_validUntil!) : null,
      );
    }

    if (!mounted) return;
    setState(() => _isSaving = false);

    if (success) {
      Navigator.pop(context, true);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(provider.error ?? 'Ошибка сохранения'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }
}
