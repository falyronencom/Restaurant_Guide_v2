import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_combo_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_line_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/chart_scale.dart';
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


  group('CanonComboChart — две шкалы', () {
    List<TimelinePoint> series() => const <TimelinePoint>[
          TimelinePoint(date: '2026-08-01', count: 40, averageRating: 4.2),
          TimelinePoint(date: '2026-08-02', count: 60, averageRating: 4.6),
          TimelinePoint(date: '2026-08-03', count: 20, averageRating: 3.1),
        ];

    LineChartData lineData(WidgetTester tester) => tester
        .widget<LineChart>(find.byType(LineChart))
        .data;

    BarChartData barData(WidgetTester tester) => tester
        .widget<BarChart>(find.byType(BarChart))
        .data;

    testWidgets('оценка живёт на СВОЕЙ шкале, а не подмешана в шкалу количества',
        (tester) async {
      await pump(
        tester,
        SizedBox(height: 200, child: CanonComboChart(data: series())),
        width: 500,
      );

      // Ровно этот дефект и уносит этап 6: прежний график считал оценку как
      // `(rating / 5) * maxY`, то есть выводил её по шкале КОЛИЧЕСТВА, и у
      // линии не было величины, по которой её можно расшифровать.
      expect(lineData(tester).minY, CanonComboChart.minRating);
      expect(lineData(tester).maxY, CanonComboChart.maxRating);

      // Шкала количества — своя и совсем другая.
      expect(barData(tester).maxY, greaterThan(CanonComboChart.maxRating));
    });

    testWidgets('правая шкала подписана — линию есть чем расшифровать',
        (tester) async {
      await pump(
        tester,
        SizedBox(height: 200, child: CanonComboChart(data: series())),
        width: 500,
      );

      // Проверяется не флаг, а нарисованное: подписи шкалы оценки должны
      // быть НА ЭКРАНЕ, иначе линию нечем расшифровать — ровно тот дефект,
      // ради которого этап и затевался.
      //
      // Флаг `showTitles` для этого не годится: у зеркальных сторон он тоже
      // включён, потому что иначе `fl_chart` отбрасывает их резерв и поля
      // построения расходятся; рисуют они при этом пустоту.
      for (final label in <String>['1', '2', '3', '4', '5']) {
        expect(
          find.descendant(
            of: find.byType(LineChart),
            matching: find.text(label),
          ),
          findsOneWidget,
          reason: 'на шкале оценки нет деления $label',
        );
      }
    });

    /// Фактический прямоугольник построения графика — коробка минус поля,
    /// которые `fl_chart` отвёл под подписи.
    Rect plotRect(WidgetTester tester, Type chart) {
      final margin = tester
          .widgetList<Container>(
            find.descendant(of: find.byType(chart), matching: find.byType(Container)),
          )
          .map((c) => c.margin)
          .whereType<EdgeInsets>()
          .first;
      final box = tester.getRect(find.byType(chart));
      return Rect.fromLTRB(
        box.left + margin.left,
        box.top + margin.top,
        box.right - margin.right,
        box.bottom - margin.bottom,
      );
    }

    testWidgets('поля построения двух графиков совпадают', (tester) async {
      await pump(
        tester,
        SizedBox(height: 200, child: CanonComboChart(data: series())),
        width: 500,
      );

      // Меряется ФАКТИЧЕСКОЕ поле, а не заявленные резервы. Прежняя редакция
      // этого теста сравнивала `reservedSize` — свойство, которое геометрию не
      // определяет: `fl_chart` учитывает резерв только там, где подписи
      // включены (`showSideTitles => showTitles && reservedSize != 0`), и тест
      // оставался зелёным при расхождении полей на сорок пикселей.
      expect(plotRect(tester, LineChart), plotRect(tester, BarChart));
    });

    testWidgets('столбцы и точки живут в одной сетке слотов', (tester) async {
      await pump(
        tester,
        SizedBox(height: 200, child: CanonComboChart(data: series())),
        width: 500,
      );

      // ГРАНИЦА ЭТОГО ТЕСТА НАЗВАНА ЧЕСТНО: он сверяет НАСТРОЙКИ, а не
      // пиксели. Настоящие координаты столбцов считает `calculateGroupsX`,
      // а это расширение `fl_chart` наружу не экспортирует; тултипы рисуются
      // на канве, поэтому и через касание позицию не прочитать.
      //
      // Сверяемая пара выведена из исходника `calculateGroupsX`:
      // `spaceAround` ставит центр группы i в (i + ½)·W/n — независимо от
      // ширины столбца, — а линия с доменом [-½; n-½] отображает x = i ровно
      // туда же. Порознь ни одна из настроек смысла не имеет, поэтому
      // проверяются обе: подмена любой ломает совмещение.
      expect(barData(tester).alignment, BarChartAlignment.spaceAround);
      expect(lineData(tester).minX, -0.5);
      expect(lineData(tester).maxX, series().length - 0.5);
    });

    testWidgets('тултип называет тот день, на который навели', (tester) async {
      await pump(
        tester,
        SizedBox(height: 200, child: CanonComboChart(data: series())),
        width: 500,
      );

      final build = barData(tester).barTouchData.touchTooltipData.getTooltipItem;
      final rod = BarChartRodData(toY: 0);
      final group = BarChartGroupData(x: 0, barRods: <BarChartRodData>[rod]);

      // Четвёртый параметр коллбэка — `rodIndex`, а стержень в группе один,
      // поэтому он всегда ноль: тултип показывал первый день ряда, на какой
      // столбец ни наведись. Нужен второй параметр — индекс группы.
      expect(build(group, 0, rod, 0)?.text, startsWith('40 отзывов'));
      expect(build(group, 1, rod, 0)?.text, startsWith('60 отзывов'));
      expect(build(group, 2, rod, 0)?.text, startsWith('20 отзывов'));
    });

    testWidgets('верх шкалы количества делится на четыре без остатка',
        (tester) async {
      // Иначе подписи, печатаемые целыми, встают не на свои линии сетки:
      // при пяти отзывах шаг выходил 1,5, и столбец высотой 2 оказывался
      // ВЫШЕ линии, подписанной «2».
      for (final count in <int>[1, 5, 7, 11, 13, 40, 97]) {
        final maxY = niceMaxY(count);
        expect(maxY % 4, 0, reason: 'верх $maxY при $count не делится на 4');
        expect(maxY, greaterThanOrEqualTo(count.toDouble()));
      }
    });

    testWidgets('пустой ряд объясняется словами', (tester) async {
      await pump(
        tester,
        const SizedBox(
          height: 200,
          child: CanonComboChart(data: <TimelinePoint>[]),
        ),
        width: 500,
      );

      expect(find.text('За выбранный период отзывов не оставляли'),
          findsOneWidget);
      expect(find.byType(BarChart), findsNothing);
    });
  });

  group('CanonComboChart — разрывы линии оценки', () {
    testWidgets('день без отзывов рвёт линию, а не соединяется через него',
        (tester) async {
      const data = <TimelinePoint>[
        TimelinePoint(date: '2026-08-01', count: 5, averageRating: 4.0),
        TimelinePoint(date: '2026-08-02', count: 0),
        TimelinePoint(date: '2026-08-03', count: 3, averageRating: 2.0),
      ];

      final segments = CanonComboChart.ratingSegments(data);

      // Отрезок через пустой день изображал бы плавный переход 4 → 2,
      // которого никто не наблюдал: в тот день оценки не существовало.
      expect(segments, hasLength(2));
      expect(segments[0].single.y, 4.0);
      expect(segments[1].single.y, 2.0);
    });

    testWidgets('непрерывный ряд — один отрезок', (tester) async {
      const data = <TimelinePoint>[
        TimelinePoint(date: '2026-08-01', count: 5, averageRating: 4.0),
        TimelinePoint(date: '2026-08-02', count: 2, averageRating: 3.0),
      ];

      expect(CanonComboChart.ratingSegments(data), hasLength(1));
      expect(CanonComboChart.ratingSegments(data).single, hasLength(2));
    });

    testWidgets('x-координата отрезка — позиция дня, а не номер в отрезке',
        (tester) async {
      const data = <TimelinePoint>[
        TimelinePoint(date: '2026-08-01', count: 0),
        TimelinePoint(date: '2026-08-02', count: 0),
        TimelinePoint(date: '2026-08-03', count: 3, averageRating: 5.0),
      ];

      // Иначе одинокая точка третьего дня встала бы над первым столбцом.
      expect(CanonComboChart.ratingSegments(data).single.single.x, 2.0);
    });

    testWidgets('оценка вне домена прижимается к шкале, а не улетает за поле',
        (tester) async {
      const data = <TimelinePoint>[
        TimelinePoint(date: '2026-08-01', count: 1, averageRating: 0.4),
        TimelinePoint(date: '2026-08-02', count: 1, averageRating: 5.4),
      ];

      final spots = CanonComboChart.ratingSegments(data).single;
      expect(spots[0].y, CanonComboChart.minRating);
      expect(spots[1].y, CanonComboChart.maxRating);
    });
  });


  group('CanonLineChart', () {
    // У одношкального графика не было ни одного теста, хотя он обслуживает
    // дашборд и кадры 08 и 10. Шкалу ему на этапе 6 поменяли — покрываем.

    testWidgets('подписи шкалы стоят на своих линиях сетки', (tester) async {
      // Пять событий: прежде верх выходил 6, шаг 1,5, подписи печатались
      // целыми — и столбец высотой 2 оказывался выше линии, подписанной «2».
      await pump(
        tester,
        const SizedBox(
          height: 200,
          child: CanonLineChart(
            data: <TimelinePoint>[
              TimelinePoint(date: '2026-08-01', count: 5),
              TimelinePoint(date: '2026-08-02', count: 3),
            ],
          ),
        ),
        width: 500,
      );

      final data = tester.widget<LineChart>(find.byType(LineChart)).data;
      final step = data.gridData.horizontalInterval!;

      expect(data.maxY % 4, 0);
      expect(step, step.roundToDouble());
    });

    testWidgets('пустой ряд объясняется словами вызывающего', (tester) async {
      await pump(
        tester,
        const SizedBox(
          height: 200,
          child: CanonLineChart(
            data: <TimelinePoint>[],
            emptyMessage: 'За выбранный период заведений не создавали',
          ),
        ),
        width: 500,
      );

      expect(find.text('За выбранный период заведений не создавали'),
          findsOneWidget);
    });

    testWidgets('месячная агрегация подписывается без данных локали',
        (tester) async {
      // `DateFormat('MMM','ru')` здесь бросает: делегатов локали в тесте нет.
      // Ради этого месяцы и написаны руками в `formatters.dart`.
      await pump(
        tester,
        const SizedBox(
          height: 200,
          child: CanonLineChart(
            aggregation: 'month',
            data: <TimelinePoint>[
              TimelinePoint(date: '2026-07-01', count: 4),
              TimelinePoint(date: '2026-08-01', count: 9),
            ],
          ),
        ),
        width: 500,
      );

      expect(tester.takeException(), isNull);
      expect(find.text('июл'), findsOneWidget);
      expect(find.text('авг'), findsOneWidget);
    });
  });
}
