import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/establishment_preview_screen.dart';

/// Step 7: Summary Step
/// Shows checklist of completed steps and allows preview/submit
/// Based on Figma design "Choose adress" (summary frame)
class SummaryStep extends StatelessWidget {
  /// Callback when submit is pressed
  final VoidCallback onSubmit;

  const SummaryStep({
    super.key,
    required this.onSubmit,
  });

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _greenCheck = Color(0xFF34C759);
  static const Color _greyText = Color(0xFF949494);

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

              // Summary text
              const Text(
                'Всё готово! Вы можете вернуться к редактированию, посмотреть карточку заведения или отправить заведение на проверку.',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                  color: Colors.black,
                  height: 1.5,
                ),
              ),

              const SizedBox(height: 40),

              // Checklist
              _buildChecklist(provider),

              const SizedBox(height: 60),

              // Action buttons
              _buildActionButtons(context, provider),

              const SizedBox(height: 40),
            ],
          ),
        );
      },
    );
  }

  /// Build checklist of completed steps
  Widget _buildChecklist(PartnerRegistrationProvider provider) {
    final checklistItems = [
      _ChecklistItem(
        title: 'Ваши данные',
        isCompleted: _isLegalInfoCompleted(provider),
      ),
      _ChecklistItem(
        title: 'Категория заведения',
        isCompleted: provider.data.categories.isNotEmpty,
      ),
      _ChecklistItem(
        title: 'Категория кухни',
        isCompleted: provider.data.cuisineTypes.isNotEmpty,
      ),
      _ChecklistItem(
        title: 'О заведении',
        isCompleted: _isBasicInfoCompleted(provider),
      ),
      _ChecklistItem(
        title: 'Медиа',
        isCompleted: _isMediaCompleted(provider),
      ),
      _ChecklistItem(
        title: 'Время работы',
        isCompleted: _isWorkingHoursCompleted(provider),
      ),
      _ChecklistItem(
        title: 'Заполните адрес',
        isCompleted: _isAddressCompleted(provider),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: checklistItems.map((item) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            children: [
              // Checkmark icon
              Container(
                width: 27,
                height: 27,
                decoration: BoxDecoration(
                  color: item.isCompleted ? _greenCheck : Colors.transparent,
                  shape: BoxShape.circle,
                  border: item.isCompleted
                      ? null
                      : Border.all(color: _greyText, width: 2),
                ),
                child: item.isCompleted
                    ? const Icon(
                        Icons.check,
                        color: Colors.white,
                        size: 18,
                      )
                    : null,
              ),
              const SizedBox(width: 8),
              // Title
              Text(
                item.title,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                  color: item.isCompleted ? Colors.black : _greyText,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  /// Build action buttons (Preview and Submit)
  Widget _buildActionButtons(
    BuildContext context,
    PartnerRegistrationProvider provider,
  ) {
    final allCompleted = _isAllCompleted(provider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Preview button
        GestureDetector(
          onTap: () => _openPreview(context, provider),
          child: Container(
            width: 162,
            height: 47,
            decoration: BoxDecoration(
              color: Colors.black,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(
              child: Text(
                'Превью карточки',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: _backgroundColor,
                ),
              ),
            ),
          ),
        ),

        const SizedBox(height: 12),

        // Submit button
        GestureDetector(
          onTap: allCompleted ? onSubmit : null,
          child: Container(
            width: 233,
            height: 47,
            decoration: BoxDecoration(
              color: allCompleted
                  ? _primaryOrange
                  : _primaryOrange.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(
              child: Text(
                'Отправить на верификацию',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: _backgroundColor,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Open establishment preview
  void _openPreview(
    BuildContext context,
    PartnerRegistrationProvider provider,
  ) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => EstablishmentPreviewScreen(
          registrationData: provider.data,
        ),
      ),
    );
  }

  // ============================================================================
  // Validation helpers
  // ============================================================================

  bool _isLegalInfoCompleted(PartnerRegistrationProvider provider) {
    final data = provider.data;
    return (data.legalName?.isNotEmpty ?? false) &&
        (data.unp?.isNotEmpty ?? false) &&
        (data.contactPerson?.isNotEmpty ?? false) &&
        (data.contactEmail?.isNotEmpty ?? false);
  }

  bool _isBasicInfoCompleted(PartnerRegistrationProvider provider) {
    final data = provider.data;
    return (data.name?.isNotEmpty ?? false) &&
        (data.phone?.isNotEmpty ?? false);
  }

  bool _isMediaCompleted(PartnerRegistrationProvider provider) {
    final data = provider.data;
    return data.interiorPhotos.isNotEmpty && data.menuPhotos.isNotEmpty;
  }

  bool _isWorkingHoursCompleted(PartnerRegistrationProvider provider) {
    final hours = provider.data.weeklyWorkingHours;
    return hours?.hasAnyHours ?? false;
  }

  bool _isAddressCompleted(PartnerRegistrationProvider provider) {
    final data = provider.data;
    return (data.city?.isNotEmpty ?? false) &&
        (data.street?.isNotEmpty ?? false) &&
        (data.building?.isNotEmpty ?? false);
  }

  bool _isAllCompleted(PartnerRegistrationProvider provider) {
    return provider.data.categories.isNotEmpty &&
        provider.data.cuisineTypes.isNotEmpty &&
        _isBasicInfoCompleted(provider) &&
        _isMediaCompleted(provider) &&
        _isAddressCompleted(provider) &&
        _isLegalInfoCompleted(provider);
  }
}

/// Helper class for checklist items
class _ChecklistItem {
  final String title;
  final bool isCompleted;

  const _ChecklistItem({
    required this.title,
    required this.isCompleted,
  });
}
