import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/splash_screen.dart';
import 'package:restaurant_guide_admin_web/screens/auth/login_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/pending_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/rejected_screen.dart';
import 'package:restaurant_guide_admin_web/screens/menu_items/menu_items_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/suspended_screen.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/analytics_container_screen.dart';
import 'package:restaurant_guide_admin_web/screens/dashboard/dashboard_screen.dart';
import 'package:restaurant_guide_admin_web/screens/quality/quality_health_screen.dart';
import 'package:restaurant_guide_admin_web/screens/audit_log/audit_log_screen.dart';
import 'package:restaurant_guide_admin_web/screens/reviews/reviews_management_screen.dart';
import 'package:restaurant_guide_admin_web/screens/notifications/notifications_screen.dart';
import 'package:restaurant_guide_admin_web/screens/payments/payments_screen.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_shell.dart';

/// Маршрут кадра инициализации — см. [SplashScreen].
const String splashPath = '/splash';

/// Адрес перехода, переживший инициализацию, — или `null`.
///
/// Значение приезжает из адресной строки (`/splash?from=...`), поэтому
/// разбирается как чужой ввод, а не как своё же. Принимается только
/// внутренний путь: одиночный `/` в начале и ничего, что браузер прочитает
/// как другой хост. `//evil.example` и `/\evil.example` — именно такие
/// формы: первая это protocol-relative URL, вторая приводится браузерами к
/// ней же. Тот же довод, что у `returnTo` на публичном вебе.
///
/// Сам [splashPath] отбрасывается отдельно: вернуть на кадр инициализации
/// значит замкнуть редирект на себя.
@visibleForTesting
String? safeInternalPath(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith(r'/\')) return null;
  if (raw == splashPath || raw.startsWith('$splashPath/') ||
      raw.startsWith('$splashPath?')) {
    return null;
  }
  return raw;
}

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
      final location = state.matchedLocation;
      final isOnLogin = location == '/login';
      final isOnSplash = location == splashPath;

      // Пока неизвестно, есть ли сессия, строить можно только кадр
      // инициализации.
      //
      // Раньше здесь стоял `return null` с доводом «не редиректить, чтобы не
      // мигало». Мигания он действительно не давал — но пускал в дело
      // защищённый маршрут до ответа об авторизации: дашборд монтировался,
      // уходил в сеть с неизвестным токеном и сносился редиректом следом.
      // Довод про мигание закрывает [SplashScreen] отложенным индикатором,
      // а не отсутствие гейта.
      //
      // Адрес перехода уезжает в запрос кадра: без него прямая ссылка на
      // внутренний экран после инициализации открывала бы дашборд. Экран
      // входа в `from` не кладётся — вошедшему возвращаться туда незачем.
      if (isLoading) {
        if (isOnSplash) return null;
        final from = state.uri.toString();
        if (isOnLogin || safeInternalPath(from) == null || from == '/') {
          return splashPath;
        }
        return Uri(
          path: splashPath,
          queryParameters: <String, String>{'from': from},
        ).toString();
      }

      // Авторизация ответила — кадр инициализации отработал.
      if (isOnSplash) {
        if (!isAuthenticated) return '/login';
        return safeInternalPath(state.uri.queryParameters['from']) ?? '/';
      }

      // Not authenticated and not on login → go to login
      if (!isAuthenticated && !isOnLogin) return '/login';

      // Authenticated and on login → go to default screen
      if (isAuthenticated && isOnLogin) return '/';

      return null;
    },
    routes: [
      GoRoute(
        path: splashPath,
        builder: (context, state) => const SplashScreen(),
      ),
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
            path: '/moderation/menu-items',
            builder: (context, state) =>
                const MenuItemsModerationScreen(),
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
          GoRoute(
            path: '/quality/health',
            builder: (context, state) =>
                const QualityHealthScreen(),
          ),
        ],
      ),
    ],
  );
}
