import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';

// Футер пагинации вынесен из колонки каталога на этапе 5: тот же футер рисуют
// кадр 06 и кадр 07.
//
// Вынос добавил ровно одну степень свободы — раскладку, — и она здесь и
// проверяется. Остальное (раскладка номеров с многоточиями) закреплено
// переборными тестами в moderation_catalog_test.dart и вместе с `pageEntries`
// не менялось.

void main() {
  Future<void> pump(
    WidgetTester tester,
    Widget pagination, {
    double width = 1180,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(width: width, child: pagination),
          ),
        ),
      ),
    );
  }

  group('Раскладка', () {
    testWidgets('широкий футер держит диапазон и номера в одной строке',
        (tester) async {
      await pump(
        tester,
        const AdminPagination.wide(
          page: 1,
          totalPages: 18,
          totalCount: 348,
          perPage: 20,
          shownOnPage: 20,
        ),
      );

      final range = tester.getRect(find.textContaining('Показано'));
      final pager = tester.getRect(find.text('18'));

      // Номера правее подписи и на одной с ней высоте.
      expect(pager.left, greaterThan(range.right));
      expect((pager.center.dy - range.center.dy).abs(), lessThan(1));
    });

    testWidgets('узкий футер ставит номера под диапазоном', (tester) async {
      await pump(
        tester,
        const AdminPagination.narrow(
          page: 1,
          totalPages: 18,
          totalCount: 348,
          perPage: 20,
          shownOnPage: 20,
        ),
        width: 420,
      );

      final range = tester.getRect(find.textContaining('Показано'));
      final pager = tester.getRect(find.text('18'));

      // Замерено на этапе 4: в колонке 420 полоса забирает до 310 из 388
      // пикселей, и подпись в остаток не влезает.
      expect(pager.top, greaterThan(range.bottom));
    });
  });

  group('Диапазон', () {
    testWidgets('считается от номера страницы и размера страницы',
        (tester) async {
      await pump(
        tester,
        const AdminPagination.wide(
          page: 3,
          totalPages: 18,
          totalCount: 348,
          perPage: 20,
          shownOnPage: 20,
        ),
      );

      expect(find.textContaining('41–60'), findsOneWidget);
    });

    testWidgets('верх диапазона не перепрыгивает общее число', (tester) async {
      // Так выглядит страница, опустевшая от действия модератора: провайдер
      // уменьшил счётчик, а `page` ещё прежний. Без ограничения футер
      // показывал бы перевёрнутый «Показано 21–20 из 20».
      await pump(
        tester,
        const AdminPagination.wide(
          page: 2,
          totalPages: 2,
          totalCount: 20,
          perPage: 20,
          shownOnPage: 3,
        ),
      );

      expect(find.textContaining('21–20'), findsNothing);
      expect(find.textContaining('21–21'), findsOneWidget);
    });

    testWidgets('единственная страница: диапазон есть, полосы номеров нет',
        (tester) async {
      await pump(
        tester,
        const AdminPagination.wide(
          page: 1,
          totalPages: 1,
          totalCount: 18,
          perPage: 20,
          shownOnPage: 18,
        ),
      );

      // «Показано 1–18 из 18» отвечает на вопрос «это всё?»...
      expect(find.textContaining('1–18'), findsOneWidget);
      // ...а три неактивных контрола к этому ничего не добавляют.
      expect(find.byIcon(Icons.chevron_left), findsNothing);
      expect(find.byIcon(Icons.chevron_right), findsNothing);
    });
  });
}
