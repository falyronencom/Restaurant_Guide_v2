import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';
import 'package:restaurant_guide_mobile/widgets/partner_establishment_card.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Profile screen - main profile tab with settings
/// Figma design: Profile/Log In (first frame)
/// Updated Phase 5.2: Partner establishments section
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _secondaryOrange = AppTheme.primaryOrange;
  static const Color _navyBlue = AppTheme.accentNavy;
  static const Color _greyText = AppTheme.textGrey;

  @override
  void initState() {
    super.initState();
    // Load partner establishments if authenticated
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final authProvider = context.read<AuthProvider>();
      if (authProvider.isAuthenticated) {
        context.read<PartnerDashboardProvider>().initializeIfNeeded();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Consumer2<AuthProvider, PartnerDashboardProvider>(
          builder: (context, authProvider, partnerProvider, child) {
            // Trigger partner data load when user becomes authenticated
            if (authProvider.isAuthenticated &&
                !partnerProvider.isInitialized &&
                !partnerProvider.isLoading) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                partnerProvider.initializeIfNeeded();
              });
            }
            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 40),
                  // Title
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Text(
                      'Профиль',
                      style: TextStyle(
                        fontFamily: AppTheme.fontDisplayFamily,
                        fontSize: 25,
                        fontWeight: FontWeight.w400,
                        color: _primaryOrange,
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Profile card - tap to show detail
                  _buildProfileCard(context, authProvider),

                  const SizedBox(height: 24),

                  // Partner section (only for authenticated users)
                  if (authProvider.isAuthenticated)
                    _buildPartnerSection(context, partnerProvider),

                  const SizedBox(height: 24),

                  // Settings section
                  _buildSettingsSection(context, authProvider),

                  const SizedBox(height: 100), // Bottom padding for nav bar
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  /// Build profile card with avatar and name
  Widget _buildProfileCard(BuildContext context, AuthProvider authProvider) {
    final user = authProvider.currentUser;
    final isAuthenticated = authProvider.isAuthenticated;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: InkWell(
        onTap: () {
          if (isAuthenticated) {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (context) => const _ProfileDetailScreen(),
              ),
            );
          } else {
            // Use rootNavigator to navigate from nested tab Navigator
            Navigator.of(context, rootNavigator: true).pushNamed('/auth/login');
          }
        },
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: _greyText.withValues(alpha: 0.3),
                width: 1,
              ),
            ),
          ),
          child: Row(
            children: [
              // Avatar
              _buildAvatar(user?.fullAvatarUrl, user?.name ?? 'U', 30),
              const SizedBox(width: 16),
              // Name and subtitle
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isAuthenticated
                          ? (user?.name ?? 'Пользователь')
                          : 'Гость',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w500,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      isAuthenticated ? 'Показать профиль' : 'Войти в аккаунт',
                      style: const TextStyle(
                        fontSize: 14,
                        color: _greyText,
                      ),
                    ),
                  ],
                ),
              ),
              // Arrow
              const Icon(
                Icons.chevron_right,
                color: _greyText,
                size: 22,
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Build avatar widget
  Widget _buildAvatar(String? avatarUrl, String name, double radius) {
    if (avatarUrl != null && avatarUrl.isNotEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundImage: CachedNetworkImageProvider(avatarUrl),
      );
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: _navyBlue,
      child: Text(
        name.isNotEmpty ? name[0].toUpperCase() : '?',
        style: TextStyle(
          fontFamily: AppTheme.fontDisplayFamily,
          fontSize: radius * 0.8,
          color: _backgroundColor,
          fontWeight: FontWeight.w400,
        ),
      ),
    );
  }

  /// Build partner section
  /// Shows establishments if partner has any, otherwise shows "Add establishment" card
  Widget _buildPartnerSection(
    BuildContext context,
    PartnerDashboardProvider partnerProvider,
  ) {
    // If partner has establishments, show them
    if (partnerProvider.hasEstablishments) {
      return _buildEstablishmentsSection(context, partnerProvider);
    }

    // Otherwise show "Add establishment" card
    return _buildAddEstablishmentCard(context);
  }

  /// Build establishments section with cards
  Widget _buildEstablishmentsSection(
    BuildContext context,
    PartnerDashboardProvider partnerProvider,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section title
          const Text(
            'Основные заведения',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w500,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 16),

          // Loading state
          if (partnerProvider.isLoading)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: CircularProgressIndicator(color: _primaryOrange),
              ),
            )
          // Error state
          else if (partnerProvider.error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    const Text(
                      'Не удалось загрузить данные. Проверьте интернет-соединение.',
                      style: TextStyle(color: _greyText),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () => partnerProvider.refresh(),
                      child: const Text(
                        'Повторить',
                        style: TextStyle(color: _primaryOrange),
                      ),
                    ),
                  ],
                ),
              ),
            )
          // Establishments list
          else
            ...partnerProvider.establishments.map(
              (establishment) => Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: PartnerEstablishmentCard(
                  establishment: establishment,
                  onTap: () => _onEstablishmentTap(context, establishment),
                  onEditTap: () =>
                      _onEditEstablishmentTap(context, establishment),
                  onPromotionTap: () => _onPromotionTap(context, establishment),
                ),
              ),
            ),

          // Add establishment button
          const SizedBox(height: 8),
          _buildAddEstablishmentButton(context),
        ],
      ),
    );
  }

  /// Build "Add establishment" card for non-partners
  Widget _buildAddEstablishmentCard(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: InkWell(
        onTap: () {
          Navigator.of(context, rootNavigator: true)
              .pushNamed('/partner/register');
        },
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [_secondaryOrange, _primaryOrange],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            boxShadow: [
              BoxShadow(
                color: _primaryOrange.withValues(alpha: 0.2),
                blurRadius: 15,
                spreadRadius: 2,
                offset: const Offset(4, 4),
              ),
            ],
          ),
          child: const Text(
            'Разместить ваше\nзаведение',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w400,
              color: AppTheme.backgroundWarm,
              height: 1.1,
            ),
          ),
        ),
      ),
    );
  }

  /// Build "Add establishment" button for existing partners
  Widget _buildAddEstablishmentButton(BuildContext context) {
    return Center(
      child: InkWell(
        onTap: () {
          Navigator.of(context, rootNavigator: true)
              .pushNamed('/partner/register');
        },
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
          decoration: BoxDecoration(
            border: Border.all(color: _secondaryOrange, width: 1),
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          child: const Text(
            '+ Добавить заведение',
            style: TextStyle(
              fontSize: 15,
              color: AppTheme.textPrimary,
            ),
          ),
        ),
      ),
    );
  }

  /// Handle tap on establishment card
  void _onEstablishmentTap(
      BuildContext context, PartnerEstablishment establishment) {
    // Navigate to establishment statistics screen (Phase 5.2b)
    Navigator.of(context, rootNavigator: true)
        .pushNamed('/partner/statistics/${establishment.id}');
  }

  /// Handle tap on edit establishment
  void _onEditEstablishmentTap(
      BuildContext context, PartnerEstablishment establishment) {
    // Navigate to edit establishment screen (Phase 5.2b)
    Navigator.of(context, rootNavigator: true)
        .pushNamed('/partner/edit/${establishment.id}');
  }

  /// Handle tap on promotion button
  void _onPromotionTap(
      BuildContext context, PartnerEstablishment establishment) {
    // TODO: Navigate to promotion/subscription screen (future feature)
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Продвижение: ${establishment.name}'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Build settings section
  Widget _buildSettingsSection(
      BuildContext context, AuthProvider authProvider) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Настройки',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w500,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 16),

          // Notifications
          _buildSettingsItem(
            context,
            icon: Icons.notifications_outlined,
            title: 'Уведомления',
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Настройки уведомлений скоро будут доступны'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
          ),

          // Privacy policy
          _buildSettingsItem(
            context,
            icon: Icons.lock_outline,
            title: 'Политика конфиденциальности',
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Политика конфиденциальности'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
          ),

          // Support
          _buildSettingsItem(
            context,
            icon: Icons.help_outline,
            title: 'Связаться с тех. поддержкой',
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Поддержка: support@niriveo.by'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
          ),

          // Logout (only for authenticated users)
          if (authProvider.isAuthenticated)
            _buildSettingsItem(
              context,
              icon: Icons.logout,
              title: 'Выйти из профиля',
              onTap: () => _showLogoutConfirmation(context),
            ),
        ],
      ),
    );
  }

  /// Build settings item row
  Widget _buildSettingsItem(
    BuildContext context, {
    required IconData icon,
    required String title,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: _greyText.withValues(alpha: 0.3),
              width: 1,
            ),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 28, color: Colors.black87),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 15,
                  color: AppTheme.textPrimary,
                ),
              ),
            ),
            const Icon(
              Icons.chevron_right,
              color: _greyText,
              size: 22,
            ),
          ],
        ),
      ),
    );
  }

  /// Show logout confirmation dialog
  void _showLogoutConfirmation(BuildContext context) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: _backgroundColor,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
        ),
        title: const Text(
          'Выйти из аккаунта?',
          style: TextStyle(
            fontWeight: FontWeight.w600,
          ),
        ),
        content: const Text(
          'Вы уверены, что хотите выйти?',
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
              context.read<PartnerDashboardProvider>().reset();
              context.read<AuthProvider>().logout();
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
}

// =============================================================================
// Profile Detail Screen (Second Figma frame)
// =============================================================================

/// Profile detail screen - shows full profile with reviews
/// Figma design: Profile/Log In (second frame - personal cabinet)
class _ProfileDetailScreen extends StatefulWidget {
  const _ProfileDetailScreen();

  @override
  State<_ProfileDetailScreen> createState() => _ProfileDetailScreenState();
}

class _ProfileDetailScreenState extends State<_ProfileDetailScreen> {
  // Services
  final ReviewsService _reviewsService = ReviewsService();

  // State
  List<UserReview> _reviews = [];
  int _totalReviews = 0;
  bool _isLoading = true;
  String? _error;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _navyBlue = AppTheme.accentNavy;
  static const Color _greyText = AppTheme.textGrey;
  static const Color _greenRating = AppTheme.statusGreen;

  @override
  void initState() {
    super.initState();
    _loadUserReviews();
  }

  /// Load user's reviews
  Future<void> _loadUserReviews() async {
    final userId = context.read<AuthProvider>().currentUser?.id;
    if (userId == null) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await _reviewsService.getUserReviews(userId: userId);
      setState(() {
        _reviews = response.reviews;
        _totalReviews = response.total;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Не удалось загрузить отзывы';
        _isLoading = false;
      });
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
                // Header with back button
                _buildHeader(context),

                // Content
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _loadUserReviews,
                    color: _primaryOrange,
                    child: SingleChildScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Profile card
                          _buildProfileCard(context, user, authProvider),

                          const SizedBox(height: 24),

                          // Reviews section
                          _buildReviewsSection(),

                          const SizedBox(height: 100),
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

  /// Build header with back button and title
  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          // Back button
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(
              Icons.chevron_left,
              size: 28,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(width: 8),
          // Title
          Text(
            'Ваш профиль',
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

  /// Build profile card with stats
  Widget _buildProfileCard(
    BuildContext context,
    dynamic user,
    AuthProvider authProvider,
  ) {
    // Get favorites count from EstablishmentsProvider
    final favoritesCount =
        context.watch<EstablishmentsProvider>().favoriteEstablishments.length;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _backgroundColor,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          boxShadow: [
            BoxShadow(
              color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.08),
              blurRadius: 15,
              spreadRadius: 2,
              offset: const Offset(4, 4),
            ),
            BoxShadow(
              color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.08),
              blurRadius: 15,
              spreadRadius: 2,
              offset: const Offset(-4, -4),
            ),
          ],
        ),
        child: Column(
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Avatar
                _buildAvatar(user?.fullAvatarUrl, user?.name ?? 'U', 50),

                const SizedBox(width: 16),

                // Name and email
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.name ?? 'Пользователь',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w500,
                          color: AppTheme.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        user?.email ?? user?.phone ?? '',
                        style: const TextStyle(
                          fontSize: 14,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),

                // Stats
                Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text(
                      '$_totalReviews',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const Text(
                      'Отзывов',
                      style: TextStyle(
                        fontSize: 14,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      width: 50,
                      height: 1,
                      color: _greyText.withValues(alpha: 0.3),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '$favoritesCount',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const Text(
                      'В избранном',
                      style: TextStyle(
                        fontSize: 14,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 16),

            // Edit button
            Align(
              alignment: Alignment.centerRight,
              child: GestureDetector(
                onTap: () {
                  Navigator.of(context, rootNavigator: true)
                      .pushNamed('/profile/edit');
                },
                child: const Text(
                  'Редактировать',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.textPrimary,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Build avatar widget
  Widget _buildAvatar(String? avatarUrl, String name, double radius) {
    if (avatarUrl != null && avatarUrl.isNotEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundImage: CachedNetworkImageProvider(avatarUrl),
      );
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: _navyBlue,
      child: Text(
        name.isNotEmpty ? name[0].toUpperCase() : '?',
        style: TextStyle(
          fontFamily: AppTheme.fontDisplayFamily,
          fontSize: radius * 0.7,
          color: _backgroundColor,
          fontWeight: FontWeight.w400,
        ),
      ),
    );
  }

  /// Build reviews section
  Widget _buildReviewsSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Ваши отзывы',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w500,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 16),
          if (_isLoading)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: CircularProgressIndicator(color: _primaryOrange),
              ),
            )
          else if (_error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  children: [
                    Text(
                      _error!,
                      style: const TextStyle(color: _greyText),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: _loadUserReviews,
                      child: const Text(
                        'Повторить',
                        style: TextStyle(color: _primaryOrange),
                      ),
                    ),
                  ],
                ),
              ),
            )
          else if (_reviews.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'У вас пока нет отзывов',
                  style: TextStyle(
                    fontSize: 16,
                    color: _greyText,
                  ),
                ),
              ),
            )
          else
            ...List.generate(
              _reviews.length,
              (index) => Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: _buildReviewCard(_reviews[index]),
              ),
            ),
        ],
      ),
    );
  }

  /// Build review card (Figma style)
  Widget _buildReviewCard(UserReview review) {
    return GestureDetector(
      onTap: () {
        Navigator.of(context, rootNavigator: true)
            .pushNamed('/establishment/${review.establishmentId}');
      },
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: AppTheme.strokeGrey),
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Establishment image
                ClipOval(
                  child: review.establishmentImage != null
                      ? CachedNetworkImage(
                          imageUrl: review.establishmentImage!,
                          width: 59,
                          height: 59,
                          fit: BoxFit.cover,
                          placeholder: (context, url) => Container(
                            width: 59,
                            height: 59,
                            color: _greyText.withValues(alpha: 0.3),
                          ),
                          errorWidget: (context, url, error) => Container(
                            width: 59,
                            height: 59,
                            color: _greyText.withValues(alpha: 0.3),
                            child: const Icon(Icons.restaurant),
                          ),
                        )
                      : Container(
                          width: 59,
                          height: 59,
                          color: _greyText.withValues(alpha: 0.3),
                          child: const Icon(Icons.restaurant),
                        ),
                ),
                const SizedBox(width: 12),

                // Establishment info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        review.establishmentName,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: AppTheme.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (review.establishmentType != null)
                        Text(
                          review.establishmentType!,
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      if (review.establishmentCuisine != null)
                        Text(
                          '{${review.establishmentCuisine}}',
                          style: const TextStyle(
                            fontSize: 13,
                            color: _greyText,
                          ),
                        ),
                    ],
                  ),
                ),

                // Rating badge
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      width: 31,
                      height: 31,
                      decoration: BoxDecoration(
                        color: _greenRating,
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusSmall),
                      ),
                      child: Center(
                        child: Text(
                          review.rating.toStringAsFixed(1).replaceAll('.', ','),
                          style: const TextStyle(
                            fontSize: 16,
                            color: AppTheme.backgroundWarm,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Ваша оценка',
                      style: TextStyle(
                        fontSize: 13,
                        color: _greyText,
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 8),

            // Date
            Text(
              '– ${_formatRelativeDate(review.createdAt)}',
              style: const TextStyle(
                fontSize: 13,
                color: AppTheme.textPrimary,
              ),
            ),

            const SizedBox(height: 8),

            // Review text
            if (review.text != null && review.text!.isNotEmpty)
              Text(
                review.text!,
                style: const TextStyle(
                  fontSize: 15,
                  color: AppTheme.textPrimary,
                  height: 1.3,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
      ),
    );
  }

  /// Format date as relative time
  String _formatRelativeDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);

    if (difference.inDays < 1) {
      return 'сегодня';
    } else if (difference.inDays < 2) {
      return 'вчера';
    } else if (difference.inDays < 7) {
      return '${difference.inDays} дней назад';
    } else if (difference.inDays < 30) {
      final weeks = (difference.inDays / 7).floor();
      return '$weeks нед. назад';
    } else if (difference.inDays < 365) {
      final months = (difference.inDays / 30).floor();
      return '$months мес. назад';
    } else {
      final years = (difference.inDays / 365).floor();
      return '$years год назад';
    }
  }
}
