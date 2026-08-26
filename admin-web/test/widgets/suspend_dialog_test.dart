import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

// Диалог приостановки: последний в проекте контроллер, живший без владельца.
//
// Проверяются два обещания, и оба нельзя увидеть, не тронув поле: контроллер
// переживает закрытие вместе с уезжающей анимацией, а кнопка не притворяется
// нажимаемой, пока причины нет.
//
// ЧЕСТНАЯ ГРАНИЦА: саму течь эти тесты НЕ ловят. Неосвобождённый контроллер
// ничего не бросает — он просто уходит сборщику мусора, — а `leak_tracker` в
// тестах проекта не включён. Проверено мутацией: убрать `dispose()` — все
// четыре теста остаются зелёными. Сторожат они обратную ошибку, ту самую
// опасную: освобождение НА ПОПЕ маршрута, до конца анимации, которое роняет
// «used after being disposed» на основном сценарии.

void main() {
  Future<List<String>> pumpActions(WidgetTester tester) async {
    final suspended = <String>[];

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Center(
            child: ModerationEntityActions(
              establishmentName: 'Кухмістр',
              onSuspend: suspended.add,
            ),
          ),
        ),
      ),
    );

    return suspended;
  }

  Future<void> openDialog(WidgetTester tester) async {
    await tester.tap(find.text('Приостановить'));
    await tester.pumpAndSettle();
  }

  testWidgets('поле причины переживает закрытие диалога', (tester) async {
    await pumpActions(tester);
    await openDialog(tester);

    // Тронуть поле обязательно: без единого касания контроллер после закрытия
    // не перестраивается, и дефект не проявляется вовсе.
    await tester.enterText(find.byType(TextField), 'жалобы посетителей');
    await tester.pump();

    await tester.tap(find.text('Отмена'));
    // Не pump(), а pumpAndSettle: контроллер, освобождённый на попе маршрута,
    // ронял бы «used after being disposed» именно на кадрах уезжающей
    // анимации, а один кадр до них не доходит.
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });

  testWidgets('без причины кнопка заблокирована и объясняет почему',
      (tester) async {
    final suspended = await pumpActions(tester);
    await openDialog(tester);

    final confirm = find.widgetWithText(FilledButton, 'Приостановить');
    // Прежде кнопка выглядела активной и молча выходила по `return` —
    // нажатие не делало ничего, и это читается как поломка.
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
    expect(find.text('Нужна причина'), findsOneWidget);

    await tester.tap(confirm);
    await tester.pumpAndSettle();

    // Диалог на месте, приостановки не случилось.
    expect(find.text('Приостановить заведение?'), findsOneWidget);
    expect(suspended, isEmpty);
  });

  testWidgets('одни пробелы причиной не считаются', (tester) async {
    await pumpActions(tester);
    await openDialog(tester);

    await tester.enterText(find.byType(TextField), '   ');
    await tester.pump();

    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Приостановить'),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('причина доезжает обрезанной', (tester) async {
    final suspended = await pumpActions(tester);
    await openDialog(tester);

    await tester.enterText(find.byType(TextField), '  жалобы посетителей  ');
    await tester.pump();

    await tester.tap(find.widgetWithText(FilledButton, 'Приостановить'));
    await tester.pumpAndSettle();

    expect(suspended, <String>['жалобы посетителей']);
    expect(find.text('Приостановить заведение?'), findsNothing);
  });
}
