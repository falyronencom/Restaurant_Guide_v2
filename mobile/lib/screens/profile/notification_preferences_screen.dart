import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';

/// Screen for managing push notification preferences.
///
/// Three toggle switches per category:
/// - Бронирование (booking)
/// - Отзывы и заведения (reviews)
/// - Акции из избранного (promotions)
class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends State<NotificationPreferencesScreen> {
  @override
  void initState() {
    super.initState();
    // Fetch preferences on screen open
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<NotificationPreferencesProvider>().ensureLoaded();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Настройки уведомлений'),
        backgroundColor: Colors.white,
        foregroundColor: AppTheme.textPrimary,
        elevation: 0,
      ),
      backgroundColor: Colors.white,
      body: Consumer<NotificationPreferencesProvider>(
        builder: (context, prefs, _) {
          if (prefs.isLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          return ListView(
            padding: const EdgeInsets.symmetric(vertical: 16),
            children: [
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'Push-уведомления',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ),
              const SizedBox(height: 8),

              // Booking notifications
              SwitchListTile(
                title: const Text(
                  'Бронирование',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textPrimary,
                  ),
                ),
                subtitle: const Text(
                  'Новые заявки, подтверждения, отмены',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                  ),
                ),
                value: prefs.bookingPushEnabled,
                activeTrackColor: AppTheme.primaryOrange.withValues(alpha: 0.5),
                activeThumbColor: AppTheme.primaryOrange,
                onChanged: (value) => _toggleBooking(prefs, value),
              ),

              const Divider(height: 1, indent: 16, endIndent: 16),

              // Reviews & establishments
              SwitchListTile(
                title: const Text(
                  'Отзывы и заведения',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textPrimary,
                  ),
                ),
                subtitle: const Text(
                  'Новые отзывы, ответы, модерация',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                  ),
                ),
                value: prefs.reviewsPushEnabled,
                activeTrackColor: AppTheme.primaryOrange.withValues(alpha: 0.5),
                activeThumbColor: AppTheme.primaryOrange,
                onChanged: (value) {
                  prefs.updatePreferences(reviews: value);
                },
              ),

              const Divider(height: 1, indent: 16, endIndent: 16),

              // Promotions from favorites
              SwitchListTile(
                title: const Text(
                  'Акции из избранного',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textPrimary,
                  ),
                ),
                subtitle: const Text(
                  'Новые акции от заведений в избранном',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                  ),
                ),
                value: prefs.promotionsPushEnabled,
                activeTrackColor: AppTheme.primaryOrange.withValues(alpha: 0.5),
                activeThumbColor: AppTheme.primaryOrange,
                onChanged: (value) {
                  prefs.updatePreferences(promotions: value);
                },
              ),

              const SizedBox(height: 24),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'Push-уведомления дополняют уведомления в приложении. '
                  'Даже при отключённых push-уведомлениях вы продолжите '
                  'получать уведомления внутри приложения.',
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  /// Toggle booking notifications with confirmation warning for partners.
  void _toggleBooking(NotificationPreferencesProvider prefs, bool value) {
    if (!value) {
      // Warn before disabling booking notifications
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Отключить уведомления о бронях?'),
          content: const Text(
            'Вы можете пропустить новые заявки на бронирование '
            'в течение времени ожидания подтверждения.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Отмена'),
            ),
            TextButton(
              onPressed: () {
                Navigator.of(ctx).pop();
                prefs.updatePreferences(booking: false);
              },
              child: const Text('Отключить'),
            ),
          ],
        ),
      );
    } else {
      prefs.updatePreferences(booking: true);
    }
  }
}
