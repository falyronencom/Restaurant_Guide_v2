import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

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
      appBar: AppBar(
        title: Text(_isEditMode ? 'Изменить акцию' : 'Новая акция'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
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
              height: 50,
              child: ElevatedButton(
                onPressed: _isSaving ? null : _save,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryOrange,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: _isSaving
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Text(
                        _isEditMode ? 'Сохранить' : 'Создать акцию',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
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
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: Colors.black87,
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: Colors.grey[300]!),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: Colors.grey[300]!),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppTheme.primaryOrange),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    );
  }

  Widget _buildImagePicker() {
    return GestureDetector(
      onTap: _pickImage,
      child: Container(
        height: 150,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.grey[300]!),
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
                : Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate_outlined,
                          size: 40, color: Colors.grey[400]),
                      const SizedBox(height: 8),
                      Text(
                        'Добавить фото',
                        style: TextStyle(color: Colors.grey[500]),
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
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.grey[300]!),
        ),
        child: Row(
          children: [
            Icon(Icons.calendar_today, size: 18, color: Colors.grey[500]),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                value != null
                    ? '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year}'
                    : hint,
                style: TextStyle(
                  color: value != null ? Colors.black87 : Colors.grey[500],
                  fontSize: 15,
                ),
              ),
            ),
            if (value != null && onClear != null)
              GestureDetector(
                onTap: onClear,
                child: Icon(Icons.clear, size: 18, color: Colors.grey[400]),
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
