import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/screens/auth/login_screen.dart';
import 'package:restaurant_guide_admin_web/screens/dashboard/dashboard_screen.dart';
import 'package:restaurant_guide_admin_web/screens/splash_screen.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/badges_service.dart';
import 'package:restaurant_guide_admin_web/services/quality_health_service.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

/// Сторож гейта авторизации на старте.
///
/// **Что именно охраняется.** До 14.09.2026 `redirect` возвращал `null`,
/// пока `AuthProvider.isLoading`, и первым кадром строился защищённый
/// маршрут `/`: дашборд монтировался ДО ответа об авторизации, успевал уйти
/// в сеть четырьмя запросами с неизвестным токеном и сносился редиректом
/// следом. На проде это давало четыре 401 на каждом холодном старте.
///
/// **Почему стенд держит провайдеры дашборда.** Под работающим гейтом
/// `DashboardScreen` не строится вовсе, и провайдеры ему не нужны. Но
/// сторож обязан краснеть по существу: если гейт снять, дерево должно
/// собраться и тест должен упасть на «дашборд построился», а не на
/// `ProviderNotFoundException` — иначе он проверял бы состав стенда, а не
/// поведение роутера. Сеть в widget-тестах замкнута биндингом, запросы
/// провайдеров отвечают ошибкой и глотаются их же `catch`.
///
/// **Ожидание держится `Completer`ом в теле теста**, а не задержкой: иначе
/// «дашборд не построился» значило бы лишь «не успел».
///
/// **Два слоя утверждений.** Группы ниже меряют причину — что защищённый
/// маршрут не строится. Группа «запросы к API» меряет следствие на той самой
/// границе, где симптом и наблюдался на проде: счётчики самих сервисов. Слой
/// ниже виджета нужен затем, что вызов однажды может переехать из `initState`
/// экрана в конструктор провайдера или в рейл — тогда «дашборд не построился»
/// останется зелёным, а четыре запроса полетят как прежде.

class _HoldingAuthService implements AuthService {
  /// Пока не завершён — инициализация провайдера висит, `isLoading` истинно.
  final Completer<bool> hasStoredSession = Completer<bool>();

  /// Ответ `/auth/me`, если сессия в хранилище нашлась.
  final Completer<User> currentUser = Completer<User>();

  int clearCalls = 0;

  @override
  Future<bool> isAuthenticated() => hasStoredSession.future;

  @override
  Future<User> getCurrentUser() => currentUser.future;

  @override
  Future<void> clearAuthData() async {
    clearCalls++;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _admin = User(id: 'u-admin', email: 'admin@nirivio.by', role: 'admin');

/// Счётчики вызовов — по одному на каждый из четырёх запросов старта.
///
/// Данных не отдают вовсе: ответ висит на `Completer`, который никто не
/// завершает. Здесь нужен факт вызова, а не состояние экрана после ответа —
/// за состояние отвечает `test/screens/dashboard_screen_test.dart`.
class _CountingBadgesService implements BadgesService {
  int calls = 0;
  final Completer<AdminBadges> _pending = Completer<AdminBadges>();

  @override
  Future<AdminBadges> getBadges() {
    calls++;
    return _pending.future;
  }
}

class _CountingQualityHealthService implements QualityHealthService {
  int calls = 0;
  final Completer<QualityHealthData> _pending = Completer<QualityHealthData>();

  @override
  Future<QualityHealthData> getHealth({bool force = false}) {
    calls++;
    return _pending.future;
  }
}

class _CountingAnalyticsService implements AnalyticsService {
  int overviewCalls = 0;
  int usersCalls = 0;
  final Completer<OverviewData> _overview = Completer<OverviewData>();
  final Completer<UsersAnalyticsData> _users = Completer<UsersAnalyticsData>();

  @override
  Future<OverviewData> getOverview({
    String period = '30d',
    String? from,
    String? to,
  }) {
    overviewCalls++;
    return _overview.future;
  }

  @override
  Future<UsersAnalyticsData> getUsersAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) {
    usersCalls++;
    return _users.future;
  }

  // Этих двух дашборд не зовёт. Позовёт — тест обязан упасть, а не молча
  // досчитать до другого числа.
  @override
  Future<EstablishmentsAnalyticsData> getEstablishmentsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) =>
      throw UnimplementedError('дашборд не запрашивает заведения');

  @override
  Future<ReviewsAnalyticsData> getReviewsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) =>
      throw UnimplementedError('дашборд не запрашивает отзывы');
}

/// Мерки задержки индикатора — ЛИТЕРАЛЫ, а не сама
/// [SplashScreen.indicatorDelay].
///
/// Сверяться с проверяемой константой значит двигать эталон вместе с кодом:
/// первая редакция этого стенда пампила ровно на `indicatorDelay` и осталась
/// зелёной, когда мутация обнулила задержку. Литералы держат границы снаружи,
/// а `_delayFitsProbes` отдельно требует, чтобы сама константа лежала между
/// ними — иначе стенд мерил бы мимо.
const _beforeDelay = Duration(milliseconds: 150);
const _pastDelay = Duration(milliseconds: 600);

/// Стенд повторяет корневую сборку `main.dart`: те же три провайдера над
/// роутером. Сервисы подменяются только там, где тест их считает; без
/// аргументов провайдеры берут свои синглтоны, как в проде, а сеть остаётся
/// замкнутой биндингом.
Widget _app(
  AuthProvider auth,
  GoRouter router, {
  BadgesService? badges,
  AnalyticsService? analytics,
  QualityHealthService? health,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthProvider>.value(value: auth),
      ChangeNotifierProvider(create: (_) => BadgesProvider(service: badges)),
      ChangeNotifierProvider(
        create: (_) => DashboardProvider(service: analytics),
      ),
      ChangeNotifierProvider(
        create: (_) => QualityHealthProvider(service: health),
      ),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

String _location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

void main() {
  setUp(() {
    AccountScope.debugReset();
    SessionEvents.debugReset();
  });

  group('пока авторизация не ответила', () {
    testWidgets('строится кадр инициализации, а не защищённый маршрут',
        (tester) async {
      final service = _HoldingAuthService();
      final auth = AuthProvider(authService: service);
      final router = createRouter(auth);
      addTearDown(router.dispose);
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth, router));
      await tester.pump();

      expect(auth.isLoading, isTrue, reason: 'стенд обязан держать ожидание');
      expect(find.byType(SplashScreen), findsOneWidget);
      expect(find.byType(DashboardScreen), findsNothing);
      expect(_location(router), splashPath);

      service.hasStoredSession.complete(false);
      await tester.pumpAndSettle();
    });

    testWidgets('индикатор не мелькает, но и не пропадает насовсем',
        (tester) async {
      final service = _HoldingAuthService();
      final auth = AuthProvider(authService: service);
      final router = createRouter(auth);
      addTearDown(router.dispose);
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth, router));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsNothing,
          reason: 'на быстром пути спиннер успел бы только мигнуть');

      await tester.pump(_beforeDelay);
      expect(find.byType(CircularProgressIndicator), findsNothing,
          reason: 'задержка обязана быть настоящей, а не нулевой');

      await tester.pump(_pastDelay);
      expect(find.byType(CircularProgressIndicator), findsOneWidget,
          reason: 'на медленном пути пустой кадр читается как зависание');

      service.hasStoredSession.complete(false);
      await tester.pumpAndSettle();
    });

    testWidgets('адрес перехода уезжает в запрос кадра', (tester) async {
      final service = _HoldingAuthService();
      final auth = AuthProvider(authService: service);
      final router = createRouter(auth);
      addTearDown(router.dispose);
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth, router));
      await tester.pump();

      router.go('/quality/health');
      await tester.pump();

      expect(_location(router), '$splashPath?from=%2Fquality%2Fhealth');
      expect(find.byType(SplashScreen), findsOneWidget);

      service.hasStoredSession.complete(false);
      await tester.pumpAndSettle();
    });
  });

  group('когда авторизация ответила', () {
    testWidgets('сессии нет — экран входа', (tester) async {
      final service = _HoldingAuthService();
      final auth = AuthProvider(authService: service);
      final router = createRouter(auth);
      addTearDown(router.dispose);
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth, router));
      await tester.pump();

      service.hasStoredSession.complete(false);
      await tester.pumpAndSettle();

      expect(_location(router), '/login');
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(SplashScreen), findsNothing);
    });

    testWidgets('сессия есть — возвращает на запрошенный адрес, не на дашборд',
        (tester) async {
      final service = _HoldingAuthService();
      final auth = AuthProvider(authService: service);
      final router = createRouter(auth);
      addTearDown(router.dispose);
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth, router));
      await tester.pump();

      router.go('/quality/health');
      await tester.pump();
      expect(_location(router), '$splashPath?from=%2Fquality%2Fhealth');

      service.hasStoredSession.complete(true);
      service.currentUser.complete(_admin);
      await tester.pumpAndSettle();

      expect(_location(router), '/quality/health',
          reason: 'иначе прямая ссылка на внутренний экран теряется');
    });

    testWidgets('ожидание не бесконечно: потолок уводит на вход, '
        'но хранилище не чистит', (tester) async {
      final service = _HoldingAuthService();
      final auth = AuthProvider(authService: service);
      final router = createRouter(auth);
      addTearDown(router.dispose);
      addTearDown(auth.dispose);

      await tester.pumpWidget(_app(auth, router));
      await tester.pump();

      // Сессия в хранилище нашлась, а `/auth/me` не отвечает вовсе.
      service.hasStoredSession.complete(true);
      await tester.pump();
      expect(find.byType(SplashScreen), findsOneWidget);

      await tester.pump(AuthProvider.initializationTimeout);
      await tester.pumpAndSettle();

      expect(_location(router), '/login');
      expect(auth.errorMessage, 'Не удалось проверить сессию — войдите снова');
      expect(service.clearCalls, 0,
          reason: 'молчание сети не доказывает, что токен мёртв');
    });
  });

  group('адрес перехода разбирается как чужой ввод', () {
    test('внутренний путь принимается', () {
      expect(safeInternalPath('/moderation/pending'), '/moderation/pending');
      expect(safeInternalPath('/quality/health?tab=1'), '/quality/health?tab=1');
    });

    test('чужой хост отвергается во всех формах', () {
      expect(safeInternalPath('//evil.example/path'), isNull);
      expect(safeInternalPath(r'/\evil.example/path'), isNull);
      expect(safeInternalPath('https://evil.example'), isNull);
      expect(safeInternalPath('evil.example'), isNull);
    });

    test('кадр инициализации сам себе адресом не бывает', () {
      expect(safeInternalPath(splashPath), isNull);
      expect(safeInternalPath('$splashPath?from=%2F'), isNull);
      expect(safeInternalPath('$splashPath/x'), isNull);
    });

    test('пустое значение — не адрес', () {
      expect(safeInternalPath(null), isNull);
      expect(safeInternalPath(''), isNull);
    });
  });

  group('запросы к API', () {
    testWidgets('уходят только после ответа об авторизации', (tester) async {
      final service = _HoldingAuthService();
      final badges = _CountingBadgesService();
      final analytics = _CountingAnalyticsService();
      final health = _CountingQualityHealthService();
      final auth = AuthProvider(authService: service);
      final router = createRouter(auth);
      addTearDown(router.dispose);
      addTearDown(auth.dispose);

      // Раскладка дашборда рассчитана на рабочий стол: в дефолтные 800x600 ряд
      // метрик не помещается, и вторая половина теста утонула бы в
      // переполнениях. 1500 — это 260 рейла плюс мерка окна из
      // test/screens/dashboard_screen_test.dart.
      tester.view.physicalSize = const Size(1500, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_app(auth, router,
          badges: badges, analytics: analytics, health: health));
      await tester.pump();
      // Кадр стоит заметно дольше задержки индикатора: «ещё не успели» и «не
      // зовём вовсе» обязаны различаться. Потолок ожидания (12 с) при этом не
      // задет — иначе сравнивали бы уже с уходом на вход.
      await tester.pump(const Duration(seconds: 1));

      expect(auth.isLoading, isTrue, reason: 'стенд обязан держать ожидание');
      expect(badges.calls, 0, reason: '/admin/badges');
      expect(analytics.overviewCalls, 0, reason: '/admin/analytics/overview');
      expect(analytics.usersCalls, 0, reason: '/admin/analytics/users');
      expect(health.calls, 0, reason: '/admin/quality/health');

      // Ноль выше не значил бы ничего, если бы счётчики не умели расти. Сессия
      // нашлась — гейт отпускает, и те же четыре запроса уходят, каждый ровно
      // по разу: дашборд после входа грузится как прежде.
      service.hasStoredSession.complete(true);
      service.currentUser.complete(_admin);
      await tester.pump(); // микрозадачи инициализации и пересчёт редиректа
      await tester.pump(); // кадр дашборда: postFrameCallback уходит в сеть

      expect(find.byType(DashboardScreen), findsOneWidget);
      expect(badges.calls, 1, reason: '/admin/badges');
      expect(analytics.overviewCalls, 1, reason: '/admin/analytics/overview');
      expect(analytics.usersCalls, 1, reason: '/admin/analytics/users');
      expect(health.calls, 1, reason: '/admin/quality/health');
    });
  });

  test('задержка индикатора лежит между мерками стенда', () {
    // Шов между кодом и линейкой. Виджет-тест выше доказывает поведение
    // литералами и потому ловит обнуление задержки; это утверждение держит
    // вторую сторону — что литералы меряют именно [SplashScreen.indicatorDelay],
    // а не соседний промежуток.
    expect(SplashScreen.indicatorDelay, greaterThan(_beforeDelay));
    expect(SplashScreen.indicatorDelay, lessThan(_beforeDelay + _pastDelay));
  });
}
