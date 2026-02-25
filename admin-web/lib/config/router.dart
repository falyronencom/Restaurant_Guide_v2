import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/auth/login_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/pending_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/rejected_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/suspended_screen.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/analytics_container_screen.dart';
import 'package:restaurant_guide_admin_web/screens/dashboard/dashboard_screen.dart';
import 'package:restaurant_guide_admin_web/screens/audit_log/audit_log_screen.dart';
import 'package:restaurant_guide_admin_web/screens/reviews/reviews_management_screen.dart';
import 'package:restaurant_guide_admin_web/screens/notifications/notifications_screen.dart';
import 'package:restaurant_guide_admin_web/screens/payments/payments_screen.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_shell.dart';

/// Create GoRouter with auth redirect guard
///
/// Created once and uses [refreshListenable] to re-evaluate redirects
/// when auth state changes via [AuthProvider.notifyListeners]
GoRouter createRouter(AuthProvider authProvider) {
  return GoRouter(
    initialLocation: '/',
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
      if (isAuthenticated && isOnLogin) return '/';

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
            path: '/',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/moderation/pending',
            builder: (context, state) =>
                const PendingModerationScreen(),
          ),
          GoRoute(
            path: '/moderation/approved',
            builder: (context, state) =>
                const ApprovedScreen(),
          ),
          GoRoute(
            path: '/moderation/rejected',
            builder: (context, state) =>
                const RejectedScreen(),
          ),
          GoRoute(
            path: '/moderation/suspended',
            builder: (context, state) =>
                const SuspendedScreen(),
          ),
          GoRoute(
            path: '/settings/analytics',
            builder: (context, state) =>
                const AnalyticsContainerScreen(),
          ),
          GoRoute(
            path: '/settings/reviews',
            builder: (context, state) =>
                const ReviewsManagementScreen(),
          ),
          GoRoute(
            path: '/settings/payments',
            builder: (context, state) =>
                const PaymentsScreen(),
          ),
          GoRoute(
            path: '/settings/notifications',
            builder: (context, state) =>
                const NotificationsScreen(),
          ),
          GoRoute(
            path: '/audit-log',
            builder: (context, state) =>
                const AuditLogScreen(),
          ),
        ],
      ),
    ],
  );
}
