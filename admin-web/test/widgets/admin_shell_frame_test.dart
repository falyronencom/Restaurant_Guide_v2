import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/services/panel_version.dart';
import 'package:restaurant_guide_admin_web/services/rail_preference.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_shell.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';
import 'package:restaurant_guide_admin_web/widgets/panel_update_banner.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/stub_auth.dart';

// Каркас панели (волна 3, проход по панели модератора, 20.10): меню слева
// сворачивается само и по кнопке и помнит выбор (A3-11, A1-14, F-05),
// экраны узнают ширину своей области (находка П5+П6 № 6), счётчики меню
// перечитываются при переходе (находка П2+П3 № 6 — проводка без теста),
// плашка новой версии (К-7).

/// Счётчики без сети; считает, сколько раз каркас просил свежие.
class _CountingBadges extends BadgesProvider {
  final AdminBadges? stub;
  int navigationRefreshes = 0;
  int loads = 0;

  _CountingBadges({this.stub});

  @override
  AdminBadges? get badges => stub;

  @override
  Future<void> load() async => loads++;

  @override
  Future<void> refreshIfOlderThan(Duration age) async => navigationRefreshes++;
}

/// Экран, который показывает ширину своей области — так видно, что
/// `AdminContentArea` говорит правду.
class _WidthProbe extends StatelessWidget {
  final String label;

  const _WidthProbe(this.label);

  @override
  Widget build(BuildContext context) => Center(
        child: Text('$label ${AdminContentArea.widthOf(context).round()}'),
      );
}

class _Stand {
  final GoRouter router;
  final _CountingBadges badges;

  _Stand(this.router, this.badges);
}

Future<_Stand> _pumpShell(
  WidgetTester tester, {
  required double width,
  PanelVersionWatcher? watcher,
  AdminBadges? badges,
  Duration settle = const Duration(milliseconds: 300),
}) async {
  tester.view.physicalSize = Size(width, 820);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final counters = _CountingBadges(stub: badges);
  addTearDown(counters.dispose);
  final router = GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      ShellRoute(
        builder: (context, state, child) =>
            AdminShell(versionWatcher: watcher, child: child),
        routes: <RouteBase>[
          GoRoute(path: '/', builder: (_, __) => const _WidthProbe('главная')),
          GoRoute(
            path: '/moderation/pending',
            builder: (_, __) => const _WidthProbe('очередь'),
          ),
        ],
      ),
    ],
  );
  addTearDown(router.dispose);

  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthProvider>(
        create: (_) => StubAuthProvider.admin(),
      ),
      ChangeNotifierProvider<BadgesProvider>.value(value: counters),
    ],
    child: MaterialApp.router(
      theme: AppTheme.lightTheme,
      routerConfig: router,
    ),
  ));
  await tester.pump();
  await tester.pump(settle);
  return _Stand(router, counters);
}

double _railWidth(WidgetTester tester) =>
    tester.getSize(find.byType(AdminSidebar)).width;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  group('правило сворачивания', () {
    test('без выбора меню следует ширине окна', () {
      expect(RailPreference.collapsed(windowWidth: 1440), isFalse);
      expect(RailPreference.collapsed(windowWidth: 1280), isFalse);
      expect(RailPreference.collapsed(windowWidth: 1279), isTrue);
      expect(RailPreference.collapsed(windowWidth: 1024), isTrue);
    });

    test('выбор сильнее ширины', () {
      expect(
          RailPreference.collapsed(windowWidth: 1024, stored: false), isFalse);
      expect(RailPreference.collapsed(windowWidth: 1440, stored: true), isTrue);
    });

    test('запоминается только отступление от правила', () {
      // Узкое окно: развернул — помним «развёрнуто»; свернул обратно —
      // память стёрта, меню снова по ширине.
      expect(RailPreference.afterToggle(windowWidth: 1024), isFalse);
      expect(
          RailPreference.afterToggle(windowWidth: 1024, stored: false), isNull);
      // Широкое окно — зеркально.
      expect(RailPreference.afterToggle(windowWidth: 1440), isTrue);
      expect(
          RailPreference.afterToggle(windowWidth: 1440, stored: true), isNull);
    });
  });

  group('меню слева в каркасе', () {
    testWidgets('1440: развёрнуто, экрану — окно минус 260', (tester) async {
      await _pumpShell(tester, width: 1440);

      expect(_railWidth(tester), AdminSidebar.width);
      expect(find.text('Ожидают просмотра'), findsOneWidget);
      expect(find.text('главная 1180'), findsOneWidget);
    });

    testWidgets('1024: свёрнуто само до значков, экрану — окно минус 64',
        (tester) async {
      await _pumpShell(tester, width: 1024);

      expect(_railWidth(tester), AdminSidebar.collapsedWidth);
      expect(find.text('Ожидают просмотра'), findsNothing,
          reason: 'в свёрнутом меню подписей нет');
      expect(find.byTooltip('Ожидают просмотра'), findsOneWidget,
          reason: 'подпись пункта — подсказкой');
      expect(find.byIcon(Icons.pending_actions_outlined), findsOneWidget);
      expect(find.text('главная 960'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('кнопка разворачивает, выбор запоминается и переживает '
        'перезапуск', (tester) async {
      await _pumpShell(tester, width: 1024);
      expect(_railWidth(tester), AdminSidebar.collapsedWidth,
          reason: 'предпосылка');

      await tester.tap(find.byKey(const ValueKey<String>('rail-toggle')));
      await tester.pumpAndSettle();

      expect(_railWidth(tester), AdminSidebar.width);
      expect(find.text('Ожидают просмотра'), findsOneWidget);
      expect(find.text('главная 764'), findsOneWidget);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(RailPreference.storageKey), isFalse);

      // Новая вкладка: каркас строится заново и читает выбор.
      await tester.pumpWidget(const SizedBox.shrink());
      await _pumpShell(tester, width: 1024);
      await tester.pumpAndSettle();
      expect(_railWidth(tester), AdminSidebar.width,
          reason: 'выбор «развёрнуто» помнится');

      // Свернул обратно — память стёрта: меню снова следует ширине окна.
      await tester.tap(find.byKey(const ValueKey<String>('rail-toggle')));
      await tester.pumpAndSettle();
      expect(_railWidth(tester), AdminSidebar.collapsedWidth);
      expect(prefs.getBool(RailPreference.storageKey), isNull);
    });

    testWidgets('сохранённый выбор встаёт сразу, без анимации при загрузке',
        (tester) async {
      // Ревью фазы 3.5: выбор приходит из браузера после первого кадра, и
      // «развёрнуто» на узком окне въезжало анимацией при каждой загрузке.
      SharedPreferences.setMockInitialValues(
          <String, Object>{RailPreference.storageKey: false});
      await _pumpShell(tester, width: 1024, settle: Duration.zero);
      await tester.pump(); // выбор прочитан — кадр без хода времени

      expect(_railWidth(tester), AdminSidebar.width,
          reason: 'ширина выбора — сразу, а не с середины анимации');
    });

    testWidgets('свёрнутое меню показывает очередь бейджем', (tester) async {
      final stand = await _pumpShell(
        tester,
        width: 1024,
        badges: const AdminBadges(establishmentsPending: 3, menuFlags: 0),
      );
      expect(stand.badges.loads, greaterThan(0), reason: 'вход грузит счётчики');

      expect(find.text('3'), findsOneWidget,
          reason: 'очередь заявок — числом на значке');
      expect(find.text('0'), findsNothing,
          reason: 'разобранная очередь бейджа не рисует');
      expect(find.byTooltip('Ожидают просмотра · 3'), findsOneWidget,
          reason: 'и в подсказке пункта');
      expect(find.byTooltip('Позиции меню'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets('переход на другой экран просит свежие счётчики меню',
      (tester) async {
    final stand = await _pumpShell(tester, width: 1440);
    final before = stand.badges.navigationRefreshes;

    stand.router.go('/moderation/pending');
    await tester.pumpAndSettle();

    expect(find.text('очередь 1180'), findsOneWidget, reason: 'предпосылка');
    expect(stand.badges.navigationRefreshes, greaterThan(before),
        reason: 'каркас слушает роутер и дёргает refreshIfOlderThan');
  });

  group('новая версия панели', () {
    test('сравнение номеров сборки', () {
      expect(isNewerPanelBuild(running: 'a1', published: 'b2'), isTrue);
      expect(isNewerPanelBuild(running: 'a1', published: 'a1'), isFalse);
      expect(isNewerPanelBuild(running: 'a1', published: ' a1\n'), isFalse,
          reason: 'перевод строки в файле — не новая сборка');
      expect(isNewerPanelBuild(running: 'a1', published: null), isFalse);
      expect(isNewerPanelBuild(running: 'a1', published: ''), isFalse);
      expect(isNewerPanelBuild(running: '', published: 'b2'), isFalse,
          reason: 'сборка без номера не сверяется');
    });

    test('файл сборки: объект, текст, мусор', () {
      expect(PanelVersionWatcher.parseBuildFile(<String, Object>{'build': 'x'}),
          'x');
      expect(PanelVersionWatcher.parseBuildFile('{"build":"y"}'), 'y');
      expect(PanelVersionWatcher.parseBuildFile('<html>'), isNull);
      expect(PanelVersionWatcher.parseBuildFile(<String, Object>{'build': 3}),
          isNull);
      expect(PanelVersionWatcher.parseBuildFile(null), isNull);
    });

    test('сверка: та же сборка молчит, другая — включает плашку', () async {
      var published = 'b1';
      var calls = 0;
      final watcher = PanelVersionWatcher(
        runningBuild: 'b1',
        fetchPublished: () async {
          calls++;
          return published;
        },
      );
      addTearDown(watcher.dispose);

      await watcher.check();
      expect(watcher.updateAvailable, isFalse);

      published = 'b2';
      await watcher.check();
      expect(watcher.updateAvailable, isTrue);

      // Найдена — дальше не ходит: плашка уже стоит.
      await watcher.check();
      expect(calls, 2);
    });

    test('сбой сети — молча, без плашки', () async {
      final watcher = PanelVersionWatcher(
        runningBuild: 'b1',
        fetchPublished: () async => throw Exception('нет сети'),
      );
      addTearDown(watcher.dispose);

      await watcher.check();
      expect(watcher.updateAvailable, isFalse);
    });

    test('сборка без номера не ходит за файлом вовсе', () async {
      var calls = 0;
      final watcher = PanelVersionWatcher(
        runningBuild: '',
        fetchPublished: () async {
          calls++;
          return 'b2';
        },
      );
      addTearDown(watcher.dispose);

      await watcher.check();
      expect(calls, 0);
      expect(watcher.enabled, isFalse);
    });

    testWidgets('каркас показывает плашку, когда вышла новая сборка, и '
        'сверяется при возврате на вкладку', (tester) async {
      var published = 'b1';
      final watcher = PanelVersionWatcher(
        runningBuild: 'b1',
        fetchPublished: () async => published,
      );
      addTearDown(watcher.dispose);
      await _pumpShell(tester, width: 1440, watcher: watcher);
      expect(find.byType(PanelUpdateBanner), findsNothing,
          reason: 'та же сборка — плашки нет');

      published = 'b2';
      tester.binding
          .handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump();

      expect(find.byType(PanelUpdateBanner), findsOneWidget);
      expect(find.textContaining(PanelUpdateBanner.message), findsOneWidget);
      expect(find.text('Обновить'), findsOneWidget);
      watcher.stop();
    });

    testWidgets('«Обновить» перезагружает вкладку', (tester) async {
      var reloads = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: PanelUpdateBanner(reload: () => reloads++)),
      ));

      await tester.tap(find.text('Обновить'));
      await tester.pump();

      expect(reloads, 1);
    });
  });
}
