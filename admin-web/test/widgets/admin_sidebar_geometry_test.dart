import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';

/// Геометрия навигационного рейла.
///
/// Смысл этих проверок — не «виджет отрисовался», а конкретное обещание
/// редизайна: на рабочем окне 1440×820 все 12 разделов видны без прокрутки.
/// Раньше при ширине 363 и высоте пункта 44 «Здоровье данных» уходило под
/// нижний разделитель. Такие дефекты меряются числами, а не глазами.
void main() {
  const paths = <String>[
    '/',
    '/moderation/pending',
    '/moderation/approved',
    '/moderation/rejected',
    '/moderation/suspended',
    '/moderation/menu-items',
    '/settings/analytics',
    '/settings/reviews',
    '/settings/payments',
    '/settings/notifications',
    '/audit-log',
    '/quality/health',
  ];

  Future<void> pumpRail(WidgetTester tester, {String location = '/'}) async {
    // Реальный рабочий вьюпорт: окно браузера на экране 1440×900.
    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final router = GoRouter(
      initialLocation: location,
      routes: <RouteBase>[
        ShellRoute(
          builder: (context, state, child) => Row(
            children: [const AdminSidebar(), Expanded(child: child)],
          ),
          routes: <RouteBase>[
            for (final path in paths)
              GoRoute(path: path, builder: (_, __) => const SizedBox.shrink()),
          ],
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>(
        create: (_) => AuthProvider(),
        child: MaterialApp.router(
          theme: AppTheme.lightTheme,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();
  }

  /// Высота кликабельной строки пункта — ближайший SizedBox над подписью.
  double itemHeight(WidgetTester tester, String title) {
    final box = find
        .ancestor(of: find.text(title), matching: find.byType(SizedBox))
        .first;
    return tester.getSize(box).height;
  }

  testWidgets('ширина рейла — 260, как в макете (было 363)', (tester) async {
    await pumpRail(tester);

    expect(AdminSidebar.width, 260);
    expect(tester.getSize(find.byType(AdminSidebar)).width, 260);
  });

  testWidgets('высота пункта — 34 у всех разделов', (tester) async {
    await pumpRail(tester);

    for (final title in const <String>[
      'Панель управления',
      'Ожидают просмотра',
      'Позиции меню',
      'Уведомления',
      'Журнал действий',
      'Здоровье данных',
    ]) {
      expect(itemHeight(tester, title), 34, reason: 'пункт «$title»');
    }
  });

  testWidgets('все 12 разделов помещаются без прокрутки на 820px',
      (tester) async {
    await pumpRail(tester);

    final scrollable = tester.state<ScrollableState>(
      find.descendant(
        of: find.byType(AdminSidebar),
        matching: find.byType(Scrollable),
      ),
    );

    expect(
      scrollable.position.maxScrollExtent,
      0,
      reason: 'списку не должно быть куда скроллиться — именно этого добивался '
          'редизайн, сужая рейл и уплотняя пункты',
    );
  });

  testWidgets('«Здоровье данных» целиком выше нижнего блока рейла',
      (tester) async {
    await pumpRail(tester);

    final lastItem = tester.getRect(find.text('Здоровье данных'));
    final logout = tester.getRect(find.byIcon(Icons.logout));

    expect(lastItem.bottom, lessThan(logout.top),
        reason: 'последний раздел не должен налезать на блок профиля');
    expect(lastItem.bottom, lessThanOrEqualTo(820));
  });

  testWidgets('пометка «СКОРО» — ровно у платежей и уведомлений',
      (tester) async {
    await pumpRail(tester);

    expect(find.text('СКОРО'), findsNWidgets(2));

    // Обе пометки — в секции «Настройки», рядом со своими подписями.
    for (final title in const <String>['История платежей', 'Уведомления']) {
      final row = find.ancestor(of: find.text(title), matching: find.byType(Row));
      expect(
        find.descendant(of: row.first, matching: find.text('СКОРО')),
        findsOneWidget,
        reason: 'у пункта «$title» ожидается пометка',
      );
    }
  });

  testWidgets('активный раздел подсвечен и меняется вместе с маршрутом',
      (tester) async {
    await pumpRail(tester, location: '/quality/health');

    final active = tester.widget<Text>(find.text('Здоровье данных'));
    expect(active.style?.fontWeight, FontWeight.w600);
    expect(active.style?.color, AppTheme.primaryOrangeDark);

    final idle = tester.widget<Text>(find.text('Одобренные'));
    expect(idle.style?.fontWeight, FontWeight.w500);
    expect(idle.style?.color, AppTheme.textDark);
  });

  testWidgets('заголовки секций набраны прописными', (tester) async {
    await pumpRail(tester);

    for (final section in const <String>[
      'МОДЕРАЦИЯ',
      'НАСТРОЙКИ',
      'АУДИТ',
      'КАЧЕСТВО',
    ]) {
      expect(find.text(section), findsOneWidget);
    }
  });
}
