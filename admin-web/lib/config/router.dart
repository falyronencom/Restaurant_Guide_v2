import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/not_found_screen.dart';
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
import 'package:restaurant_guide_admin_web/screens/users/users_screen.dart';
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

/// «Одобренные» по адресу: `?q=` — запрос поиска, с которым экран
/// открывается (К-6, Ч19). Вынесено из маршрута, чтобы адрес проверялся
/// тестом без всего каркаса.
Widget approvedScreenFor(Uri uri) {
  final query = uri.queryParameters['q']?.trim();
  return ApprovedScreen(
    key: ValueKey<String>('approved:${query ?? ''}'),
    initialQuery: query,
  );
}

/// Страница панели — без перехода: новый экран встаёт на место прежнего за
/// один кадр.
///
/// Обычная страница Material (`builder:` у маршрута) живёт 300 мс перехода,
/// и всё это время прежний экран остаётся под новым. Тема ещё 20.10 убрала с
/// перехода анимацию (`InstantPageTransitionsBuilder`, F-30), но не сам
/// переход: экраны разделов прозрачны, и заголовки двух разделов на миг
/// видны разом — так это увидел Координатор после выкатки новой палитры
/// 30.10. Страница без перехода заменяет экран сразу. Диалоги — свои
/// маршруты поверх страниц, их это не касается; «Назад» браузера приходит
/// сюда же новым адресом. Сторож — test/config/router_section_transition_test.dart.
Page<void> panelPage(GoRouterState state, Widget child) =>
    NoTransitionPage<void>(key: state.pageKey, child: child);

/// Create GoRouter with auth redirect guard
///
/// Created once and uses [refreshListenable] to re-evaluate redirects
/// when auth state changes via [AuthProvider.notifyListeners]
GoRouter createRouter(AuthProvider authProvider) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: authProvider,
    // Неизвестный адрес — устаревшая закладка, опечатка. Стандартная страница
    // пакета английская, с текстом исключения (пункт A3-25).
    errorPageBuilder: (context, state) =>
        panelPage(state, const NotFoundScreen()),
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
        pageBuilder: (context, state) =>
            panelPage(state, const SplashScreen()),
      ),
      GoRoute(
        path: '/login',
        pageBuilder: (context, state) =>
            panelPage(state, const LoginScreen()),
      ),
      ShellRoute(
        pageBuilder: (context, state, child) =>
            panelPage(state, AdminShell(child: child)),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (context, state) =>
                panelPage(state, const DashboardScreen()),
          ),
          GoRoute(
            path: '/moderation/pending',
            pageBuilder: (context, state) =>
                panelPage(state, const PendingModerationScreen()),
          ),
          // `?q=<название>` открывает экран сразу с поиском по всем статусам —
          // так на карточку ведут примеры сигналов «Здоровья данных» (К-6,
          // 21.10.2026). Ключ по запросу: переход на другой `q` — новый поиск,
          // а не прежний экран со старым текстом в поле.
          GoRoute(
            path: '/moderation/approved',
            pageBuilder: (context, state) =>
                panelPage(state, approvedScreenFor(state.uri)),
          ),
          GoRoute(
            path: '/moderation/rejected',
            pageBuilder: (context, state) =>
                panelPage(state, const RejectedScreen()),
          ),
          GoRoute(
            path: '/moderation/suspended',
            pageBuilder: (context, state) =>
                panelPage(state, const SuspendedScreen()),
          ),
          GoRoute(
            path: '/moderation/menu-items',
            pageBuilder: (context, state) =>
                panelPage(state, const MenuItemsModerationScreen()),
          ),
          GoRoute(
            path: '/settings/analytics',
            pageBuilder: (context, state) =>
                panelPage(state, const AnalyticsContainerScreen()),
          ),
          GoRoute(
            path: kReviewsPath,
            pageBuilder: (context, state) => panelPage(
              state,
              ReviewsManagementScreen(
                initialAuthorId: state.uri.queryParameters['author'],
                initialRating: state.uri.queryParameters['rating'],
              ),
            ),
          ),
          GoRoute(
            path: kUsersPath,
            pageBuilder: (context, state) => panelPage(
              state,
              UsersScreen(initialUserId: state.uri.queryParameters['user']),
            ),
          ),
          GoRoute(
            path: '/settings/payments',
            pageBuilder: (context, state) =>
                panelPage(state, const PaymentsScreen()),
          ),
          GoRoute(
            path: '/settings/notifications',
            pageBuilder: (context, state) =>
                panelPage(state, const NotificationsScreen()),
          ),
          GoRoute(
            path: '/audit-log',
            pageBuilder: (context, state) =>
                panelPage(state, const AuditLogScreen()),
          ),
          GoRoute(
            path: '/quality/health',
            pageBuilder: (context, state) =>
                panelPage(state, const QualityHealthScreen()),
          ),
        ],
      ),
    ],
  );
}
