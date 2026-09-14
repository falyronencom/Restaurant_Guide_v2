import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/screens/auth/login_screen.dart';
import 'package:restaurant_guide_admin_web/screens/dashboard/dashboard_screen.dart';
import 'package:restaurant_guide_admin_web/screens/splash_screen.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
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

Widget _app(AuthProvider auth, GoRouter router) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthProvider>.value(value: auth),
      ChangeNotifierProvider(create: (_) => BadgesProvider()),
      ChangeNotifierProvider(create: (_) => DashboardProvider()),
      ChangeNotifierProvider(create: (_) => QualityHealthProvider()),
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

  test('задержка индикатора лежит между мерками стенда', () {
    // Шов между кодом и линейкой. Виджет-тест выше доказывает поведение
    // литералами и потому ловит обнуление задержки; это утверждение держит
    // вторую сторону — что литералы меряют именно [SplashScreen.indicatorDelay],
    // а не соседний промежуток.
    expect(SplashScreen.indicatorDelay, greaterThan(_beforeDelay));
    expect(SplashScreen.indicatorDelay, lessThan(_beforeDelay + _pastDelay));
  });
}
