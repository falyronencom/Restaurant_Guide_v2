import 'dart:convert' show jsonDecode, jsonEncode;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

// Часы работы в панели разбора — в обеих формах, в которых их хранит база.
//
// `working_hours` пишут два источника, и пишут по-разному. Кабинет партнёра —
// объектом `{is_open: true, open: '09:00', close: '21:00'}`, пакетный импорт
// (`backend/scripts/seed-import/sheet.js`) — строкой `'08:00-22:00'`; выходной
// у обоих — `{is_open: false}`. Панель читала только объект, и у каждой
// импортированной карточки все рабочие дни выходили «Закрыто».
//
// Импорт публикует карточку сразу, поэтому модератор встречает её на
// «Одобренных», то есть в режиме чтения, — его и монтируем. Режим модерации
// рисует часы тем же виджетом.

const _days = <String>[
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];

/// Серый, которым панель гасит закрытый день.
const _closedGrey = Color(0xFFABABAB);

Future<void> _pumpHours(
  WidgetTester tester,
  Map<String, Object?> hours,
) async {
  tester.view.physicalSize = const Size(1440, 1200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  // Часы — на второй вкладке, а переход по вкладкам кончается прокруткой.
  // Конец любой прокрутки (`ScrollableState.saveOffset`) будит менеджер
  // восстановления состояния: стенд создаёт его лениво, а освобождает только
  // в начале СЛЕДУЮЩЕГО теста (`binding.reset()`). Последнему тесту файла
  // следующего не достаётся, и сторож течей (`allNotDisposed`) отчитывается о
  // `TestRestorationManager` с его корзиной — течь стенда, а не панели.
  // Освобождаем тем же вызовом, что и сам стенд, только раньше.
  addTearDown(tester.binding.reset);

  // Через JSON — чтобы панель получила те же типы, что приходят с сервера,
  // а не литералы теста.
  final detail = EstablishmentDetail.fromJson(
    jsonDecode(jsonEncode(<String, Object?>{
      'id': 'a41f9c02-1234-5678-9abc-def012345678',
      'partner_id': 'p-1',
      'name': 'Кухмістр',
      'status': 'active',
      'working_hours': hours,
    })) as Map<String, dynamic>,
  );

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ModerationDetailPanel(
          mode: DetailPanelMode.readonly,
          detail: detail,
          selectedId: detail.id,
          isLoadingDetail: false,
        ),
      ),
    ),
  );
  await tester.tap(find.text('О заведении'));
  await tester.pumpAndSettle();
}

/// Ячейка значения в строке дня. Строка — ближайший `Row` над названием
/// дня, значение в ней — второй текст, после названия.
Text _valueOf(WidgetTester tester, String day) {
  final row =
      find.ancestor(of: find.text(day), matching: find.byType(Row)).first;
  return tester.widget<Text>(
    find.descendant(of: row, matching: find.byType(Text)).last,
  );
}

/// Неделя так, как её видит модератор: день → что написано напротив.
Map<String, String?> _week(WidgetTester tester) => <String, String?>{
      for (final day in _days) day: _valueOf(tester, day).data,
    };

void main() {
  group('Часы работы в панели разбора', () {
    testWidgets('строки импорта читаются как часы, а не как «Закрыто»',
        (tester) async {
      // Ровно то, что пишет sheet.js: рабочий день строкой, выходной объектом.
      await _pumpHours(tester, <String, Object?>{
        'monday': <String, Object?>{'is_open': false},
        'tuesday': '08:00-22:00',
        'wednesday': '08:00-22:00',
        'thursday': '08:00-22:00',
        'friday': '08:00-23:30',
        // Через полночь — законно для бара; панель это не судит.
        'saturday': '12:00-02:00',
        'sunday': '12:00-22:00',
      });

      expect(_week(tester), <String, String?>{
        'Понедельник': 'Закрыто',
        'Вторник': '08:00 – 22:00',
        'Среда': '08:00 – 22:00',
        'Четверг': '08:00 – 22:00',
        'Пятница': '08:00 – 23:30',
        'Суббота': '12:00 – 02:00',
        'Воскресенье': '12:00 – 22:00',
      });
      // Закрытым день делает и цвет: рабочий день, оставшийся серым,
      // читался бы выходным и при верном тексте.
      expect(_valueOf(tester, 'Вторник').style?.color, Colors.black);
      expect(_valueOf(tester, 'Понедельник').style?.color, _closedGrey);
    });

    testWidgets('объект кабинета читается как прежде', (tester) async {
      // Форма всех карточек на проде — правка не должна её задеть.
      await _pumpHours(tester, <String, Object?>{
        for (final day in <String>[
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
        ])
          day: <String, Object?>{
            'is_open': true,
            'open': '09:00',
            'close': '21:00',
          },
        'friday': <String, Object?>{
          'is_open': true,
          'open': '11:00',
          'close': '23:00',
        },
        // Регистрация в приложении (`DayWorkingHours.toJson`) у выходного
        // сохраняет введённые времена — рабочим день от этого не становится.
        'saturday': <String, Object?>{
          'is_open': false,
          'open': '10:00',
          'close': '18:00',
        },
        // Кабинет на сайте пишет выходной без времён.
        'sunday': <String, Object?>{'is_open': false},
      });

      expect(_week(tester), <String, String?>{
        'Понедельник': '09:00 – 21:00',
        'Вторник': '09:00 – 21:00',
        'Среда': '09:00 – 21:00',
        'Четверг': '09:00 – 21:00',
        'Пятница': '11:00 – 23:00',
        'Суббота': 'Закрыто',
        'Воскресенье': 'Закрыто',
      });
      expect(_valueOf(tester, 'Пятница').style?.color, Colors.black);
      expect(_valueOf(tester, 'Суббота').style?.color, _closedGrey);
    });

    testWidgets('объект без is_open — рабочий день, как на сайте',
        (tester) async {
      // Сайт, приложение и монитор качества читают `{open, close}` без флага
      // как рабочий день. Панель была единственной, кто показывал «Закрыто».
      await _pumpHours(tester, <String, Object?>{
        'monday': <String, Object?>{'open': '10:00', 'close': '20:00'},
      });

      expect(_valueOf(tester, 'Понедельник').data, '10:00 – 20:00');
      expect(_valueOf(tester, 'Понедельник').style?.color, Colors.black);
    });

    testWidgets('нечитаемая запись — «Закрыто», а не обрывок времени',
        (tester) async {
      await _pumpHours(tester, <String, Object?>{
        // Флаг «открыто» без времени.
        'monday': <String, Object?>{'is_open': true},
        // Пустые поля времени — так выглядел бы рабочий день кабинета,
        // пропущенный проверкой формы.
        'tuesday': <String, Object?>{'is_open': true, 'open': '', 'close': ''},
        // Словами — разбору нечем это прочесть.
        'wednesday': 'круглосуточно',
        // Потерян конец, потеряно начало.
        'thursday': '08:00-',
        'friday': '-22:00',
        // Суббота и воскресенье не записаны вовсе.
      });

      // Как на сайте: что не читается как часы, то не рабочий день.
      expect(_week(tester), <String, String?>{
        for (final day in _days) day: 'Закрыто',
      });
      // И не только словом: «открыто» без времени раньше красилось чёрным —
      // рабочим по цвету при «Закрыто» в тексте.
      expect(_valueOf(tester, 'Понедельник').style?.color, _closedGrey);
    });
  });
}
