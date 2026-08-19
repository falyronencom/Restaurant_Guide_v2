import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/dashboard/attention_panel.dart';

void main() {
  Future<void> pump(WidgetTester tester, Widget child) async {
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

  group('Форматирование', () {
    test('счётчик разбит на разряды', () {
      expect(formatCount(1248), '1${String.fromCharCode(0xA0)}248');
      expect(formatCount(7), '7');
    });

    test('дельта несёт знак стрелкой, а не минусом', () {
      expect(formatDelta(12.4), '↑ 12,4%');
      expect(formatDelta(-2.3), '↓ 2,3%');
      // Ноль — не рост и не падение, стрелки быть не должно.
      expect(formatDelta(0), '0,0%');
    });

    test('дробное с запятой', () {
      expect(formatDecimal(4.4), '4,4');
      expect(formatDecimal(4.0), '4,0');
      expect(formatDecimal(4.46), '4,5');
      // Значения ровно на половине (4.35) намеренно не проверяются: в double
      // они хранятся как 4.3499…, и «правильного» ответа тут нет.
    });

    test('склонение по русским правилам', () {
      expect(plural(1, 'действие', 'действия', 'действий'), 'действие');
      expect(plural(3, 'действие', 'действия', 'действий'), 'действия');
      expect(plural(7, 'действие', 'действия', 'действий'), 'действий');
      // 11-14 — исключение: «одиннадцать действиЙ», а не «действиЕ».
      expect(plural(11, 'действие', 'действия', 'действий'), 'действий');
      expect(plural(12, 'действие', 'действия', 'действий'), 'действий');
      expect(plural(21, 'действие', 'действия', 'действий'), 'действие');
      expect(plural(0, 'действие', 'действия', 'действий'), 'действий');
      expect(countWithNoun(23, 'действие', 'действия', 'действий'),
          '23 действия');
    });
  });

  group('MetricCard', () {
    testWidgets('рост зелёный, падение красное', (tester) async {
      await pump(
        tester,
        const Row(
          children: [
            Expanded(
              child: MetricCard(
                icon: Icons.group_outlined,
                label: 'Пользователи',
                value: '1 248',
                changePercent: 12.4,
              ),
            ),
            Expanded(
              child: MetricCard(
                icon: Icons.star_outline,
                label: 'Отзывы',
                value: '2 934',
                changePercent: -2.3,
              ),
            ),
          ],
        ),
      );

      expect(
        tester.widget<Text>(find.text('↑ 12,4%')).style?.color,
        AppTheme.statusGreen,
      );
      expect(
        tester.widget<Text>(find.text('↓ 2,3%')).style?.color,
        AppTheme.errorRed,
      );
    });

    testWidgets('лейбл набран прописными', (tester) async {
      await pump(
        tester,
        const MetricCard(
          icon: Icons.group_outlined,
          label: 'Пользователи',
          value: '1 248',
        ),
      );

      expect(find.text('ПОЛЬЗОВАТЕЛИ'), findsOneWidget);
    });

    testWidgets('очередь показывает приписку вместо выдуманной дельты',
        (tester) async {
      await pump(
        tester,
        const MetricCard(
          icon: Icons.shield_outlined,
          label: 'Модерация',
          value: '7',
          valueNote: 'в очереди',
          footnote: '23 действия',
        ),
      );

      expect(find.text('в очереди'), findsOneWidget);
      expect(find.textContaining('%'), findsNothing);
    });
  });

  group('AttentionPanel', () {
    testWidgets('ноль читается как «разобрано» даже при тревожном тоне',
        (tester) async {
      await pump(
        tester,
        const SizedBox(
          width: 320,
          height: 400,
          child: AttentionPanel(
            items: <AttentionItem>[
              AttentionItem(count: 7, title: 'Заявок на модерации'),
              AttentionItem(
                count: 0,
                title: 'Отзывов на разбор',
                note: 'жалоб нет',
                tone: AttentionTone.critical,
              ),
            ],
          ),
        ),
      );

      expect(find.text('Требует внимания'), findsOneWidget);
      expect(
        tester.widget<Text>(find.text('7')).style?.color,
        AppTheme.primaryOrangeDark,
      );
      expect(
        tester.widget<Text>(find.text('0')).style?.color,
        AppTheme.statusGreen,
      );
      expect(find.text('жалоб нет'), findsOneWidget);
    });

    testWidgets('строка без перехода не показывает шеврон', (tester) async {
      await pump(
        tester,
        const SizedBox(
          width: 320,
          height: 200,
          child: AttentionPanel(
            items: <AttentionItem>[
              AttentionItem(count: 3, title: 'Без перехода'),
            ],
          ),
        ),
      );

      expect(find.byIcon(Icons.chevron_right), findsNothing);
    });
  });

  group('PeriodSelector', () {
    testWidgets('активный сегмент выделен весом и цветом', (tester) async {
      await pump(
        tester,
        PeriodSelector(currentPeriod: '30d', onPeriodChanged: (_) {}),
      );

      final active = tester.widget<Text>(find.text('30 дней'));
      expect(active.style?.fontWeight, FontWeight.w600);
      expect(active.style?.color, AppTheme.primaryOrangeDark);

      final idle = tester.widget<Text>(find.text('7 дней'));
      expect(idle.style?.fontWeight, FontWeight.w500);
      expect(idle.style?.color, AppTheme.textSecondary);
    });

    testWidgets('выбор периода отдаёт код наружу', (tester) async {
      PeriodSelection? got;
      await pump(
        tester,
        PeriodSelector(
          currentPeriod: '30d',
          onPeriodChanged: (s) => got = s,
        ),
      );

      await tester.tap(find.text('90 дней'));
      await tester.pump();

      expect(got?.period, '90d');
    });
  });
}
