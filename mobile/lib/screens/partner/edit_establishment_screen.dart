import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';

/// Edit Establishment Screen - menu with edit options
/// Figma design: Profile/Log In (Редактирование) frame
/// Phase 5.2b - Partner Dashboard
///
/// This screen shows a list of editable sections.
/// Each item navigates to the corresponding registration step screen.
class EditEstablishmentScreen extends StatefulWidget {
  final int establishmentId;

  const EditEstablishmentScreen({
    super.key,
    required this.establishmentId,
  });

  @override
  State<EditEstablishmentScreen> createState() => _EditEstablishmentScreenState();
}

class _EditEstablishmentScreenState extends State<EditEstablishmentScreen> {
  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFDB4F13);
  static const Color _greyText = Color(0xFFABABAB);
  static const Color _strokeGrey = Color(0xFFD2D2D2);

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

            if (establishment == null) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'Заведение не найдено',
                      style: TextStyle(
                        fontFamily: 'Avenir Next',
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
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'Редактирование',
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

  /// Build section title
  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Text(
        title,
        style: const TextStyle(
          fontFamily: 'Avenir Next',
          fontSize: 22,
          fontWeight: FontWeight.w500,
          color: Colors.black,
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
              color: isEnabled ? Colors.black : _greyText,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 15,
                  color: isEnabled ? Colors.black : _greyText,
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
    // Show info about which screen would open
    // In full implementation, this would navigate to the actual edit screens
    // reusing the partner registration step screens

    String screenName;
    String routeName;

    switch (section) {
      case 'contact':
        screenName = 'Ваши данные';
        routeName = '/partner/register'; // Step 1
        break;
      case 'category':
        screenName = 'Категория заведения';
        routeName = '/partner/register'; // Step 2
        break;
      case 'cuisine':
        screenName = 'Категория кухни';
        routeName = '/partner/register'; // Step 2
        break;
      case 'about':
        screenName = 'О заведении';
        routeName = '/partner/register'; // Step 2
        break;
      case 'media':
        screenName = 'Медиа';
        routeName = '/partner/register'; // Steps 5-6
        break;
      case 'hours':
        screenName = 'Время работы';
        // Navigate to working hours screen
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => _EditWorkingHoursWrapper(establishment: establishment),
          ),
        );
        return;
      case 'address':
        screenName = 'Адрес';
        routeName = '/partner/register'; // Step 3
        break;
      default:
        screenName = section;
        routeName = '/partner/register';
    }

    // For now, show a snackbar indicating the action
    // In full implementation, navigate to the specific step with edit mode
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Редактирование: $screenName'),
        behavior: SnackBarBehavior.floating,
        action: SnackBarAction(
          label: 'Перейти',
          textColor: _backgroundColor,
          onPressed: () {
            // Navigate to registration with edit mode
            Navigator.of(context).pushNamed(
              routeName,
              arguments: {'editMode': true, 'establishment': establishment, 'section': section},
            );
          },
        ),
      ),
    );
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
                  fontFamily: 'Avenir Next',
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: Colors.black,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Текущий статус: ${establishment.status.label}',
                style: const TextStyle(
                  fontFamily: 'Avenir Next',
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
              color: isDestructive ? Colors.red : Colors.black,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                      color: isDestructive ? Colors.red : Colors.black,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    description,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
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
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: _backgroundColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Приостановить заведение?',
          style: TextStyle(fontFamily: 'Avenir Next', fontWeight: FontWeight.w600),
        ),
        content: const Text(
          'Заведение будет скрыто от пользователей. Вы сможете возобновить его в любой момент.',
          style: TextStyle(fontFamily: 'Avenir Next'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text(
              'Отмена',
              style: TextStyle(fontFamily: 'Avenir Next', color: Colors.black54),
            ),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              // TODO: Call API to suspend establishment
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Заведение приостановлено'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
            child: const Text(
              'Приостановить',
              style: TextStyle(fontFamily: 'Avenir Next', color: _primaryOrange),
            ),
          ),
        ],
      ),
    );
  }

  /// Resume establishment
  void _resumeEstablishment(BuildContext context, PartnerEstablishment establishment) {
    // TODO: Call API to resume establishment
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Заявка на возобновление отправлена'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Show delete confirmation dialog
  void _showDeleteConfirmation(BuildContext context, PartnerEstablishment establishment) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: _backgroundColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Удалить заведение?',
          style: TextStyle(fontFamily: 'Avenir Next', fontWeight: FontWeight.w600),
        ),
        content: Text(
          'Вы уверены, что хотите удалить "${establishment.name}"? Это действие нельзя отменить.',
          style: const TextStyle(fontFamily: 'Avenir Next'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text(
              'Отмена',
              style: TextStyle(fontFamily: 'Avenir Next', color: Colors.black54),
            ),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              // TODO: Call API to delete establishment
              Navigator.of(context).pop(); // Go back to profile
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Заведение удалено'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text(
              'Удалить',
              style: TextStyle(fontFamily: 'Avenir Next'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Wrapper for editing working hours
/// Reuses the WorkingHoursScreen from registration
class _EditWorkingHoursWrapper extends StatelessWidget {
  final PartnerEstablishment establishment;

  const _EditWorkingHoursWrapper({required this.establishment});

  @override
  Widget build(BuildContext context) {
    // Navigate to working hours screen with existing data
    // In full implementation, this would pass the existing working hours
    // and handle saving back to the establishment

    return Scaffold(
      backgroundColor: const Color(0xFFF4F1EC),
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: const Icon(Icons.chevron_left, size: 28, color: Colors.black),
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Время работы',
                    style: TextStyle(
                      fontFamily: 'Unbounded',
                      fontSize: 25,
                      fontWeight: FontWeight.w400,
                      color: Color(0xFFDB4F13),
                    ),
                  ),
                ],
              ),
            ),

            // Content placeholder
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.access_time,
                        size: 64,
                        color: Color(0xFFABABAB),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Редактирование времени работы',
                        style: TextStyle(
                          fontFamily: 'Avenir Next',
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: Colors.black,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        establishment.workingHours != null
                            ? 'Текущее расписание установлено'
                            : 'Расписание не установлено',
                        style: const TextStyle(
                          fontFamily: 'Avenir Next',
                          fontSize: 14,
                          color: Color(0xFFABABAB),
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 24),
                      ElevatedButton(
                        onPressed: () {
                          // Navigate to the full working hours editor
                          Navigator.of(context).pushNamed('/partner/register/hours');
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFDB4F13),
                          foregroundColor: const Color(0xFFF4F1EC),
                          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(11),
                          ),
                        ),
                        child: const Text(
                          'Изменить расписание',
                          style: TextStyle(fontFamily: 'Avenir Next', fontSize: 16),
                        ),
                      ),
                    ],
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
