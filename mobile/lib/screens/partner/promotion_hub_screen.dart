import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/promotions_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/booking_wizard_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/bookings_management_screen.dart';

/// Hub screen replacing direct navigation to PromotionsScreen.
/// Two sections: Акции (promotions) and Бронирование (bookings).
class PromotionHubScreen extends StatefulWidget {
  final String establishmentId;
  final String establishmentName;

  const PromotionHubScreen({
    super.key,
    required this.establishmentId,
    required this.establishmentName,
  });

  @override
  State<PromotionHubScreen> createState() => _PromotionHubScreenState();
}

class _PromotionHubScreenState extends State<PromotionHubScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context
          .read<PromotionProvider>()
          .fetchPromotions(widget.establishmentId);
      context
          .read<BookingSettingsProvider>()
          .loadSettings(widget.establishmentId);
    });
  }

  void _reloadBookingState() {
    context
        .read<BookingSettingsProvider>()
        .loadSettings(widget.establishmentId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: AppBar(
        title: const Text('Продвижение'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildPromotionsSection(),
            const SizedBox(height: 24),
            _buildBookingSection(),
          ],
        ),
      ),
    );
  }

  // =========================================================================
  // Promotions Section
  // =========================================================================

  Widget _buildPromotionsSection() {
    return Consumer<PromotionProvider>(
      builder: (context, provider, _) {
        final activeCount = provider.activeCount;

        return _buildSectionCard(
          icon: Icons.local_offer,
          iconColor: AppTheme.primaryOrange,
          title: 'Акции',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: activeCount > 0
                          ? AppTheme.successGreen.withValues(alpha: 0.1)
                          : AppTheme.gray100,
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusSmall),
                    ),
                    child: Text(
                      'Активных: $activeCount/3',
                      style: TextStyle(
                        color: activeCount > 0
                            ? AppTheme.successGreen
                            : AppTheme.gray500,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () {
                    Navigator.of(context, rootNavigator: true).push(
                      MaterialPageRoute(
                        builder: (context) => PromotionsScreen(
                          establishmentId: widget.establishmentId,
                          establishmentName: widget.establishmentName,
                        ),
                      ),
                    );
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.primaryOrange,
                    side: const BorderSide(color: AppTheme.primaryOrange),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusSmall),
                    ),
                  ),
                  child: const Text('Управление акциями →'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  // =========================================================================
  // Booking Section
  // =========================================================================

  Widget _buildBookingSection() {
    return Consumer2<BookingSettingsProvider, BookingProvider>(
      builder: (context, settingsProvider, bookingProvider, _) {
        if (settingsProvider.isLoading) {
          return _buildSectionCard(
            icon: Icons.calendar_today,
            iconColor: AppTheme.primaryOrange,
            title: 'Бронирование',
            child: const Center(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: CircularProgressIndicator(),
              ),
            ),
          );
        }

        final isActivated = settingsProvider.isActivated;

        if (!isActivated) {
          return _buildBookingInvitation();
        }

        return _buildBookingActive(bookingProvider);
      },
    );
  }

  Widget _buildBookingInvitation() {
    return _buildSectionCard(
      icon: Icons.calendar_today,
      iconColor: AppTheme.gray500,
      title: 'Бронирование',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Принимайте онлайн-бронирования от гостей прямо в приложении. '
            'Управляйте расписанием и подтверждайте брони в пару нажатий.',
            style: TextStyle(fontSize: 14, color: AppTheme.gray600),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _navigateToWizard,
              icon: const Icon(Icons.add, size: 20),
              label: const Text('Подключить'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryOrange,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(AppTheme.radiusSmall),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBookingActive(BookingProvider bookingProvider) {
    // Load bookings if not loaded yet
    if (!bookingProvider.isLoading &&
        bookingProvider.pendingBookings.isEmpty &&
        bookingProvider.confirmedBookings.isEmpty &&
        bookingProvider.historyBookings.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        bookingProvider.loadPartnerBookings(widget.establishmentId);
      });
    }

    return _buildSectionCard(
      icon: Icons.calendar_today,
      iconColor: AppTheme.successGreen,
      title: 'Бронирование',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Counts
          Row(
            children: [
              _buildCountBadge(
                'Новых',
                bookingProvider.pendingCount,
                AppTheme.primaryOrange,
              ),
              const SizedBox(width: 12),
              _buildCountBadge(
                'Подтверждённых',
                bookingProvider.confirmedCount,
                AppTheme.successGreen,
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Management button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _navigateToManagement,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryOrange,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(AppTheme.radiusSmall),
                ),
              ),
              child: const Text('Управление →'),
            ),
          ),

          const SizedBox(height: 8),

          // Settings link
          Center(
            child: TextButton(
              onPressed: _navigateToWizard,
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.gray600,
                textStyle: const TextStyle(fontSize: 14),
              ),
              child: const Text('Настройки'),
            ),
          ),
        ],
      ),
    );
  }

  // =========================================================================
  // Shared Widgets
  // =========================================================================

  Widget _buildSectionCard({
    required IconData icon,
    required Color iconColor,
    required String title,
    required Widget child,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: iconColor, size: 22),
              const SizedBox(width: 10),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }

  Widget _buildCountBadge(String label, int count, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Text(
        '$label: $count',
        style: TextStyle(
          color: color,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  // =========================================================================
  // Navigation
  // =========================================================================

  void _navigateToWizard() async {
    final result = await Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute(
        builder: (context) => BookingWizardScreen(
          establishmentId: widget.establishmentId,
          establishmentName: widget.establishmentName,
        ),
      ),
    );

    if (result == true && mounted) {
      _reloadBookingState();
    }
  }

  void _navigateToManagement() {
    Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute(
        builder: (context) => BookingsManagementScreen(
          establishmentId: widget.establishmentId,
          establishmentName: widget.establishmentName,
        ),
      ),
    );
  }
}
