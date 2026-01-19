import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/category_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/cuisine_step.dart';

/// Partner Registration Wizard Screen
/// 6-step wizard for registering establishment on the platform
/// Phase 5.1 - Partner Registration Flow
class PartnerRegistrationScreen extends StatefulWidget {
  const PartnerRegistrationScreen({super.key});

  @override
  State<PartnerRegistrationScreen> createState() =>
      _PartnerRegistrationScreenState();
}

class _PartnerRegistrationScreenState extends State<PartnerRegistrationScreen> {
  late PageController _pageController;

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFDB4F13);
  static const Color _greyStroke = Color(0xFFD2D2D2);

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => PartnerRegistrationProvider(),
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
                        // Step 3: Basic Info (Phase 5.1b)
                        _buildPlaceholderStep('Основная информация', 3),
                        // Step 4: Media (Phase 5.1b)
                        _buildPlaceholderStep('Медиа', 4),
                        // Step 5: Address (Phase 5.1c)
                        _buildPlaceholderStep('Адрес', 5),
                        // Step 6: Legal Info (Phase 5.1c)
                        _buildPlaceholderStep('Юридическая информация', 6),
                      ],
                    ),
                  ),

                  // Bottom navigation
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
          const Text(
            'Ваше заведение',
            style: TextStyle(
              fontFamily: 'Unbounded',
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
          borderRadius: BorderRadius.circular(16),
        ),
        title: const Text(
          'Выйти из регистрации?',
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontWeight: FontWeight.w600,
          ),
        ),
        content: const Text(
          'Введённые данные будут потеряны.',
          style: TextStyle(fontFamily: 'Avenir Next'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text(
              'Отмена',
              style: TextStyle(
                fontFamily: 'Avenir Next',
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
              style: TextStyle(fontFamily: 'Avenir Next'),
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
            const Color(0xFFC8714B).withValues(alpha: 0.15),
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
        provider.previousStep();
        _animateToPage(provider.currentStep);
      },
      child: Container(
        height: 42,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          border: Border.all(color: _greyStroke),
          borderRadius: BorderRadius.circular(8),
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
                fontFamily: 'Avenir Next',
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

    return GestureDetector(
      onTap: canProceed
          ? () {
              if (isLastStep) {
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
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              isLastStep ? 'Отправить' : 'Продолжить',
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: _backgroundColor,
              ),
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_right,
              size: 25,
              color: _backgroundColor,
            ),
          ],
        ),
      ),
    );
  }

  /// Handle form submission
  Future<void> _handleSubmit(PartnerRegistrationProvider provider) async {
    final success = await provider.submit();

    if (success && mounted) {
      // Show success message and navigate back
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Заявка успешно отправлена!'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: Color(0xFF34C759),
        ),
      );
      Navigator.of(context).pop();
    } else if (mounted && provider.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
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

  /// Build placeholder for steps not yet implemented
  Widget _buildPlaceholderStep(String title, int stepNumber) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.construction,
            size: 64,
            color: _greyStroke,
          ),
          const SizedBox(height: 16),
          Text(
            'Шаг $stepNumber: $title',
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 20,
              fontWeight: FontWeight.w500,
              color: Colors.black,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Будет реализован в следующей сессии',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 15,
              color: _greyStroke,
            ),
          ),
        ],
      ),
    );
  }
}
