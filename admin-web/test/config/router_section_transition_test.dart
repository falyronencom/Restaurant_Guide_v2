import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Переход между разделами панели — без наложения экранов (F-30).
///
/// Наблюдатель 29.09 видел обе страницы полупрозрачными. Тема 20.10 убрала с
/// перехода анимацию, но маршруты строились обычной страницей Material, и её
/// переход длится 300 мс: всё это время прежний экран остаётся под новым, а
/// экраны разделов прозрачны. 30.10, после выкатки новой палитры, Координатор
/// увидел то же самое иначе: «при переключение меню боковой панели название
/// раздела на секунду наслаивается на новое».
///
/// Стенд — настоящий роутер панели (`createRouter`) с настоящим каркасом.
/// Разделы — «История платежей» и «Уведомления»: экраны-заглушки, которым не
/// нужны ни данные, ни провайдеры, а переход у них тот же, что у всех.
/// Проверка — через ОДИН кадр после смены адреса: прежний экран к этому
/// кадру обязан исчезнуть. С переходом он ещё на месте.

/// Сессия есть и принадлежит администратору — роутер пускает в разделы.
class _SignedInAuthService implements AuthService {
  @override
  Future<bool> isAuthenticated() async => true;

  @override
  Future<User> getCurrentUser() async => const User(
        id: 'u-admin',
        email: 'admin@example.by',
        role: 'admin',
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Счётчики меню без сети.
class _IdleBadges extends BadgesProvider {
  @override
  Future<void> load() async {}

  @override
  Future<void> refreshIfOlderThan(Duration age) async {}

  @override
  void startAutoRefresh({Duration every = BadgesProvider.autoRefreshEvery}) {}
}

/// Подписи шапок разделов — их нет в меню слева, в отличие от названий.
const String _payments = 'Появится вместе с монетизацией';
const String _notifications = 'Событий пока нет';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  /// Панель открыта на «Истории платежей» — адресом, с которого браузер
  /// открывает вкладку: так дашборд с его данными не строится вовсе.
  Future<GoRouter> pumpPanel(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    tester.platformDispatcher.defaultRouteNameTestValue = '/settings/payments';
    addTearDown(tester.platformDispatcher.clearDefaultRouteNameTestValue);

    final auth = AuthProvider(authService: _SignedInAuthService());
    addTearDown(auth.dispose);
    final badges = _IdleBadges();
    addTearDown(badges.dispose);
    final router = createRouter(auth);
    addTearDown(router.dispose);

    await tester.pumpWidget(MultiProvider(
      providers: <ChangeNotifierProvider<ChangeNotifier>>[
        ChangeNotifierProvider<AuthProvider>.value(value: auth),
        ChangeNotifierProvider<BadgesProvider>.value(value: badges),
      ],
      child: MaterialApp.router(
        theme: AppTheme.lightTheme,
        routerConfig: router,
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text(_payments), findsOneWidget,
        reason: 'предпосылка: панель открыта на «Истории платежей»');
    return router;
  }

  /// Кадры по 16 мс на всё окно прежнего перехода (300 мс) с запасом: ни в
  /// одном оба раздела не видны разом, а в конце виден только новый.
  ///
  /// Не «один кадр после смены адреса»: адрес разбирается асинхронно, и
  /// новый экран встаёт не обязательно в первом кадре. Наложение — это
  /// именно кадр, где видны оба, его и ищем.
  Future<void> expectCleanSwitch(
    WidgetTester tester,
    GoRouter router, {
    required String to,
    required String newText,
    required String oldText,
  }) async {
    router.go(to);
    final overlapping = <int>[];
    for (var frame = 0; frame < 30; frame++) {
      await tester.pump(const Duration(milliseconds: 16));
      final both = find.text(newText).evaluate().isNotEmpty &&
          find.text(oldText).evaluate().isNotEmpty;
      if (both) overlapping.add(frame);
    }
    expect(overlapping, isEmpty,
        reason: 'кадры, где виден и прежний раздел, и новый — заголовки '
            'наслаиваются: $overlapping');
    expect(find.text(newText), findsOneWidget,
        reason: 'новый раздел не открылся');
    expect(find.text(oldText), findsNothing,
        reason: 'прежний раздел остался на экране');
  }

  testWidgets('раздел сменяется без кадров, где видны оба экрана',
      (tester) async {
    final router = await pumpPanel(tester);

    await expectCleanSwitch(tester, router,
        to: '/settings/notifications',
        newText: _notifications,
        oldText: _payments);
    // Обратно — так же: «Назад» браузера приходит сюда новым адресом.
    await expectCleanSwitch(tester, router,
        to: '/settings/payments',
        newText: _payments,
        oldText: _notifications);
  });

  test('каждый маршрут панели — страница без перехода', () {
    // Новый раздел с `builder:` вернул бы наложение только себе — и тест на
    // двух заглушках этого бы не увидел. Поэтому обходится весь список.
    final auth = AuthProvider(authService: _SignedInAuthService());
    addTearDown(auth.dispose);
    final router = createRouter(auth);
    addTearDown(router.dispose);

    final offenders = <String>[];
    var checked = 0;
    void walk(List<RouteBase> routes) {
      for (final route in routes) {
        if (route is GoRoute) {
          checked++;
          if (route.builder != null || route.pageBuilder == null) {
            offenders.add(route.path);
          }
        } else if (route is ShellRoute) {
          checked++;
          if (route.builder != null || route.pageBuilder == null) {
            offenders.add('ShellRoute');
          }
        }
        walk(route.routes);
      }
    }

    walk(router.configuration.routes);
    expect(checked, greaterThan(15), reason: 'обход не видит маршрутов');
    expect(offenders, isEmpty,
        reason: 'маршрут строит обычную страницу с переходом — взять '
            'pageBuilder: … panelPage(state, …):\n${offenders.join('\n')}');
  });
}
