import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/ranked_bar_list.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/share_bar.dart';

// Геометрия графиков меряется, а не осматривается: доли на полосе и длины
// ранжированных полос — это и есть содержание, и ошибка в них не выглядит
// ошибкой.

void main() {
  Future<void> pump(WidgetTester tester, Widget child, {double width = 320}) async {
    tester.view.physicalSize = const Size(1180, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Center(child: SizedBox(width: width, child: child)),
        ),
      ),
    );
    await tester.pump();
  }

  /// Ширины отрезков полосы, слева направо.
  List<double> segmentWidths(WidgetTester tester) => tester
      .widgetList<SizedBox>(
        find.descendant(
          of: find.byType(ShareBar),
          matching: find.byType(SizedBox),
        ),
      )
      // Первый SizedBox — сама полоса по высоте, у него ширина не задана.
      .where((box) => box.width != null)
      .map((box) => box.width!)
      .toList();

  group('ShareBar', () {
    testWidgets('соседние отрезки одного цвета сливаются', (tester) async {
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.statusGreen, value: 50),
            ShareSegment(color: AppTheme.errorRed, value: 25),
            ShareSegment(color: AppTheme.errorRed, value: 25),
          ],
        ),
      );

      // Три доли, но два отрезка: «убрано из каталога» — одна величина, и
      // зазор внутри неё нарисовал бы границу, которой по смыслу нет.
      expect(segmentWidths(tester), hasLength(2));
    });

    testWidgets('отрезки разных цветов не сливаются', (tester) async {
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.statusGreen, value: 50),
            ShareSegment(color: AppTheme.errorRed, value: 25),
            ShareSegment(color: AppTheme.textGrey, value: 25),
          ],
        ),
      );

      expect(segmentWidths(tester), hasLength(3));
    });

    testWidgets('нулевые доли отрезков не получают', (tester) async {
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.statusGreen, value: 10),
            ShareSegment(color: AppTheme.primaryOrange, value: 0),
            ShareSegment(color: AppTheme.errorRed, value: 10),
          ],
        ),
      );

      expect(segmentWidths(tester), hasLength(2));
    });

    testWidgets('крошечная ненулевая доля остаётся видимой', (tester) async {
      // 15 из 3480 — это 0,43%: при честной пропорции 1,4 пикселя на 320,
      // то есть полоса молча спорила бы с легендой, где 15 написано.
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.textGrey, value: 3291),
            ShareSegment(color: AppTheme.primaryOrange, value: 174),
            ShareSegment(color: AppTheme.statusGreen, value: 15),
          ],
        ),
      );

      final widths = segmentWidths(tester);
      expect(widths, hasLength(3));
      expect(widths.last, greaterThanOrEqualTo(4));
    });

    testWidgets('отрезки занимают ровно доступную ширину', (tester) async {
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.textGrey, value: 3291),
            ShareSegment(color: AppTheme.primaryOrange, value: 174),
            ShareSegment(color: AppTheme.statusGreen, value: 15),
          ],
        ),
      );

      final widths = segmentWidths(tester);
      // Подтягивание крошечного отрезка обязано быть скомпенсировано, иначе
      // полоса вылезет за карточку.
      final gaps = 2.0 * (widths.length - 1);
      expect(widths.reduce((a, b) => a + b) + gaps, closeTo(320, 0.1));
    });

    testWidgets('пустое распределение даёт пустую дорожку, а не ошибку',
        (tester) async {
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.statusGreen, value: 0),
          ],
        ),
      );

      expect(tester.takeException(), isNull);
      expect(segmentWidths(tester), isEmpty);
    });

    testWidgets('единственная доля занимает полосу целиком', (tester) async {
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.statusGreen, value: 412),
          ],
        ),
      );

      expect(segmentWidths(tester), <double>[320]);
    });

    testWidgets('узкая полоса не роняет экран', (tester) async {
      // Ширина меньше суммы минимумов: `clamp` с нижней границей выше верхней
      // бросает, и вместо раздела вставала бы красная коробка.
      await pump(
        tester,
        const ShareBar(
          segments: <ShareSegment>[
            ShareSegment(color: AppTheme.statusGreen, value: 5),
            ShareSegment(color: AppTheme.primaryOrange, value: 3),
            ShareSegment(color: AppTheme.errorRed, value: 2),
          ],
        ),
        width: 12,
      );

      expect(tester.takeException(), isNull);
    });
  });

  group('RankedBarList', () {
    /// Ширина заливки в строке [index].
    double fillWidth(WidgetTester tester, int index) {
      final fills = find.descendant(
        of: find.byType(RankedBarList),
        matching: find.byType(FractionallySizedBox),
      );
      final box = tester.widget<FractionallySizedBox>(fills.at(index));
      final track = tester.getSize(
        find.ancestor(of: fills.at(index), matching: find.byType(ClipRRect)).first,
      );
      return track.width * (box.widthFactor ?? 0);
    }

    testWidgets('полоса меряется от максимума, а не от суммы', (tester) async {
      await pump(
        tester,
        const RankedBarList.spacious(
          items: <RankedBarItem>[
            RankedBarItem(label: 'Минск', value: 214),
            RankedBarItem(label: 'Гомель', value: 107),
          ],
        ),
      );

      final fills = find.descendant(
        of: find.byType(RankedBarList),
        matching: find.byType(FractionallySizedBox),
      );

      // Соотношение строк между собой от знаменателя не зависит — и от суммы,
      // и от максимума оно одинаково. Различает их ровно одно: при масштабе от
      // максимума верхняя строка заполнена целиком. От суммы Минск занял бы
      // 67% дорожки, и «сколько это от лидера» пришлось бы считать в уме.
      expect(tester.widget<FractionallySizedBox>(fills.at(0)).widthFactor, 1.0);
      expect(
        tester.widget<FractionallySizedBox>(fills.at(1)).widthFactor,
        closeTo(0.5, 0.001),
      );
      expect(fillWidth(tester, 1) / fillWidth(tester, 0), closeTo(0.5, 0.01));
    });

    testWidgets('строки идут по убыванию независимо от порядка данных',
        (tester) async {
      await pump(
        tester,
        const RankedBarList.dense(
          items: <RankedBarItem>[
            RankedBarItem(label: 'Бар', value: 41),
            RankedBarItem(label: 'Ресторан', value: 96),
            RankedBarItem(label: 'Кафе', value: 68),
          ],
        ),
      );

      final labels = tester
          .widgetList<Text>(
            find.descendant(
              of: find.byType(RankedBarList),
              matching: find.byType(Text),
            ),
          )
          .map((t) => t.data)
          .toList();

      // Подпись и число чередуются: [Ресторан, 96, Кафе, 68, Бар, 41].
      expect(labels, <String>['Ресторан', '96', 'Кафе', '68', 'Бар', '41']);
    });

    testWidgets('maxItems обрезает хвост, а масштаб берётся по показанным',
        (tester) async {
      await pump(
        tester,
        const RankedBarList.dense(
          maxItems: 2,
          items: <RankedBarItem>[
            RankedBarItem(label: 'Ресторан', value: 96),
            RankedBarItem(label: 'Кофейня', value: 74),
            RankedBarItem(label: 'Паб', value: 22),
          ],
        ),
      );

      expect(find.text('Паб'), findsNothing);
      expect(fillWidth(tester, 1) / fillWidth(tester, 0), closeTo(74 / 96, 0.01));
    });

    testWidgets('единственная строка занимает полную полосу', (tester) async {
      await pump(
        tester,
        const RankedBarList.spacious(
          items: <RankedBarItem>[RankedBarItem(label: 'Минск', value: 3)],
        ),
      );

      final fills = find.descendant(
        of: find.byType(RankedBarList),
        matching: find.byType(FractionallySizedBox),
      );
      expect(tester.widget<FractionallySizedBox>(fills.first).widthFactor, 1.0);
    });
  });
}
