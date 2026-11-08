import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/basic_info_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/summary_step.dart';
import 'package:restaurant_guide_mobile/screens/partner/working_hours_screen.dart';

import '../support/wire_stand.dart';

/// Часы работы в мастере партнёра (решение Координатора 06.11.2026, пп. 5–6).
///
/// Нельзя сохранить день, отмеченный рабочим, без обоих времён. Новая карточка не
/// проходит шаг «О заведении» без рабочего дня, и приложение больше не подставляет
/// часы, которых партнёр не указывал. Тексты — литералы, утверждённые Координатором:
/// те же слова у отказа сервера (`workingHoursIncomplete`).
const _oneDay = 'Часы работы заполнены не до конца. Укажите время открытия и '
    'закрытия на понедельник или отметьте этот день выходным.';
const _twoDays = 'Часы работы заполнены не до конца. Укажите время открытия и '
    'закрытия на среду, воскресенье или отметьте эти дни выходными.';

const _open = DayWorkingHours(isOpen: true, openTime: '10:00', closeTime: '22:00');
const _noTimes = DayWorkingHours(isOpen: true);

const _completeCard = PartnerRegistration(
  categories: ['restaurant'],
  cuisineTypes: ['european'],
  name: 'Кофейня у моста',
  phone: '+375291234567',
  priceRange: r'$$',
  interiorPhotos: ['https://res.cloudinary.com/demo/image/upload/a.jpg'],
  menuPhotos: ['https://res.cloudinary.com/demo/image/upload/b.jpg'],
  primaryPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/a.jpg',
  city: 'Минск',
  street: 'Немига',
  building: '1',
  legalName: 'ООО «Мост»',
  unp: '123456789',
  contactPerson: 'Анна',
  contactEmail: 'anna@example.com',
);

void main() {
  group('день с сервера: что партнёр увидит в часах', () {
    test('выходной остаётся выходным и хранит время: включив день, партнёр его '
        'увидит', () {
      final day = DayWorkingHours.fromJson(
          {'is_open': false, 'open': '09:30', 'close': '21:30'});
      expect(day.isOpen, isFalse);
      expect(day.openTime, '09:30');
      expect(day.closeTime, '21:30');
      expect(day.isComplete, isTrue);
    });

    test('выходной с мусором во времени не падает', () {
      final day =
          DayWorkingHours.fromJson({'is_open': false, 'open': '', 'close': 42});
      expect(day.isOpen, isFalse);
      expect(day.openTime, isNull);
      expect(day.closeTime, isNull);
    });

    test('строка импорта читается: падала вся карточка партнёра', () {
      final day = DayWorkingHours.fromJson('10:00-22:00');
      expect(day.isOpen, isTrue);
      expect(day.openTime, '10:00');
      expect(day.closeTime, '22:00');
      expect(day.isComplete, isTrue);
    });

    test('объект без is_open — рабочий день, как его видит гость', () {
      final day = DayWorkingHours.fromJson({'open': '10:00', 'close': '22:00'});
      expect(day.isOpen, isTrue);
      expect(day.isComplete, isTrue);
    });

    for (final entry in <String, Object?>{
      'записи на день нет: при сохранении он не должен стать выходным': null,
      'пустое время (присылал кабинет сайта)': {
        'is_open': true,
        'open': '',
        'close': '',
      },
      'время, которого нет': {'is_open': true, 'open': '25:99', 'close': 'abc'},
      'время числом': {'is_open': true, 'open': 10, 'close': 22},
      'нет ни одного времени': {'is_open': true},
      'строка с мусором': 'abc',
      'число': 42,
    }.entries) {
      test('${entry.key} — рабочий день без времени, а не выходной', () {
        final day = DayWorkingHours.fromJson(entry.value);
        expect(day.isOpen, isTrue);
        expect(day.openTime, isNull);
        expect(day.closeTime, isNull);
        expect(day.isComplete, isFalse);
      });
    }

    test('одно правильное время сохраняется, день всё равно не заполнен', () {
      final day = DayWorkingHours.fromJson({'open': '10:00', 'close': ''});
      expect(day.openTime, '10:00');
      expect(day.closeTime, isNull);
      expect(day.isComplete, isFalse);
    });

    test('неделя из смеси форм собирается, порядок дней не путается', () {
      final week = WeeklyWorkingHours.fromJson({
        'monday': '10:00-22:00',
        'tuesday': {'is_open': false},
        'wednesday': {'is_open': true, 'open': '', 'close': ''},
        'sunday': 'abc',
      });

      // Среда и воскресенье записаны криво; четверг, пятницы и субботы нет вовсе.
      expect(week.incompleteDays, [2, 3, 4, 5, 6]);
      expect(week.hasWorkingDay, isTrue);
      expect(week.monday.openTime, '10:00');
      expect(week.tuesday.isOpen, isFalse);
    });

    test('новая карточка: день по умолчанию — выходной, записи с сервера нет', () {
      expect(const WeeklyWorkingHours().incompleteDays, isEmpty);
      expect(const DayWorkingHours().isOpen, isFalse);
    });

    test('все дни выходные или незаполненные — рабочего дня нет', () {
      expect(const WeeklyWorkingHours().hasWorkingDay, isFalse);
      expect(const WeeklyWorkingHours(monday: _noTimes).hasWorkingDay, isFalse);
      expect(const WeeklyWorkingHours(sunday: _open).hasWorkingDay, isTrue);
    });
  });

  group('текст про незаполненный день', () {
    test('один день и несколько — дословно', () {
      expect(incompleteHoursMessage([0]), _oneDay);
      expect(incompleteHoursMessage([2, 6]), _twoDays);
    });

    test('все дни — в винительном падеже', () {
      expect(
        incompleteHoursMessage([0, 1, 2, 3, 4, 5, 6]),
        contains('на понедельник, вторник, среду, четверг, пятницу, субботу, '
            'воскресенье или отметьте эти дни выходными.'),
      );
    });
  });

  group('в сервер не уходят часы, которых партнёр не указывал', () {
    test('часов нет — поля нет: прежде подставлялись 09:00–21:00', () {
      expect(_completeCard.toJson().containsKey('working_hours'), isFalse);
    });

    test('часы с незаполненным днём не уходят: правка адреса сохранится, а '
        'хранимые часы останутся', () {
      final json = _completeCard
          .copyWith(
            weeklyWorkingHours: const WeeklyWorkingHours(
              monday: _open,
              tuesday: _noTimes,
            ),
          )
          .toJson();

      expect(json.containsKey('working_hours'), isFalse);
      expect(json['address'], 'Немига, 1');
    });

    test('указанные часы уходят как есть', () {
      final json = _completeCard
          .copyWith(
            weeklyWorkingHours: const WeeklyWorkingHours(monday: _open),
          )
          .toJson();

      final hours = json['working_hours'] as Map<String, dynamic>;
      expect(hours['monday'],
          {'is_open': true, 'open': '10:00', 'close': '22:00'});
      expect(hours['tuesday'], {'is_open': false});
    });
  });

  group('шаг «О заведении»', () {
    setUp(() => installWireStand((_) => jsonBody({'success': true})));

    PartnerRegistrationProvider onStep(
      WeeklyWorkingHours? hours, {
      bool editMode = false,
    }) =>
        PartnerRegistrationProvider(
          initialStep: 2,
          editMode: editMode,
          establishmentId: editMode ? 'id-1' : null,
          initialData: PartnerRegistration(
            name: 'Кофейня у моста',
            priceRange: r'$$',
            weeklyWorkingHours: hours,
          ),
        );

    test('новая карточка без часов дальше не идёт, красного текста нет', () {
      final p = onStep(null);
      expect(p.canProceed(), isFalse);
      expect(p.hoursError, isNull);
    });

    test('новая карточка, все дни выходные, — дальше не идёт', () {
      final p = onStep(const WeeklyWorkingHours());
      expect(p.canProceed(), isFalse);
      expect(p.hoursError, isNull);
    });

    test('новая карточка с рабочим днём идёт дальше', () {
      final p = onStep(const WeeklyWorkingHours(friday: _open));
      expect(p.canProceed(), isTrue);
      expect(p.isHoursStepDone, isTrue);
    });

    test('день без времени держит шаг и называется, даже рядом с заполненным',
        () {
      final p = onStep(const WeeklyWorkingHours(
        monday: _open,
        wednesday: _noTimes,
        sunday: _noTimes,
      ));
      expect(p.canProceed(), isFalse);
      expect(p.hoursError, _twoDays);
    });

    test('правка: без рабочего дня название поправить можно', () {
      final p = onStep(null, editMode: true);
      expect(p.canProceed(), isTrue);
      expect(onStep(const WeeklyWorkingHours(), editMode: true).canProceed(),
          isTrue);
    });

    test('правка: день без времени держит шаг и там', () {
      final p = onStep(
        const WeeklyWorkingHours(monday: _noTimes),
        editMode: true,
      );
      expect(p.canProceed(), isFalse);
      expect(p.hoursError, _oneDay);
    });

    test('отправка новой карточки без часов не идёт в сеть', () async {
      final wire = installWireStand((_) => jsonBody({'success': true}));
      final p = PartnerRegistrationProvider(
        initialStep: 6,
        initialData: _completeCard,
      );

      expect(await p.submit(), isFalse);
      expect(wire.requests, isEmpty);
    });

    testWidgets('поле обязательное; день без времени назван под кнопкой',
        (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(400, 3000);
      addTearDown(tester.view.reset);
      final provider = onStep(const WeeklyWorkingHours(monday: _noTimes));
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: ChangeNotifierProvider.value(
            value: provider,
            child: const BasicInfoStep(),
          ),
        ),
      ));
      await tester.pump();

      expect(find.text(_oneDay), findsOneWidget);
      expect(
        find.descendant(
          of: find
              .ancestor(
                  of: find.text('Время работы'), matching: find.byType(Row))
              .first,
          matching: find.text('*'),
        ),
        findsOneWidget,
      );

      provider.updateWeeklyWorkingHours(
          const WeeklyWorkingHours(monday: _open));
      await tester.pump();

      expect(find.text(_oneDay), findsNothing);
    });
  });

  group('итоговый шаг', () {
    setUp(() => installWireStand((_) => jsonBody({'success': true})));

    Future<int> tapSend(
      WidgetTester tester,
      PartnerRegistration data,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(400, 1400);
      addTearDown(tester.view.reset);
      var sent = 0;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: ChangeNotifierProvider(
            create: (_) => PartnerRegistrationProvider(
              initialStep: 6,
              initialData: data,
            ),
            child: SummaryStep(onSubmit: () => sent++),
          ),
        ),
      ));
      await tester.tap(find.text('Отправить на верификацию'));
      await tester.pump();
      return sent;
    }

    testWidgets('без часов кнопка отправки не работает', (tester) async {
      expect(await tapSend(tester, _completeCard), 0);
    });

    testWidgets('с рабочим днём работает', (tester) async {
      expect(
        await tapSend(
          tester,
          _completeCard.copyWith(
            weeklyWorkingHours: const WeeklyWorkingHours(monday: _open),
          ),
        ),
        1,
      );
    });

    // Находка № 4 нитки «Часы работы» (Координатор, 08.11.2026, «Да на 1–4»):
    // у карточки с меню одним PDF кнопка была серой, нижняя «Отправить» —
    // работала.
    testWidgets('меню только PDF — работает', (tester) async {
      expect(
        await tapSend(
          tester,
          _completeCard.copyWith(
            weeklyWorkingHours: const WeeklyWorkingHours(monday: _open),
            menuPhotos: const [],
            menuPdfs: const [
              MenuPdf(
                url: 'https://res.cloudinary.com/demo/raw/upload/menu.pdf',
                thumbnailUrl: 'https://res.cloudinary.com/demo/image/upload/m.jpg',
                previewUrl: 'https://res.cloudinary.com/demo/image/upload/m.jpg',
                fileName: 'menu.pdf',
              ),
            ],
          ),
        ),
        1,
      );
    });

    testWidgets('меню нет совсем — не работает', (tester) async {
      expect(
        await tapSend(
          tester,
          _completeCard.copyWith(
            weeklyWorkingHours: const WeeklyWorkingHours(monday: _open),
            menuPhotos: const [],
          ),
        ),
        0,
      );
    });
  });

  group('экран часов', () {
    late WeeklyWorkingHours? result;
    late bool returned;

    Future<void> openScreen(
      WidgetTester tester,
      WeeklyWorkingHours hours,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(420, 3000);
      addTearDown(tester.view.reset);
      result = null;
      returned = false;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<WeeklyWorkingHours>(
                    MaterialPageRoute(
                      builder: (_) => WorkingHoursScreen(initialHours: hours),
                    ),
                  );
                  returned = true;
                },
                child: const Text('Открыть'),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('Открыть'));
      await tester.pumpAndSettle();
    }

    Future<void> tapSave(WidgetTester tester) async {
      await tester.tap(find.text('Сохранить'));
      await tester.pump();
    }

    testWidgets('рабочий день без времени: прочерки вместо выдуманных 09:00 и '
        '22:00, подсказка под днём', (tester) async {
      await openScreen(tester, const WeeklyWorkingHours(monday: _noTimes));

      expect(find.text('--:--'), findsNWidgets(2));
      expect(find.text('09:00'), findsNothing);
      expect(find.text('22:00'), findsNothing);
      expect(find.text('Укажите время открытия и закрытия'), findsOneWidget);
    });

    testWidgets('такой день не сохраняется: плашка с текстом, экран остаётся',
        (tester) async {
      await openScreen(tester, const WeeklyWorkingHours(monday: _noTimes));

      await tapSave(tester);
      await tester.pump(const Duration(milliseconds: 300));

      expect(returned, isFalse);
      expect(find.byType(WorkingHoursScreen), findsOneWidget);
      expect(find.text(_oneDay), findsOneWidget);
    });

    testWidgets('плашка называет все такие дни', (tester) async {
      await openScreen(
        tester,
        const WeeklyWorkingHours(wednesday: _noTimes, sunday: _noTimes),
      );

      await tapSave(tester);
      await tester.pump(const Duration(milliseconds: 300));

      expect(returned, isFalse);
      expect(find.text(_twoDays), findsOneWidget);
    });

    testWidgets('день отмечен выходным — сохраняется', (tester) async {
      await openScreen(tester, const WeeklyWorkingHours(monday: _noTimes));

      await tester.tap(find.byType(Switch).first);
      await tester.pump();
      await tapSave(tester);
      await tester.pumpAndSettle();

      expect(returned, isTrue);
      expect(result?.monday.isOpen, isFalse);
      expect(result?.incompleteDays, isEmpty);
    });

    testWidgets('день включён заново — время видно на экране и уходит на сервер',
        (tester) async {
      await openScreen(tester, const WeeklyWorkingHours(monday: _noTimes));

      await tester.tap(find.byType(Switch).first); // выходной
      await tester.pump();
      await tester.tap(find.byType(Switch).first); // снова рабочий
      await tester.pump();

      expect(find.text('09:00'), findsOneWidget);
      expect(find.text('22:00'), findsOneWidget);
      expect(find.text('Укажите время открытия и закрытия'), findsNothing);

      await tapSave(tester);
      await tester.pumpAndSettle();

      expect(result?.monday.toJson(),
          {'is_open': true, 'open': '09:00', 'close': '22:00'});
    });

    testWidgets('нажатие на прочерк открывает выбор времени: падало на пустой '
        'строке', (tester) async {
      await openScreen(tester, const WeeklyWorkingHours(monday: _noTimes));

      await tester.tap(find.text('--:--').first);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byType(TimePickerDialog), findsOneWidget);
    });

    testWidgets('заполненная неделя сохраняется как есть', (tester) async {
      await openScreen(tester, const WeeklyWorkingHours(monday: _open));

      expect(find.text('Укажите время открытия и закрытия'), findsNothing);

      await tapSave(tester);
      await tester.pumpAndSettle();

      expect(returned, isTrue);
      expect(result?.monday.openTime, '10:00');
    });
  });
}
