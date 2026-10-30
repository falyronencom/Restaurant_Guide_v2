import 'dart:convert' show jsonDecode, jsonEncode;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
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
const _closedGrey = AppTheme.textGrey;

/// Деталь для режима модерации: панель берёт её у провайдера, а провайдер —
/// у сервиса.
class _DetailService implements ModerationService {
  _DetailService(this.detail);

  final EstablishmentDetail detail;

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async =>
      detail;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

Future<void> _pumpHours(
  WidgetTester tester,
  Map<String, Object?> hours, {
  DetailPanelMode mode = DetailPanelMode.readonly,
}) async {
  tester.view.physicalSize = const Size(1440, 1200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

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

  if (mode == DetailPanelMode.moderation) {
    final provider = ModerationProvider(service: _DetailService(detail));
    addTearDown(provider.dispose);
    await provider.selectEstablishment(detail.id);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<ModerationProvider>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: ModerationDetailPanel()),
        ),
      ),
    );
  } else {
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
  }
  // Вторая вкладка — «О заведении». В режиме модерации её подпись несёт
  // счётчик («О заведении 0/6») и строится `Text.rich`, поэтому — по месту.
  await tester.tap(find.byType(Tab).at(1));
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
      // У вторника и среды часы разные: на одинаковых значениях подписи
      // дней, переставленные местами, были бы неотличимы.
      await _pumpHours(tester, <String, Object?>{
        'monday': <String, Object?>{'is_open': false},
        'tuesday': '08:00-22:00',
        'wednesday': '09:00-21:00',
        'thursday': '08:00-22:00',
        'friday': '08:00-23:30',
        // Через полночь — законно для бара; панель это не судит.
        'saturday': '12:00-02:00',
        'sunday': '12:00-22:00',
      });

      expect(_week(tester), <String, String?>{
        'Понедельник': 'Закрыто',
        'Вторник': '08:00 – 22:00',
        'Среда': '09:00 – 21:00',
        'Четверг': '08:00 – 22:00',
        'Пятница': '08:00 – 23:30',
        'Суббота': '12:00 – 02:00',
        'Воскресенье': '12:00 – 22:00',
      });
      // Порядок дней — с понедельника: карта выше порядка не видит.
      final tops = <double>[
        for (final day in _days) tester.getRect(find.text(day)).top,
      ];
      for (var i = 1; i < tops.length; i++) {
        expect(tops[i], greaterThan(tops[i - 1]), reason: '${_days[i]} ниже');
      }
      // Закрытым день делает и цвет: рабочий день, оставшийся серым,
      // читался бы выходным и при верном тексте.
      expect(_valueOf(tester, 'Вторник').style?.color, AppTheme.textPrimary);
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
      expect(_valueOf(tester, 'Пятница').style?.color, AppTheme.textPrimary);
      expect(_valueOf(tester, 'Суббота').style?.color, _closedGrey);
    });

    testWidgets('в режиме модерации — те же часы работы, а не другое расписание',
        (tester) async {
      // Модератор проверяет обязательное поле «Часы работы» в очереди, то
      // есть в режиме модерации; там рядом стоит второе расписание — время
      // дополнительного меню. Его здесь нет, и подставь панель его вместо
      // часов, недели в карточке не было бы вовсе.
      await _pumpHours(
        tester,
        <String, Object?>{
          'monday': <String, Object?>{'is_open': false},
          'tuesday': '08:00-22:00',
          'wednesday': '09:00-21:00',
          'thursday': '10:00-20:00',
          'friday': '08:00-23:30',
          'saturday': '12:00-02:00',
          'sunday': '12:00-22:00',
        },
        mode: DetailPanelMode.moderation,
      );

      expect(find.text('Понедельник'), findsOneWidget,
          reason: 'неделя часов работы на вкладке — ровно одна');
      expect(_week(tester), <String, String?>{
        'Понедельник': 'Закрыто',
        'Вторник': '08:00 – 22:00',
        'Среда': '09:00 – 21:00',
        'Четверг': '10:00 – 20:00',
        'Пятница': '08:00 – 23:30',
        'Суббота': '12:00 – 02:00',
        'Воскресенье': '12:00 – 22:00',
      });
    });

    testWidgets('объект без is_open — рабочий день, как на сайте',
        (tester) async {
      // Сайт, приложение и монитор качества читают `{open, close}` без флага
      // как рабочий день. Панель была единственной, кто показывал «Закрыто».
      await _pumpHours(tester, <String, Object?>{
        'monday': <String, Object?>{'open': '10:00', 'close': '20:00'},
      });

      expect(_valueOf(tester, 'Понедельник').data, '10:00 – 20:00');
      expect(_valueOf(tester, 'Понедельник').style?.color, AppTheme.textPrimary);
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
