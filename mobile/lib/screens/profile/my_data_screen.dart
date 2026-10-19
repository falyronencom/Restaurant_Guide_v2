import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/delete_account_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/notification_preferences_screen.dart';

/// «Мои данные» — что приложение знает о человеке, и выход к удалению
/// учётки (бриф В1, 18.10.2026: «Профиль» → «Показать профиль» → «Мои
/// данные»).
///
/// Имя, способ входа, почта или телефон — из профиля, который приложение уже
/// держит (`/auth/me`). Ссылки на политику конфиденциальности здесь нет,
/// пока нет её страницы: пункт добавится вместе с ней.
class MyDataScreen extends StatelessWidget {
  const MyDataScreen({super.key});

  /// Способ входа словами экрана; незнакомый — `null`, строка не рисуется.
  static String? authMethodLabel(String? method) {
    switch (method) {
      case 'email':
        return 'Почта';
      case 'phone':
        return 'Телефон';
      case 'google':
        return 'Google';
      case 'yandex':
        return 'Яндекс';
      default:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().currentUser;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Мои данные'),
        backgroundColor: Colors.white,
        foregroundColor: AppTheme.textPrimary,
        // Тема задаёт заголовку белый цвет — здесь он тёмный, со своим
        // семейством (стиль заголовка заменяет унаследованный).
        titleTextStyle: const TextStyle(
          fontFamily: AppTheme.fontBodyFamily,
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppTheme.textPrimary,
        ),
        elevation: 0,
      ),
      backgroundColor: Colors.white,
      body: user == null ? const SizedBox.shrink() : _content(context, user),
    );
  }

  Widget _content(BuildContext context, User user) {
    final method = authMethodLabel(user.authMethod);
    final email = user.email;
    final phone = user.phone;

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        _DataRow(label: 'Имя', value: user.name ?? ''),
        if (method != null) _DataRow(label: 'Способ входа', value: method),
        if (email != null && email.isNotEmpty) _DataRow(label: 'Почта', value: email),
        if (phone != null && phone.isNotEmpty) _DataRow(label: 'Телефон', value: phone),
        const Divider(height: 24, indent: 16, endIndent: 16),
        ListTile(
          leading: const Icon(Icons.notifications_outlined, color: Colors.black87),
          title: const Text(
            'Уведомления',
            style: TextStyle(fontSize: 16, color: AppTheme.textPrimary),
          ),
          trailing: const Icon(Icons.chevron_right, color: AppTheme.textGrey),
          onTap: () {
            Navigator.of(context, rootNavigator: true).push(
              MaterialPageRoute(builder: (_) => const NotificationPreferencesScreen()),
            );
          },
        ),
        ListTile(
          key: const Key('my-data-delete-account'),
          leading: const Icon(Icons.delete_outline, color: AppTheme.errorRedDark),
          title: const Text(
            'Удалить учётку',
            style: TextStyle(fontSize: 16, color: AppTheme.errorRedDark),
          ),
          onTap: () {
            Navigator.of(context, rootNavigator: true).push(
              MaterialPageRoute(
                builder: (_) => DeleteAccountScreen(mentionDrafts: user.role == 'partner'),
              ),
            );
          },
        ),
      ],
    );
  }
}

class _DataRow extends StatelessWidget {
  const _DataRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(fontSize: 16, color: AppTheme.textPrimary),
          ),
        ],
      ),
    );
  }
}
