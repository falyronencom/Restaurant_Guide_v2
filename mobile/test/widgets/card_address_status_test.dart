import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/screens/partner/establishment_preview_screen.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';

import '../support/wire_fixtures.dart';

/// Карточка выдачи и превью партнёра по проходу тестировщика 17.10:
/// п. 11 («Открыто · до 22:00») и п. 12 (подчёркнутый адрес ведёт на карту).
///
/// Сам переход на карту делает экран выдачи (`results_list_screen.dart`) —
/// карточка лишь отдаёт тап по адресу; здесь проверяется карточка.
void main() {
  Establishment establishment() => Establishment.fromJson(
        establishmentRow(
          address: 'пр. Независимости, 43',
          // Круглосуточно: открыто в любую минуту, от часов машины не зависит.
          workingHours: {
            for (final d in [
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday',
              'sunday',
            ])
              d: '00:00-00:00',
          },
        ),
      );

  Future<void> pumpCard(
    WidgetTester tester, {
    VoidCallback? onTap,
    VoidCallback? onAddressTap,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 900);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ListView(children: [
          EstablishmentCard(
            establishment: establishment(),
            onTap: onTap,
            onAddressTap: onAddressTap,
          ),
        ]),
      ),
    ));
    await tester.pump();
  }

  group('п. 11 — подпись часов', () {
    testWidgets('карточка выдачи: «Открыто · до 00:00»', (tester) async {
      await pumpCard(tester);
      final status = find.byWidgetPredicate((w) =>
          w is RichText && w.text.toPlainText().startsWith('Открыто'));
      expect(status, findsOneWidget);
      expect((tester.widget(status) as RichText).text.toPlainText(),
          'Открыто · до 00:00');
    });

    testWidgets('превью партнёра: «Открыто · до 22:00»', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 900);
      addTearDown(tester.view.reset);
      const day = DayWorkingHours(
          isOpen: true, openTime: '10:00', closeTime: '22:00');
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: const EstablishmentPreviewScreen(
          registrationData: PartnerRegistration(
            name: 'Васильки',
            categories: ['Ресторан'],
            weeklyWorkingHours: WeeklyWorkingHours(
              monday: day,
              tuesday: day,
              wednesday: day,
              thursday: day,
              friday: day,
              saturday: day,
              sunday: day,
            ),
          ),
        ),
      ));
      await tester.pump();

      final status = find.byWidgetPredicate((w) =>
          w is RichText && w.text.toPlainText().startsWith('Открыто'));
      expect(status, findsOneWidget);
      expect((tester.widget(status) as RichText).text.toPlainText(),
          'Открыто · до 22:00');
    });
  });

  group('п. 12 — адрес в карточке выдачи', () {
    TextDecoration? addressDecoration(WidgetTester tester) {
      final text = tester.widget<Text>(find.text('пр. Независимости, 43'));
      return text.style?.decoration;
    }

    testWidgets('есть обработчик: тап по адресу идёт в него, не в карточку',
        (tester) async {
      var card = 0, address = 0;
      await pumpCard(tester,
          onTap: () => card++, onAddressTap: () => address++);

      expect(addressDecoration(tester), TextDecoration.underline,
          reason: 'адрес-ссылка должен выглядеть ссылкой');
      await tester.tap(find.text('пр. Независимости, 43'));
      await tester.pump();

      expect(address, 1);
      expect(card, 0, reason: 'тап по адресу открыл страницу заведения');
    });

    testWidgets('обработчика нет: адрес — обычный текст, тап идёт в карточку',
        (tester) async {
      var card = 0;
      await pumpCard(tester, onTap: () => card++);

      expect(addressDecoration(tester), isNot(TextDecoration.underline),
          reason: 'подчёркнутый адрес без перехода обещает то, чего нет');
      await tester.tap(find.text('пр. Независимости, 43'));
      await tester.pump();

      expect(card, 1);
    });
  });
}
