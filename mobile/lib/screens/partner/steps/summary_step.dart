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
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _greenCheck = AppTheme.statusGreen;
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
                  color: AppTheme.textPrimary,
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

  /// Build checklist of completed steps.
  ///
  /// Галочки — проверки самого мастера (провайдера), те же, что у кнопки
  /// внизу и у отправки: своего списка у итогового шага нет. Все галочки
  /// стоят ровно тогда, когда работает «Отправить на верификацию».
  Widget _buildChecklist(PartnerRegistrationProvider provider) {
    final checklistItems = [
      _ChecklistItem(
        title: 'Ваши данные',
        isCompleted: provider.isLegalInfoStepDone,
      ),
      _ChecklistItem(
        title: 'Категория заведения',
        isCompleted: provider.isCategoryStepDone,
      ),
      _ChecklistItem(
        title: 'Категория кухни',
        isCompleted: provider.isCuisineStepDone,
      ),
      _ChecklistItem(
        title: 'О заведении',
        isCompleted: provider.isBasicInfoFieldsDone,
      ),
      _ChecklistItem(
        title: 'Медиа',
        isCompleted: provider.isMediaStepDone,
      ),
      _ChecklistItem(
        title: 'Время работы',
        isCompleted: provider.isHoursStepDone,
      ),
      _ChecklistItem(
        title: 'Заполните адрес',
        isCompleted: provider.isAddressStepDone,
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
                        color: AppTheme.textOnPrimary,
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
                  color: item.isCompleted ? AppTheme.textPrimary : _greyText,
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
    // То же, что у кнопки «Отправить» внизу мастера и у отправки.
    final allCompleted = provider.isReadyToSubmit;

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
              color: AppTheme.textPrimary,
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
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
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
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