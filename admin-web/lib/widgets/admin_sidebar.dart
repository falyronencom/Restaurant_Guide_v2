import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';

/// Fixed-width sidebar navigation for admin panel
/// 363px width per Figma design specification
class AdminSidebar extends StatelessWidget {
  const AdminSidebar({super.key});

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;

    return SizedBox(
      width: 363,
      child: ColoredBox(
        color: Colors.white,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Logo
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 24, vertical: 20),
              child: Text(
                '{N}YAMA',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFFDB4F13),
                  letterSpacing: 1.2,
                ),
              ),
            ),
            const Divider(height: 1),

            // Navigation items
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 12),
                children: [
                  // Dashboard
                  _NavItem(
                    title: 'Панель управления',
                    path: '/',
                    currentPath: location,
                  ),

                  const SizedBox(height: 16),

                  // Section: Модерация
                  const _SectionHeader(title: 'Модерация'),
                  _NavItem(
                    title: 'Ожидают просмотра',
                    path: '/moderation/pending',
                    currentPath: location,
                  ),
                  _NavItem(
                    title: 'Одобренные',
                    path: '/moderation/approved',
                    currentPath: location,
                  ),
                  _NavItem(
                    title: 'Отказанные',
                    path: '/moderation/rejected',
                    currentPath: location,
                  ),

                  const SizedBox(height: 16),

                  // Section: Настройки
                  const _SectionHeader(title: 'Настройки'),
                  _NavItem(
                    title: 'Статистика и аналитика',
                    path: '/settings/analytics',
                    currentPath: location,
                  ),
                  _NavItem(
                    title: 'Отзывы',
                    path: '/settings/reviews',
                    currentPath: location,
                  ),
                  _NavItem(
                    title: 'История платежей',
                    path: '/settings/payments',
                    currentPath: location,
                  ),
                  _NavItem(
                    title: 'Уведомления',
                    path: '/settings/notifications',
                    currentPath: location,
                  ),

                  const SizedBox(height: 16),

                  // Section: Аудит
                  const _SectionHeader(title: 'Аудит'),
                  _NavItem(
                    title: 'Журнал действий',
                    path: '/audit-log',
                    currentPath: location,
                  ),
                ],
              ),
            ),

            // Logout
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextButton.icon(
                onPressed: () {
                  context.read<AuthProvider>().logout();
                },
                icon: const Icon(Icons.logout, size: 20),
                label: const Text('Выйти'),
                style: TextButton.styleFrom(
                  foregroundColor: Colors.grey.shade700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Section header in sidebar (e.g., "Модерация", "Настройки")
class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 4),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: Colors.grey.shade500,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

/// Navigation item in sidebar
class _NavItem extends StatelessWidget {
  final String title;
  final String path;
  final String currentPath;

  const _NavItem({
    required this.title,
    required this.path,
    required this.currentPath,
  });

  bool get isActive => currentPath == path;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
      child: Material(
        color: isActive
            ? const Color(0xFFDB4F13).withValues(alpha: 0.08)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => context.go(path),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight:
                          isActive ? FontWeight.w600 : FontWeight.normal,
                      color: isActive
                          ? const Color(0xFFDB4F13)
                          : Colors.grey.shade800,
                    ),
                  ),
                ),
                if (isActive)
                  const Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: Color(0xFFDB4F13),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
