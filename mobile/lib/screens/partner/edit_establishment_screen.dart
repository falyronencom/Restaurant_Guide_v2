import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_registration_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/working_hours_screen.dart';

/// Edit Establishment Screen - menu with edit options
/// Figma design: Profile/Log In (Редактирование) frame
/// Phase 5.2b - Partner Dashboard
///
/// This screen shows a list of editable sections.
/// Each item navigates to the corresponding registration step screen.
class EditEstablishmentScreen extends StatefulWidget {
  final String establishmentId;

  const EditEstablishmentScreen({
    super.key,
    required this.establishmentId,
  });

  @override
  State<EditEstablishmentScreen> createState() => _EditEstablishmentScreenState();
}

class _EditEstablishmentScreenState extends State<EditEstablishmentScreen> {
  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _greyText = AppTheme.textGrey;
  static const Color _strokeGrey = AppTheme.strokeGrey;

  @override
  void initState() {
    super.initState();
    // Ensure establishment details are loaded
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PartnerDashboardProvider>().loadEstablishmentDetails(widget.establishmentId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Consumer<PartnerDashboardProvider>(
          builder: (context, provider, child) {
            final establishment = provider.selectedEstablishment ??
                provider.establishments.where((e) => e.id == widget.establishmentId).firstOrNull;

            if (provider.isLoadingDetails) {
              return const Center(
                child: CircularProgressIndicator(color: _primaryOrange),
              );
            }

            if (provider.detailsError != null) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.error_outline,
                        size: 64,
                        color: _greyText.withValues(alpha: 0.5),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Не удалось загрузить данные',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Проверьте интернет-соединение и попробуйте снова.',
                        style: TextStyle(
                          fontSize: 14,
                          color: _greyText,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 24),
                      GestureDetector(
                        onTap: () => provider.loadEstablishmentDetails(widget.establishmentId),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          decoration: BoxDecoration(
                            color: _primaryOrange,
                            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                          ),
                          child: const Text(
                            'Повторить',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w500,
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

            if (establishment == null) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'Заведение не найдено',
                      style: TextStyle(
                        fontSize: 16,
                        color: _greyText,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text(
                        'Назад',
                        style: TextStyle(color: _primaryOrange),
                      ),
                    ),
                  ],
                ),
              );
            }

            // Check if establishment can be edited
            final canEdit = establishment.status.canEdit;

            return Column(
              children: [
                // Header
                _buildHeader(context),

                // Content
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Information section
                        _buildSectionTitle('Информация'),
                        const SizedBox(height: 8),
                        _buildEditMenu(context, establishment, canEdit),

                        const SizedBox(height: 32),

                        // Status section
                        _buildSectionTitle('Статус заведения'),
                        const SizedBox(height: 8),
                        _buildStatusMenu(context, establishment),

                        const SizedBox(height: 100),
                      ],
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

  /// Build header with back button and title
  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(
              Icons.chevron_left,
              size: 28,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            'Редактирование',
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

  /// Build section title
  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w500,
          color: AppTheme.textPrimary,
        ),
      ),
    );
  }

  /// Build edit menu items
  Widget _buildEditMenu(BuildContext context, PartnerEstablishment establishment, bool canEdit) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        children: [
          _buildMenuItem(
            icon: Icons.document_scanner_outlined,
            title: 'Ваши данные',
            onTap: canEdit ? () => _navigateToEditStep(context, 'contact', establishment) : null,
          ),
          _buildMenuItem(
            icon: Icons.local_cafe_outlined,
            title: 'Категория заведения',
            onTap: canEdit ? () => _navigateToEditStep(context, 'category', establishment) : null,
          ),
          _buildMenuItem(
            icon: Icons.restaurant_outlined,
            title: 'Категория кухни',
            onTap: canEdit ? () => _navigateToEditStep(context, 'cuisine', establishment) : null,
          ),
          _buildMenuItem(
            icon: Icons.notifications_outlined,
            title: 'О заведении',
            onTap: canEdit ? () => _navigateToEditStep(context, 'about', establishment) : null,
          ),
          _buildMenuItem(
            icon: Icons.photo_library_outlined,
            title: 'Медиа',
            onTap: canEdit ? () => _navigateToEditStep(context, 'media', establishment) : null,
          ),
          _buildMenuItem(
            icon: Icons.access_time,
            title: 'Время работы',
            onTap: canEdit ? () => _navigateToEditStep(context, 'hours', establishment) : null,
          ),
          _buildMenuItem(
            icon: Icons.map_outlined,
            title: 'Адрес',
            onTap: canEdit ? () => _navigateToEditStep(context, 'address', establishment) : null,
            showDivider: false,
          ),
        ],
      ),
    );
  }

  /// Build status menu items
  Widget _buildStatusMenu(BuildContext context, PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        children: [
          _buildMenuItem(
            icon: Icons.block,
            title: 'Приостановить или удалить',
            onTap: () => _showStatusOptions(context, establishment),
            showDivider: false,
          ),
        ],
      ),
    );
  }

  /// Build menu item row
  Widget _buildMenuItem({
    required IconData icon,
    required String title,
    VoidCallback? onTap,
    bool showDivider = true,
  }) {
    final isEnabled = onTap != null;

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: showDivider
            ? BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: _strokeGrey.withValues(alpha: 0.5),
                    width: 1,
                  ),
                ),
              )
            : null,
        child: Row(
          children: [
            Icon(
              icon,
              size: 26,
              color: isEnabled ? AppTheme.textPrimary : _greyText,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontSize: 15,
                  color: isEnabled ? AppTheme.textPrimary : _greyText,
                ),
              ),
            ),
            Icon(
              Icons.chevron_right,
              size: 22,
              color: isEnabled ? Colors.black54 : _greyText,
            ),
          ],
        ),
      ),
    );
  }

  /// Navigate to edit step screen
  void _navigateToEditStep(BuildContext context, String section, PartnerEstablishment establishment) {
    // Map section to registration step index
    // Steps: 0=Category, 1=Cuisine, 2=BasicInfo, 3=Media, 4=Address, 5=Legal, 6=Summary
    int stepIndex;

    switch (section) {
      case 'category':
        stepIndex = 0;
        break;
      case 'cuisine':
        stepIndex = 1;
        break;
      case 'about':
        stepIndex = 2;
        break;
      case 'contact':
        stepIndex = 5;
        break;
      case 'media':
        stepIndex = 3;
        break;
      case 'hours':
        // Navigate to working hours screen and save result via PUT
        _editWorkingHours(context, establishment);
        return;
      case 'address':
        stepIndex = 4;
        break;
      default:
        stepIndex = 0;
    }

    final initialData = PartnerRegistrationProvider.dataFromEstablishment(establishment);

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => PartnerRegistrationScreen(
          initialStep: stepIndex,
          editMode: true,
          initialData: initialData,
          establishmentId: establishment.id,
        ),
      ),
    );
  }

  /// Edit working hours: open screen, capture result, save via PUT
  Future<void> _editWorkingHours(BuildContext context, PartnerEstablishment establishment) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    final dashboardProvider = context.read<PartnerDashboardProvider>();

    final result = await Navigator.of(context).push<WeeklyWorkingHours>(
      MaterialPageRoute(
        builder: (context) => WorkingHoursScreen(
          initialHours: establishment.workingHours ?? const WeeklyWorkingHours(),
        ),
      ),
    );

    if (result != null && mounted) {
      final success = await dashboardProvider.updateEstablishment(
        establishment.id,
        {'working_hours': result.toJson()},
      );

      if (mounted) {
        if (success) {
          scaffoldMessenger.showSnackBar(
            const SnackBar(
              content: Text('Время работы сохранено'),
              behavior: SnackBarBehavior.floating,
              backgroundColor: AppTheme.statusGreen,
            ),
          );
        } else {
          scaffoldMessenger.showSnackBar(
            SnackBar(
              content: Text(dashboardProvider.error ?? 'Ошибка сохранения'),
              behavior: SnackBarBehavior.floating,
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    }
  }

  /// Show status options dialog
  void _showStatusOptions(BuildContext context, PartnerEstablishment establishment) {
    showModalBottomSheet(
      context: context,
      backgroundColor: _backgroundColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Статус заведения',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Текущий статус: ${establishment.status.label}',
                style: const TextStyle(
                  fontSize: 14,
                  color: _greyText,
                ),
              ),
              const SizedBox(height: 24),

              // Suspend option
              if (establishment.status == EstablishmentStatus.approved)
                _buildStatusOption(
                  context,
                  icon: Icons.pause_circle_outline,
                  title: 'Приостановить',
                  description: 'Заведение будет скрыто от пользователей',
                  onTap: () {
                    Navigator.pop(context);
                    _showSuspendConfirmation(context, establishment);
                  },
                ),

              // Resume option
              if (establishment.status == EstablishmentStatus.suspended)
                _buildStatusOption(
                  context,
                  icon: Icons.play_circle_outline,
                  title: 'Возобновить',
                  description: 'Заведение снова станет видимым',
                  onTap: () {
                    Navigator.pop(context);
                    _resumeEstablishment(context, establishment);
                  },
                ),

              const SizedBox(height: 8),

              // Delete option
              _buildStatusOption(
                context,
                icon: Icons.delete_outline,
                title: 'Удалить заведение',
                description: 'Это действие нельзя отменить',
                isDestructive: true,
                onTap: () {
                  Navigator.pop(context);
                  _showDeleteConfirmation(context, establishment);
                },
              ),

              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  /// Build status option item
  Widget _buildStatusOption(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String description,
    required VoidCallback onTap,
    bool isDestructive = false,
  }) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            Icon(
              icon,
              size: 28,
              color: isDestructive ? Colors.red : AppTheme.textPrimary,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                      color: isDestructive ? Colors.red : AppTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    description,
                    style: const TextStyle(
                      fontSize: 13,
                      color: _greyText,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Show suspend confirmation dialog
  void _showSuspendConfirmation(BuildContext context, PartnerEstablishment establishment) {
    final provider = context.read<PartnerDashboardProvider>();
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: _backgroundColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusLarge)),
        title: const Text(
          'Приостановить заведение?',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        content: const Text(
          'Заведение будет скрыто от пользователей. Вы сможете возобновить его в любой момент.',
          style: TextStyle(),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text(
              'Отмена',
              style: TextStyle(color: Colors.black54),
            ),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(dialogContext);
              final success = await provider.suspendEstablishment(establishment.id);
              if (success) {
                navigator.pop(); // Go back to profile
                messenger.showSnackBar(
                  const SnackBar(
                    content: Text('Заведение приостановлено'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              } else {
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(provider.error ?? 'Ошибка приостановки'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }
            },
            child: const Text(
              'Приостановить',
              style: TextStyle(color: _primaryOrange),
            ),
          ),
        ],
      ),
    );
  }

  /// Resume establishment
  void _resumeEstablishment(BuildContext context, PartnerEstablishment establishment) async {
    final provider = context.read<PartnerDashboardProvider>();
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final success = await provider.resumeEstablishment(establishment.id);
    if (success) {
      navigator.pop(); // Go back to profile
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Заявка на возобновление отправлена'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } else {
      messenger.showSnackBar(
        SnackBar(
          content: Text(provider.error ?? 'Ошибка возобновления'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// Show delete confirmation dialog
  void _showDeleteConfirmation(BuildContext context, PartnerEstablishment establishment) {
    final provider = context.read<PartnerDashboardProvider>();
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: _backgroundColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusLarge)),
        title: const Text(
          'Удалить заведение?',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        content: Text(
          'Вы уверены, что хотите удалить "${establishment.name}"? Это действие нельзя отменить.',
          style: const TextStyle(),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text(
              'Отмена',
              style: TextStyle(color: Colors.black54),
            ),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(dialogContext);
              final success = await provider.deleteEstablishment(establishment.id);
              if (success) {
                navigator.pop(); // Go back to profile
                messenger.showSnackBar(
                  const SnackBar(
                    content: Text('Заведение удалено'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              } else {
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(provider.error ?? 'Ошибка удаления'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text(
              'Удалить',
              style: TextStyle(),
            ),
          ),
        ],
      ),
    );
  }
}