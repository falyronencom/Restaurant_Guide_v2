import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/definition_grid.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

// Режим чтения панели разбора — кадры 11–13. У одобренного заведения решать
// нечего, поэтому строки полей с вердиктами заменены сеткой значений, а имя,
// статус и причины переехали в отдельные блоки. Проверяется то, что при этом
// легко потерять: раскладка сетки, попадание причин в блок и отсутствие
// вердикт-кнопок там, где выносить вердикт не по чему.

EstablishmentDetail _detail({
  String status = 'active',
  String? city = 'Минск',
  Map<String, dynamic>? moderationNotes,
}) {
  return EstablishmentDetail(
    id: 'a41f9c02-1234-5678-9abc-def012345678',
    partnerId: 'p-1',
    name: 'Кухмістр',
    status: status,
    city: city,
    categories: const <String>['Ресторан'],
    cuisines: const <String>['Народная'],
    phone: '+375 29 611-24-80',
    unp: '191482073',
    legalName: 'ООО «Кухмістр Плюс»',
    moderationNotes: moderationNotes,
  );
}

Future<void> _pumpPanel(
  WidgetTester tester, {
  required DetailPanelMode mode,
  EstablishmentDetail? detail,
  Map<String, dynamic>? rejectionNotes,
}) async {
  tester.view.physicalSize = const Size(1440, 820);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ModerationDetailPanel(
          mode: mode,
          detail: detail ?? _detail(),
          selectedId: 'a41f9c02-1234-5678-9abc-def012345678',
          isLoadingDetail: false,
          rejectionNotes: rejectionNotes,
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  group('Сетка определений', () {
    Future<void> pumpGrid(
      WidgetTester tester,
      List<Definition> items,
    ) async {
      tester.view.physicalSize = const Size(1000, 820);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(body: DefinitionGrid(items: items)),
        ),
      );
      await tester.pump();
    }

    testWidgets('обычные ячейки встают по две в строку', (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'Первая', value: '1'),
        Definition(label: 'Вторая', value: '2'),
      ]);

      // Обе на одной высоте — значит в одной строке.
      expect(
        tester.getRect(find.text('Первая')).top,
        tester.getRect(find.text('Вторая')).top,
      );
      // И в разных колонках.
      expect(
        tester.getRect(find.text('Первая')).left,
        lessThan(tester.getRect(find.text('Вторая')).left),
      );
    });

    testWidgets('широкая ячейка забирает строку целиком', (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'Описание', value: 'Проза', wide: true),
        Definition(label: 'Телефон', value: '+375'),
      ]);

      // Широкая не делит строку с соседкой: следующая ячейка ниже.
      expect(
        tester.getRect(find.text('Телефон')).top,
        greaterThan(tester.getRect(find.text('Описание')).top),
      );

      // И — главное — она действительно ШИРЕ обычной, а не просто стоит
      // одна в строке. Проверка по соседству это пропускала: обёртка из
      // двух Expanded отдавала половину ширины пустышке, и «широкая» ячейка
      // выходила ровно такой же, как рядовая.
      final wide = tester.getRect(find.byType(Container).at(0)).width;
      final normal = tester.getRect(find.byType(Container).at(1)).width;
      expect(wide, greaterThan(normal * 1.8));
    });

    testWidgets('пустое значение называется «не указан», а не прячется',
        (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'Сайт'),
        Definition(label: 'Телефон', value: '   '),
      ]);

      // Пустое поле у одобренного заведения — само по себе сведение.
      expect(find.text('Сайт'), findsOneWidget);
      expect(find.text('не указан'), findsNWidgets(2));
    });

    testWidgets('величина показывается моноширинным', (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'УНП', value: '191482073', mono: true),
        Definition(label: 'Название', value: 'Кухмістр'),
      ]);

      // Семейство именно моноширинное. Сверяем по префиксу, а не по
      // AppTheme.fontMonoFamily: google_fonts регистрирует каждое начертание
      // отдельным семейством, и у веса 500 имя своё — JetBrainsMono_500.
      expect(
        tester.widget<Text>(find.text('191482073')).style?.fontFamily,
        startsWith('JetBrainsMono'),
      );
      // А проза — нет: тип данных различается шрифтом, не цветом.
      expect(
        tester.widget<Text>(find.text('Кухмістр')).style?.fontFamily,
        isNot(startsWith('JetBrainsMono')),
      );
    });
  });

  group('Панель в режиме чтения', () {
    testWidgets('показывает имя и статус словом', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);

      // Имя встречается дважды и это верно: крупно в шапке панели и ячейкой
      // «Название» в сетке — так же, как нарисовано в кадре 11.
      expect(find.text('Кухмістр'), findsNWidgets(2));
      expect(find.text('опубликовано'), findsOneWidget);
      // Машинного кода на экране модератора быть не должно.
      expect(find.text('active'), findsNothing);
    });

    testWidgets('вердикт-кнопок и нижней панели нет', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);

      // Решать нечего: заведение уже одобрено.
      expect(find.text('Одобрить заведение'), findsNothing);
      expect(find.text('Отклонить заявку'), findsNothing);
    });

    testWidgets('имя в шапке — дисплейным кеглем канона', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);

      // Крупный заголовок ровно один: Unbounded 30. Второе вхождение имени —
      // это ячейка сетки кеглем 15, и спутать их нельзя.
      final display = find
          .byWidgetPredicate((w) => w is Text && w.style?.fontSize == 30)
          .evaluate();
      expect(display.length, 1);
      expect(
        (display.first.widget as Text).style?.fontFamily,
        startsWith('Unbounded'),
      );
    });
  });

  group('Блок причин отказа', () {
    testWidgets('собирает причины и считает только заполненные',
        (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.readonly,
        rejectionNotes: <String, dynamic>{
          'address': 'Адрес не совпадает с меткой',
          'photos': 'Нет фото интерьера',
          'unp': '   ',
        },
      );

      expect(find.text('Причины отказа'), findsOneWidget);
      // Пустая причина в счёт не идёт — иначе чип обещал бы работу,
      // которой в списке нет.
      expect(find.text('2 поля'), findsOneWidget);
      expect(find.text('Адрес не совпадает с меткой'), findsOneWidget);
    });

    testWidgets('без причин блок не появляется', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);
      expect(find.text('Причины отказа'), findsNothing);
    });
  });

  group('Блок причины приостановки', () {
    testWidgets('показывает причину и время', (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.suspended,
        detail: _detail(
          status: 'suspended',
          moderationNotes: <String, dynamic>{
            'suspend_reason': 'Жалобы на санитарное состояние кухни',
            'suspended_at': '2026-08-07T11:40:00.000Z',
          },
        ),
      );

      expect(find.text('Причина приостановки'), findsOneWidget);
      expect(find.text('Жалобы на санитарное состояние кухни'), findsOneWidget);
      expect(find.text('приостановлено'), findsOneWidget);

      // Время — местное, а не UTC. Ожидание считается тем же переводом,
      // поэтому на машине в UTC (как в CI) проверка тавтологична и пройдёт
      // всегда; смысл она имеет там, где разработка и идёт — на UTC+3, где
      // без `.toLocal()` метка уезжает на три часа, а всё после 21:00 ещё и
      // на вчерашнее число.
      final local = DateTime.parse('2026-08-07T11:40:00.000Z').toLocal();
      String two(int n) => n.toString().padLeft(2, '0');
      expect(
        find.textContaining('${two(local.day)}.${two(local.month)}'),
        findsOneWidget,
      );
      expect(
        find.textContaining('${two(local.hour)}:${two(local.minute)}'),
        findsOneWidget,
      );
    });

    testWidgets('без причины блок не появляется', (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.suspended,
        detail: _detail(status: 'suspended'),
      );
      expect(find.text('Причина приостановки'), findsNothing);
    });
  });
}
