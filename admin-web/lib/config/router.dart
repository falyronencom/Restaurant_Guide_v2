import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/auth/login_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/pending_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/placeholder_screen.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_shell.dart';

/// Create GoRouter with auth redirect guard
///
/// Created once and uses [refreshListenable] to re-evaluate redirects
/// when auth state changes via [AuthProvider.notifyListeners]
GoRouter createRouter(AuthProvider authProvider) {
  return GoRouter(
    initialLocation: '/moderation/pending',
    refreshListenable: authProvider,
    redirect: (BuildContext context, GoRouterState state) {
      final isAuthenticated = authProvider.isAuthenticated;
      final isLoading = authProvider.isLoading;
      final isOnLogin = state.matchedLocation == '/login';

      // While initializing, don't redirect — avoid flicker
      if (isLoading) return null;

      // Not authenticated and not on login → go to login
      if (!isAuthenticated && !isOnLogin) return '/login';

      // Authenticated and on login → go to default screen
      if (isAuthenticated && isOnLogin) return '/moderation/pending';

      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => AdminShell(child: child),
        routes: [
          GoRoute(
            path: '/moderation/pending',
            builder: (context, state) =>
                const PendingModerationScreen(),
          ),
          GoRoute(
            path: '/moderation/approved',
            builder: (context, state) =>
                const PlaceholderScreen(title: 'Одобренные'),
          ),
          GoRoute(
            path: '/moderation/rejected',
            builder: (context, state) =>
                const PlaceholderScreen(title: 'Отказанные'),
          ),
          GoRoute(
            path: '/settings/analytics',
            builder: (context, state) =>
                const PlaceholderScreen(title: 'Статистика и аналитика'),
          ),
          GoRoute(
            path: '/settings/reviews',
            builder: (context, state) =>
                const PlaceholderScreen(title: 'Отзывы'),
          ),
          GoRoute(
            path: '/settings/payments',
            builder: (context, state) =>
                const PlaceholderScreen(title: 'История платежей'),
          ),
          GoRoute(
            path: '/settings/notifications',
            builder: (context, state) =>
                const PlaceholderScreen(title: 'Уведомления'),
          ),
        ],
      ),
    ],
  );
}
