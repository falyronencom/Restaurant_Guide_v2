import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/walk_reach.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/map/walk_controls.dart';

import '../support/wire_fixtures.dart';

/// Что видит гость, когда часы заведения неизвестны или битые.
///
/// Проверка 06.11.2026: партнёр на сайте включал день и не вводил время, сервер
/// сохранял `{is_open: true, open: '', close: ''}`, и в этот день недели
/// `int.parse('')` при отрисовке карточки занимал весь список блоком ошибки
/// высотой 100 000 dp: заведения ниже были недоступны. Часы здесь одинаковые на
/// всю неделю, поэтому от дня и часа машины тесты не зависят.
Map<String, dynamic> _everyDay(Object hours) => {
      for (final day in const [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ])
        day: hours,
    };

const _noTimes = {'is_open': true, 'open': '', 'close': ''};

Establishment _place(String name, Map<String, dynamic>? hours) =>
    Establishment.fromJson(establishmentRow(name: name, workingHours: hours));

Future<void> _pumpList(WidgetTester tester, List<Establishment> places) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(390, 1600);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    home: Scaffold(
      body: ListView(children: [
        for (final place in places) EstablishmentCard(establishment: place),
      ]),
    ),
  ));
  await tester.pump();
}

/// Строка статуса карточки: первый кусок — подпись статуса, по нему виден цвет.
TextSpan _statusSpan(WidgetTester tester, String label) {
  final line = find.byWidgetPredicate(
    (w) => w is RichText && w.text.toPlainText().startsWith(label),
  );
  expect(line, findsOneWidget, reason: 'нет строки статуса «$label»');
  final root = (tester.widget(line) as RichText).text as TextSpan;
  return root.children!.first as TextSpan;
}

void main() {
  group('список: одна плохая карточка не мешает остальным', () {
    final broken = <String, Object?>{
      'открытый день без времени': _everyDay(_noTimes),
      'открытый день с одним временем':
          _everyDay({'is_open': true, 'open': '10:00'}),
      'время, которого нет': _everyDay({'open': '25:99', 'close': '22:00'}),
      'время буквами': _everyDay({'open': 'abc', 'close': 'def'}),
      'время числом': _everyDay({'open': 10, 'close': 22}),
    };

    broken.forEach((name, hours) {
      testWidgets('$name: карточка и заведения ниже на месте', (tester) async {
        await _pumpList(tester, [
          _place('Первое', _everyDay('00:00-00:00')),
          _place('С плохими часами', hours as Map<String, dynamic>),
          _place('Третье', _everyDay('00:00-00:00')),
        ]);

        expect(tester.takeException(), isNull);
        expect(find.byType(ErrorWidget), findsNothing);
        expect(find.textContaining('С плохими часами'), findsOneWidget);
        expect(find.textContaining('Третье'), findsOneWidget);
      });
    });
  });

  group('подпись в карточке выдачи', () {
    testWidgets('часы неизвестны — «Часы не указаны» серым, не зелёное «Открыто»',
        (tester) async {
      await _pumpList(tester, [_place('Без времени', _everyDay(_noTimes))]);

      final span = _statusSpan(tester, 'Часы не указаны');
      expect(span.text, 'Часы не указаны');
      expect(span.style?.color, AppTheme.textSecondary);
      expect(find.textContaining('до '), findsNothing);
    });

    testWidgets('часов нет вовсе — та же подпись', (tester) async {
      await _pumpList(tester, [_place('Без часов', null)]);

      _statusSpan(tester, 'Часы не указаны');
    });

    testWidgets('открыто — зелёным, со временем закрытия', (tester) async {
      await _pumpList(
          tester, [_place('Круглосуточно', _everyDay('00:00-00:00'))]);

      final span = _statusSpan(tester, 'Открыто');
      expect(span.style?.color, AppTheme.statusGreen);
    });

    testWidgets('закрыто — красным, без времени', (tester) async {
      await _pumpList(
          tester, [_place('Выходной', _everyDay({'is_open': false}))]);

      final span = _statusSpan(tester, 'Закрыто');
      expect(span.style?.color, Colors.red);
    });
  });

  group('карточка в «Прогулке»', () {
    Future<void> pumpWalkCard(WidgetTester tester, Establishment place) async {
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Center(child: WalkPlaceCard(place: WalkPlace(place, 550))),
        ),
      ));
      await tester.pump();
    }

    testWidgets('часы неизвестны — «Часы не указаны» серым', (tester) async {
      await pumpWalkCard(tester, _place('Без времени', _everyDay(_noTimes)));

      expect(tester.takeException(), isNull);
      final text = tester.widget<Text>(find.text('Часы не указаны'));
      expect(text.style?.color, AppTheme.gray600);
    });

    testWidgets('открыто — зелёным, со временем закрытия', (tester) async {
      await pumpWalkCard(
          tester, _place('Круглосуточно', _everyDay('00:00-00:00')));

      final text = tester.widget<Text>(find.text('Открыто · до 00:00'));
      expect(text.style?.color, AppTheme.statusGreen);
    });

    testWidgets('закрыто — красным', (tester) async {
      await pumpWalkCard(tester, _place('Выходной', _everyDay({'is_open': false})));

      final text = tester.widget<Text>(find.text('Закрыто'));
      expect(text.style?.color, AppTheme.errorRed);
    });
  });
}
