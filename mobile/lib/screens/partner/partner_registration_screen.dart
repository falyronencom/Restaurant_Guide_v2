import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/category_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/cuisine_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/basic_info_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/media_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/address_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/legal_info_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/summary_step.dart';

/// Partner Registration Wizard Screen
/// 6-step wizard for registering establishment on the platform
/// Phase 5.1 - Partner Registration Flow
class PartnerRegistrationScreen extends StatefulWidget {
  final int initialStep;
  final bool editMode;
  final PartnerRegistration? initialData;
  final String? establishmentId;

  const PartnerRegistrationScreen({
    super.key,
    this.initialStep = 0,
    this.editMode = false,
    this.initialData,
    this.establishmentId,
  });

  @override
  State<PartnerRegistrationScreen> createState() =>
      _PartnerRegistrationScreenState();
}

class _PartnerRegistrationScreenState extends State<PartnerRegistrationScreen> {
  late PageController _pageController;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _greyStroke = AppTheme.strokeGrey;

  @override
  void initState() {
    super.initState();
    _pageController = PageController(initialPage: widget.initialStep);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => PartnerRegistrationProvider(
        initialStep: widget.initialStep,
        editMode: widget.editMode,
        initialData: widget.initialData,
        establishmentId: widget.establishmentId,
      ),
      child: Consumer<PartnerRegistrationProvider>(
        builder: (context, provider, child) {
          return Scaffold(
            backgroundColor: _backgroundColor,
            body: SafeArea(
              child: Column(
                children: [
                  // Header with back button and title
                  _buildHeader(context, provider),

                  // Step content
                  Expanded(
                    child: PageView(
                      controller: _pageController,
                      physics: const NeverScrollableScrollPhysics(),
                      onPageChanged: (index) {
                        // Sync provider if page changes externally
                      },
                      children: [
                        // Step 1: Category
                        const CategoryStep(),
                        // Step 2: Cuisine
                        const CuisineStep(),
                        // Step 3: Basic Info
                        const BasicInfoStep(),
                        // Step 4: Media
                        const MediaStep(),
                        // Step 5: Address
                        const AddressStep(),
                        // Step 6: Legal Info
                        const LegalInfoStep(),
                        // Step 7: Summary
                        SummaryStep(onSubmit: () => _handleSubmit(provider)),
                      ],
                    ),
                  ),

                  // Bottom navigation (hidden on summary step)
                  if (!provider.isLastStep)
                    _buildBottomNavigation(context, provider),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  /// Build header with back button and title
  Widget _buildHeader(BuildContext context, PartnerRegistrationProvider provider) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          // Back button
          GestureDetector(
            onTap: () => _handleBackPress(context, provider),
            child: const Icon(
              Icons.chevron_left,
              size: 28,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          // Title
          Text(
            'Ваше заведение',
            style: TextStyle(
              fontFamily: AppTheme.fontDisplayFamily,
              fontSize: 25,
              fontWeight: FontWeight.w400,
              color: _primaryOrange,
            ),
          ),
        ],
      ),
    );
  }

  /// Handle back button press
  void _handleBackPress(BuildContext context, PartnerRegistrationProvider provider) {
    if (provider.editMode) {
      Navigator.of(context).pop();
      return;
    }
    if (provider.isFirstStep) {
      // Show confirmation dialog if there's data
      if (provider.data.categories.isNotEmpty ||
          provider.data.cuisineTypes.isNotEmpty) {
        _showExitConfirmation(context);
      } else {
        Navigator.of(context).pop();
      }
    } else {
      provider.previousStep();
      _animateToPage(provider.currentStep);
    }
  }

  /// Show exit confirmation dialog
  void _showExitConfirmation(BuildContext context) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: _backgroundColor,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
        ),
        title: const Text(
          'Выйти из регистрации?',
          style: TextStyle(
            fontWeight: FontWeight.w600,
          ),
        ),
        content: const Text(
          'Введённые данные будут потеряны.',
          style: TextStyle(),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text(
              'Отмена',
              style: TextStyle(
                color: Colors.black54,
              ),
            ),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              Navigator.of(context).pop();
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text(
              'Выйти',
              style: TextStyle(),
            ),
          ),
        ],
      ),
    );
  }

  /// Build bottom navigation with Back/Next buttons
  Widget _buildBottomNavigation(
    BuildContext context,
    PartnerRegistrationProvider provider,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.white.withValues(alpha: 0),
            AppTheme.primaryOrange.withValues(alpha: 0.15),
          ],
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Back button (hidden on first step)
          if (!provider.isFirstStep)
            _buildBackButton(provider)
          else
            const SizedBox(width: 96),

          // Next/Submit button
          _buildNextButton(provider),
        ],
      ),
    );
  }

  /// Build back button
  Widget _buildBackButton(PartnerRegistrationProvider provider) {
    return GestureDetector(
      onTap: () {
        if (provider.editMode) {
          Navigator.of(context).pop();
          return;
        }
        provider.previousStep();
        _animateToPage(provider.currentStep);
      },
      child: Container(
        height: 42,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          border: Border.all(color: _greyStroke),
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.chevron_left,
              size: 25,
              color: _greyStroke,
            ),
            SizedBox(width: 4),
            Text(
              'Назад',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: _greyStroke,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Build next/submit button
  Widget _buildNextButton(PartnerRegistrationProvider provider) {
    final canProceed = provider.canProceed();
    final isLastStep = provider.isLastStep;
    final isEditMode = provider.editMode;

    // Determine button text
    final String buttonText;
    if (isEditMode) {
      buttonText = 'Сохранить';
    } else if (isLastStep) {
      buttonText = 'Отправить';
    } else {
      buttonText = 'Продолжить';
    }

    return GestureDetector(
      onTap: canProceed
          ? () {
              if (isEditMode) {
                _handleSave(provider);
              } else if (isLastStep) {
                _handleSubmit(provider);
              } else {
                provider.nextStep();
                _animateToPage(provider.currentStep);
              }
            }
          : null,
      child: Container(
        height: 42,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: canProceed ? Colors.black : Colors.black.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              buttonText,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: _backgroundColor,
              ),
            ),
            if (!isEditMode) ...[
              const SizedBox(width: 4),
              const Icon(
                Icons.chevron_right,
                size: 25,
                color: _backgroundColor,
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Handle save in edit mode — send PUT and return to edit menu
  Future<void> _handleSave(PartnerRegistrationProvider provider) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    final success = await provider.saveChanges();

    if (success && mounted) {
      // Reload dashboard list and selected establishment details
      final dashboardProvider = context.read<PartnerDashboardProvider>();
      await dashboardProvider.loadEstablishments();
      if (provider.establishmentId != null) {
        await dashboardProvider.loadEstablishmentDetails(provider.establishmentId!);
      }

      scaffoldMessenger.showSnackBar(
        const SnackBar(
          content: Text('Изменения сохранены'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppTheme.statusGreen,
        ),
      );
      navigator.pop();
    } else if (mounted && provider.error != null) {
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(provider.error!),
          behavior: SnackBarBehavior.floating,
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  /// Handle form submission
  Future<void> _handleSubmit(PartnerRegistrationProvider provider) async {
    debugPrint('SUBMIT: Starting submission...');

    // Capture references before async gap
    final authProvider = context.read<AuthProvider>();
    final partnerDashboardProvider = context.read<PartnerDashboardProvider>();
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    final success = await provider.submit();
    debugPrint('SUBMIT: Creation result: $success');

    if (success && mounted) {
      // Step 1: Update user role in AuthProvider (fast, no network call)
      await authProvider.updateUserRole('partner');
      debugPrint('SUBMIT: Role updated to partner');

      // Step 2: Reset and reload partner dashboard to show new establishment
      partnerDashboardProvider.reset();
      await partnerDashboardProvider.loadEstablishments();
      debugPrint('SUBMIT: Partner dashboard reloaded');

      // Step 3: Show success message
      scaffoldMessenger.showSnackBar(
        const SnackBar(
          content: Text('Заведение успешно создано!'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppTheme.statusGreen,
        ),
      );

      // Step 4: Navigate back to profile
      debugPrint('SUBMIT: Navigating back...');
      navigator.pop();
    } else if (mounted && provider.error != null) {
      debugPrint('SUBMIT: Error - ${provider.error}');
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(provider.error!),
          behavior: SnackBarBehavior.floating,
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  /// Animate PageView to specific page
  void _animateToPage(int page) {
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }

}
