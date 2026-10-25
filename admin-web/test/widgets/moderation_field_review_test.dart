import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_field_review.dart';

// Строка проверяемого поля — основной элемент рабочего экрана модератора
// (/moderation/pending), и до сих пор она не была покрыта ничем.
//
// У виджета остался ровно один путь: он рисуется только в режиме модерации.
// В режиме чтения вкладки панели возвращают сетку определений, не доходя до
// списка строк, поэтому ветки «только чтение» у строки больше нет, а
// вердикт-группа безусловна. Именно это здесь и держится: если группа снова
// станет условной, модератор потеряет кнопки — а заметить это было нечем.

Future<ModerationProvider> _pumpRow(WidgetTester tester) async {
  final provider = ModerationProvider();
  addTearDown(provider.dispose);

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      home: ChangeNotifierProvider<ModerationProvider>.value(
        value: provider,
        child: const Scaffold(
          body: ModerationFieldReview(
            fieldName: 'unp',
            label: 'УНП',
            isRequired: true,
            child: Text('191482073'),
          ),
        ),
      ),
    ),
  );
  await tester.pump();

  return provider;
}

/// Заливка самой строки. Первый Container внутри виджета — тот, что несёт
/// подсветку состояния; Container'ы кнопок вердикта идут в дереве позже.
BoxDecoration _rowDecoration(WidgetTester tester) {
  final container = tester.widget<Container>(
    find
        .descendant(
          of: find.byType(ModerationFieldReview),
          matching: find.byType(Container),
        )
        .first,
  );
  return container.decoration! as BoxDecoration;
}

void main() {
  group('Строка поля в режиме модерации', () {
    testWidgets('показывает значение и три кнопки вердикта', (tester) async {
      await _pumpRow(tester);

      expect(find.text('191482073'), findsOneWidget);
      expect(find.byIcon(Icons.check), findsOneWidget);
      expect(find.byIcon(Icons.close), findsOneWidget);
      expect(find.byIcon(Icons.chat_bubble_outline), findsOneWidget);
    });

    testWidgets('без вердикта строка не подсвечена', (tester) async {
      await _pumpRow(tester);

      expect(_rowDecoration(tester).color, isNull);
    });

    testWidgets('одобрение красит строку зелёным, отклонение — красным',
        (tester) async {
      final provider = await _pumpRow(tester);

      provider.approveField('unp');
      await tester.pump();
      expect(_rowDecoration(tester).color, AppTheme.successTint(0.06));

      provider.rejectField('unp', comment: 'УНП не совпадает с реестром');
      await tester.pump();
      expect(_rowDecoration(tester).color, AppTheme.errorTint(0.06));
    });

    testWidgets('причина отклонения видна прямо в строке', (tester) async {
      final provider = await _pumpRow(tester);

      provider.rejectField('unp', comment: 'УНП не совпадает с реестром');
      await tester.pump();

      expect(find.text('УНП не совпадает с реестром'), findsOneWidget);
    });

    testWidgets('заметка без вердикта видна, но строку не красит',
        (tester) async {
      // commentField оставляет статус neutral: заметка проверкой не является,
      // и красить строку ей нечем — иначе прогресс обещал бы закрытое поле.
      final provider = await _pumpRow(tester);

      provider.commentField('unp', 'Уточнить у партнёра при звонке');
      await tester.pump();

      expect(find.text('Уточнить у партнёра при звонке'), findsOneWidget);
      expect(_rowDecoration(tester).color, isNull);
    });
  });

  // Тесты выше выставляют вердикт вызовом провайдера в обход кнопок, и что
  // делает НАЖАТИЕ, они не видят — это видят тесты ниже. ✗ и 💬 открывают
  // окно с полем ввода; прежде окно не освобождало своё поле, сторож течей
  // ронял любой тест, нажимавший эти кнопки, и их не нажимал никто: мутация
  // «✗ зовёт commentField вместо rejectField» проходила весь набор зелёной.
  testWidgets('✓ одобряет поле, повторное нажатие снимает вердикт',
      (tester) async {
    final provider = await _pumpRow(tester);

    await tester.tap(find.byIcon(Icons.check));
    await tester.pump();
    expect(provider.getFieldState('unp').status, FieldReviewStatus.approved);

    await tester.tap(find.byIcon(Icons.check));
    await tester.pump();
    expect(provider.getFieldState('unp').status, FieldReviewStatus.neutral);
  });

  // A1-11: подсказка обещает «уйдёт партнёру», а пустая причина партнёру
  // не уходит — без текста кнопка погашена, рядом сказано, чего не хватает.
  testWidgets('✗ без причины не отклоняет: кнопка погашена', (tester) async {
    final provider = await _pumpRow(tester);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    expect(find.text('Нужна причина'), findsOneWidget);
    expect(
      tester.widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Отклонить')).onPressed,
      isNull,
    );
    await tester.enterText(find.byType(TextField), '   ');
    await tester.pump();
    expect(
      tester.widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Отклонить')).onPressed,
      isNull,
      reason: 'пробелы — не причина',
    );
    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();
    expect(provider.getFieldState('unp').status, FieldReviewStatus.neutral);
  });

  testWidgets('✗ с причиной отклоняет поле — вердиктом, а не заметкой',
      (tester) async {
    final provider = await _pumpRow(tester);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'УНП не совпадает с реестром');
    // Кнопка оживает вслед за полем (пункт A1-11: без причины она погашена).
    await tester.pump();
    await tester.tap(find.widgetWithText(ElevatedButton, 'Отклонить'));
    await tester.pumpAndSettle();

    final state = provider.getFieldState('unp');
    expect(state.status, FieldReviewStatus.rejected);
    expect(state.comment, 'УНП не совпадает с реестром');
    // Отклонённое поле закрывает одобрение заявки: причина уйдёт партнёру.
    expect(provider.canApprove, isFalse);
    expect(find.text('Отклонить: УНП'), findsNothing);
  });

  testWidgets('💬 «Сохранить» оставляет заметку без вердикта', (tester) async {
    final provider = await _pumpRow(tester);

    await tester.tap(find.byIcon(Icons.chat_bubble_outline));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byType(TextField), 'Уточнить у партнёра при звонке');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Сохранить'));
    await tester.pumpAndSettle();

    final state = provider.getFieldState('unp');
    expect(state.status, FieldReviewStatus.neutral);
    expect(state.comment, 'Уточнить у партнёра при звонке');
    expect(find.text('Комментарий: УНП'), findsNothing);
  });

  testWidgets('«Отмена» в окне причины ничего не меняет', (tester) async {
    final provider = await _pumpRow(tester);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    // Тронуть поле обязательно: нетронутое после закрытия не перестраивается,
    // и освобождение на попе маршрута не проявилось бы.
    await tester.enterText(find.byType(TextField), 'передумал');
    await tester.tap(find.widgetWithText(TextButton, 'Отмена'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    final state = provider.getFieldState('unp');
    expect(state.status, FieldReviewStatus.neutral);
    expect(state.comment, isNull);
  });

  testWidgets('окно причины открывается с прежней заметкой поля',
      (tester) async {
    final provider = await _pumpRow(tester);
    provider.commentField('unp', 'Уточнить у партнёра при звонке');
    await tester.pump();

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'Уточнить у партнёра при звонке',
    );
  });
}
