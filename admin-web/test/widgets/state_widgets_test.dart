import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/screens/notifications/notifications_screen.dart';
import 'package:restaurant_guide_admin_web/screens/payments/payments_screen.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_empty_state.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Сквозные состояния интерфейса: шапка экрана, скелетон, ошибки, пустые
/// панели. Проверяются величины, а не факт отрисовки — размеры панелей и
/// шапки заданы каноном и легко уезжают незаметно.
void main() {
  Future<void> pump(WidgetTester tester, Widget child) async {
    // Область контента при рейле 260px на окне 1440.
    tester.view.physicalSize = const Size(1180, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(body: child),
      ),
    );
    await tester.pump();
  }

  /// Ширина внешней панели виджета-состояния.
  double panelWidth(WidgetTester tester, Type widget) {
    final panel = find
        .descendant(of: find.byType(widget), matching: find.byType(Container))
        .first;
    return tester.getSize(panel).width;
  }

  group('AdminScreenHeader', () {
    testWidgets('высота 72 и заголовок с подписью', (tester) async {
      await pump(
        tester,
        const AdminScreenHeader(
          title: 'Ожидают просмотра',
          subtitle: 'старейшая заявка ждёт 9 дней',
        ),
      );

      expect(AdminScreenHeader.height, 72);
      expect(tester.getSize(find.byType(AdminScreenHeader)).height, 72);
      expect(find.text('Ожидают просмотра'), findsOneWidget);
      expect(find.text('старейшая заявка ждёт 9 дней'), findsOneWidget);
    });

    testWidgets('без подписи заголовок остаётся по центру шапки',
        (tester) async {
      await pump(tester, const AdminScreenHeader(title: 'Отзывы'));

      expect(tester.getSize(find.byType(AdminScreenHeader)).height, 72);
      final title = tester.getRect(find.text('Отзывы'));
      expect(title.center.dy, closeTo(36, 2));
    });

    testWidgets('слот действий отрисован справа', (tester) async {
      await pump(
        tester,
        const AdminScreenHeader(
          title: 'Аналитика',
          actions: <Widget>[Text('30 дней')],
        ),
      );

      final title = tester.getRect(find.text('Аналитика'));
      final action = tester.getRect(find.text('30 дней'));
      expect(action.left, greaterThan(title.right));
    });

    // Волна 3 (A3-11): действия шире шапки прежде отнимали всё место, и
    // заголовок исчезал целиком. Теперь заголовку обещано своё, а действия
    // прокручиваются в остатке.
    testWidgets('широкие действия не съедают заголовок и не наезжают на него',
        (tester) async {
      await pump(
        tester,
        SizedBox(
          width: 700,
          child: AdminScreenHeader(
            title: 'Панель управления',
            subtitle: 'данные за 30 дней · не удалось обновить',
            actions: <Widget>[
              for (var i = 0; i < 6; i++)
                SizedBox(width: 150, child: Text('Кнопка $i')),
            ],
          ),
        ),
      );

      expect(tester.takeException(), isNull, reason: 'без переполнения');
      final title = tester.renderObject<RenderParagraph>(
          find.text('Панель управления'));
      expect(title.size.width, greaterThan(150),
          reason: 'заголовок виден, а не сжат в ноль');
      expect(title.didExceedMaxLines, isFalse,
          reason: 'короткому заголовку места хватает целиком');
      final titleRect = tester.getRect(find.text('Панель управления'));
      final actions = tester.getRect(
          find.byKey(const ValueKey<String>('screen-header-actions')));
      expect(actions.left, greaterThanOrEqualTo(titleRect.right),
          reason: 'действия правее заголовка');
      expect(actions.right, lessThanOrEqualTo(700));
    });

    testWidgets('обрезанная подпись — с подсказкой, целая — без',
        (tester) async {
      const long = 'данные за 30 дней · обновлено в 14:05 · не удалось '
          'обновить — показаны числа прошлой загрузки';
      await pump(
        tester,
        const SizedBox(
          width: 420,
          child: AdminScreenHeader(title: 'Отзывы', subtitle: long),
        ),
      );
      expect(find.byTooltip(long), findsOneWidget);
      expect(find.byTooltip('Отзывы'), findsNothing,
          reason: 'заголовок влез — подсказка не нужна');

      await pump(
        tester,
        const AdminScreenHeader(title: 'Отзывы', subtitle: 'всего 5'),
      );
      expect(find.byType(Tooltip), findsNothing);
    });
  });

  group('SkeletonBlock', () {
    testWidgets('оттенок задаётся весом блока', (tester) async {
      await pump(
        tester,
        const Column(
          children: [
            SkeletonBlock(width: 80, height: 11, shade: SkeletonShade.strong),
            SkeletonBlock(width: 80, height: 11, shade: SkeletonShade.mid),
            SkeletonBlock(width: 80, height: 11, shade: SkeletonShade.weak),
          ],
        ),
      );

      final colors = tester
          .widgetList<Container>(find.byType(Container))
          .map((c) => (c.decoration as BoxDecoration?)?.color)
          .toList();

      expect(colors, <Color>[
        AppTheme.skeletonStrong,
        AppTheme.skeletonMid,
        AppTheme.skeletonWeak,
      ]);
    });

    testWidgets('доля ширины считается от родителя', (tester) async {
      await pump(
        tester,
        const SizedBox(
          width: 200,
          child: SkeletonBlock(widthFactor: 0.5, height: 11),
        ),
      );

      expect(tester.getSize(find.byType(Container)).width, 100);
    });
  });

  group('AdminEmptyState', () {
    testWidgets('пустой раздел: панель 560, брендовая плитка, срок',
        (tester) async {
      await pump(
        tester,
        const AdminEmptyState.section(
          icon: Icons.notifications_outlined,
          title: 'Пока тихо',
          status: 'Система уведомлений в разработке',
          message: 'Здесь будет лента событий платформы.',
          rows: <EmptyStateRow>[
            EmptyStateRow(
              icon: Icons.pending_actions_outlined,
              text: 'Новые заявки на модерацию',
            ),
          ],
          footnote: 'В следующих обновлениях',
        ),
      );

      expect(panelWidth(tester, AdminEmptyState), 560);
      expect(find.text('Пока тихо'), findsOneWidget);
      expect(find.text('Новые заявки на модерацию'), findsOneWidget);
      expect(find.byIcon(Icons.schedule), findsOneWidget);
      // У раздела крестиков не бывает — снимать нечего.
      expect(find.byIcon(Icons.close), findsNothing);
    });

    testWidgets('пустой фильтр: крестики у строк и работающий сброс',
        (tester) async {
      var reset = 0;
      var removed = 0;

      await pump(
        tester,
        AdminEmptyState.filtered(
          title: 'Ничего не подошло',
          status: 'Отзывы есть — под этот фильтр не попал ни один',
          rows: <EmptyStateRow>[
            EmptyStateRow(
              icon: Icons.search,
              text: 'поиск «драники халодныя»',
              onRemove: () => removed++,
            ),
          ],
          onReset: () => reset++,
          resetHint: 'Вернёт все 1 240 отзывов',
        ),
      );

      expect(panelWidth(tester, AdminEmptyState), 560);
      expect(find.byIcon(Icons.close), findsOneWidget);
      expect(find.byIcon(Icons.schedule), findsNothing);

      await tester.tap(find.byIcon(Icons.close));
      await tester.tap(find.text('Сбросить фильтры'));
      await tester.pump();

      expect(removed, 1);
      expect(reset, 1);
    });
  });

  group('AdminErrorCard', () {
    testWidgets('панель 400, три слоя сообщения раздельно', (tester) async {
      var retried = 0;

      await pump(
        tester,
        AdminErrorCard(
          title: 'Список не загрузился',
          reason: 'Сервер не ответил',
          message: 'Данные не потеряны — заявки на месте.',
          technical: 'connection refused · GET /admin/establishments/pending',
          onRetry: () => retried++,
        ),
      );

      expect(panelWidth(tester, AdminErrorCard), 400);
      expect(find.text('Список не загрузился'), findsOneWidget);
      expect(find.text('Сервер не ответил'), findsOneWidget);
      expect(
        find.text('connection refused · GET /admin/establishments/pending'),
        findsOneWidget,
      );
      expect(find.text('Скопировать код'), findsOneWidget);

      await tester.tap(find.text('Повторить'));
      expect(retried, 1);
    });

    testWidgets('без технической строки кнопки копирования нет',
        (tester) async {
      await pump(
        tester,
        AdminErrorCard(
          title: 'Не загрузилось',
          reason: 'Нет связи',
          message: 'Попробуйте ещё раз.',
          onRetry: () {},
        ),
      );

      expect(find.text('Скопировать код'), findsNothing);
    });
  });

  group('AdminErrorToast', () {
    testWidgets('показывается в правом нижнем углу и снимается по «Ещё раз»',
        (tester) async {
      var retried = 0;

      await pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showAdminErrorToast(
              context,
              title: 'Отзыв не скрыт',
              message: 'Сервер отклонил запрос.',
              onRetry: () => retried++,
            ),
            child: const Text('вызвать'),
          ),
        ),
      );

      await tester.tap(find.text('вызвать'));
      await tester.pump();

      expect(find.byType(AdminErrorToast), findsOneWidget);
      final toast = tester.getRect(find.byType(AdminErrorToast));
      expect(toast.right, closeTo(1180 - 24, 1));
      expect(toast.bottom, closeTo(820 - 24, 1));

      await tester.tap(find.text('Ещё раз'));
      await tester.pump();

      expect(retried, 1);
      expect(find.byType(AdminErrorToast), findsNothing);
    });

    testWidgets('снимается до первого кадра — и не роняет ассерт оверлея',
        (tester) async {
      // Экраны снимают прежний тост и показывают новый в ОДНОМ
      // `addPostFrameCallback`, поэтому снятие раньше первого кадра записи —
      // не экзотика, а рабочий путь: две ошибки подряд дают ровно его.
      //
      // Ловушка, стоившая BLOCKER: `OverlayEntry.mounted` означает «виджет
      // записи построен», а не «запись в оверлее». Проверка `if (mounted)`
      // перед `remove()` пропускала снятие, и `dispose()` падал ассертом
      // «An OverlayEntry must first be removed…», а в release оставлял тост
      // висеть навсегда.
      late VoidCallback dismiss;

      await pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            onPressed: () {
              dismiss = showAdminErrorToast(
                context,
                title: 'Список не обновился',
                message: 'Сервер отклонил запрос.',
              );
              // Ни одного кадра между показом и снятием.
              dismiss();
            },
            child: const Text('вызвать'),
          ),
        ),
      );

      await tester.tap(find.text('вызвать'));
      await tester.pump();

      expect(find.byType(AdminErrorToast), findsNothing);
      expect(tester.takeException(), isNull);

      // Повторное снятие безвредно: флаг `removed` закрывает второй проход,
      // иначе `dispose()` бил бы ассертом «уже освобождён».
      dismiss();
      await tester.pump();
      expect(tester.takeException(), isNull);
    });

    testWidgets('снимается сам по истечении срока', (tester) async {
      await pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showAdminErrorToast(
              context,
              title: 'Не сохранено',
              message: 'Сервер отклонил запрос.',
              duration: const Duration(seconds: 2),
            ),
            child: const Text('вызвать'),
          ),
        ),
      );

      await tester.tap(find.text('вызвать'));
      await tester.pump();
      expect(find.byType(AdminErrorToast), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      expect(find.byType(AdminErrorToast), findsNothing);
    });
  });

  group('Экраны-заглушки', () {
    testWidgets('Уведомления собраны из шапки и пустого раздела',
        (tester) async {
      await pump(tester, const NotificationsScreen());

      expect(find.byType(AdminScreenHeader), findsOneWidget);
      expect(find.text('Пока тихо'), findsOneWidget);
      expect(find.text('Важные события платформы'), findsOneWidget);
      // Зависимость названа честно, а не «ожидается в обновлениях».
      expect(
        find.textContaining('Пока сигналы собраны в «Здоровье данных»'),
        findsOneWidget,
      );
    });

    testWidgets('История платежей называет реальную зависимость',
        (tester) async {
      await pump(tester, const PaymentsScreen());

      expect(find.text('Платежей пока нет'), findsOneWidget);
      expect(
        find.text('Поздний этап — после публичного запуска'),
        findsOneWidget,
      );
    });
  });
}
