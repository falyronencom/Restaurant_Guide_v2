import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/services/push_notification_service.dart';

/// Screen for managing push notification preferences.
///
/// Four toggle switches per category:
/// - Бронирование (booking)
/// - Отзывы и заведения (reviews)
/// - Акции из избранного (promotions)
/// - Меню (menu — OCR finished parsing the uploaded menu, migration 033)
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

              // Доходят ли push до этого телефона — отдельно от
              // переключателей: те хранятся на сервере в аккаунте.
              const _PushDeviceStatus(),

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

              const Divider(height: 1, indent: 16, endIndent: 16),

              // Menu: OCR finished parsing the uploaded menu (menu_parsed)
              SwitchListTile(
                title: const Text(
                  'Меню',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textPrimary,
                  ),
                ),
                subtitle: const Text(
                  'Результат распознавания загруженного меню',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                  ),
                ),
                value: prefs.menuPushEnabled,
                activeTrackColor: AppTheme.primaryOrange.withValues(alpha: 0.5),
                activeThumbColor: AppTheme.primaryOrange,
                onChanged: (value) {
                  prefs.updatePreferences(menu: value);
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

/// Строка о том, доходят ли push до ЭТОГО телефона.
///
/// Переключатели ниже — настройки аккаунта на сервере. Дойдёт ли push до
/// телефона, они не говорят. До 08.10.2026 сбой регистрации адреса телефона
/// был виден только в отладочном журнале. С июля ни один телефон не присылал
/// серверу адрес, а снаружи это не было видно.
class _PushDeviceStatus extends StatelessWidget {
  const _PushDeviceStatus();

  @override
  Widget build(BuildContext context) {
    final pushService = PushNotificationService();
    return ValueListenableBuilder<PushStatus>(
      valueListenable: pushService.status,
      builder: (context, status, _) {
        final text = _textFor(status);
        if (text == null) return const SizedBox.shrink();
        final failed = status.state == PushState.failed;
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 8, 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Icon(
                  _iconFor(status.state),
                  size: 18,
                  color: _colorFor(status.state),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(
                    fontSize: 13,
                    color: failed ? AppTheme.textPrimary : AppTheme.textSecondary,
                  ),
                ),
              ),
              if (failed)
                TextButton(
                  onPressed: pushService.registerDevice,
                  child: const Text('Повторить'),
                ),
            ],
          ),
        );
      },
    );
  }

  static String? _textFor(PushStatus status) {
    switch (status.state) {
      case PushState.idle:
        return null;
      case PushState.registering:
        return 'Подключаем push-уведомления на этом телефоне…';
      case PushState.registered:
        return 'На этом телефоне push-уведомления включены.';
      case PushState.denied:
        return 'На этом телефоне push-уведомления запрещены в настройках '
            'телефона. Разрешите их там, чтобы получать уведомления.';
      case PushState.failed:
        return 'На этом телефоне push-уведомления не работают: '
            '${_reasonFor(status.problem)}';
    }
  }

  static String _reasonFor(PushProblem? problem) {
    switch (problem) {
      case PushProblem.firebaseUnavailable:
        return 'сервис уведомлений не запустился.';
      case PushProblem.appleAddressMissing:
        return 'Apple не выдал телефону адрес для уведомлений.';
      case PushProblem.addressUnavailable:
        return 'не удалось получить адрес телефона у сервиса уведомлений. '
            'Проверьте интернет.';
      case PushProblem.serverRejected:
        return 'сервер не принял адрес телефона.';
      case null:
        return 'причина неизвестна.';
    }
  }

  static IconData _iconFor(PushState state) {
    switch (state) {
      case PushState.registered:
        return Icons.check_circle_outline;
      case PushState.denied:
        return Icons.notifications_off_outlined;
      case PushState.failed:
        return Icons.error_outline;
      case PushState.idle:
      case PushState.registering:
        return Icons.sync;
    }
  }

  static Color _colorFor(PushState state) {
    switch (state) {
      case PushState.registered:
        return AppTheme.statusGreen;
      case PushState.denied:
        return AppTheme.primaryOrange;
      case PushState.failed:
        return AppTheme.errorRed;
      case PushState.idle:
      case PushState.registering:
        return AppTheme.textSecondary;
    }
  }
}
