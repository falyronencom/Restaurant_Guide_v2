import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/summary_step.dart';

import '../support/wire_stand.dart';

/// Итоговый шаг мастера партнёра: галочки и кнопка «Отправить на верификацию»
/// — по тем же проверкам, что кнопка «Отправить» внизу мастера
/// ([PartnerRegistrationProvider.canProceed]) и сама отправка.
///
/// Находка № 10 нитки «Часы работы» (слово Координатора «Да, бери 10»,
/// 09.11.2026): у итогового шага был свой список. Без телефона — на шаге «О
/// заведении» он необязателен, сервер его не требует — кнопка была серой, а
/// нижняя «Отправить» работала. С УНП не из 9 цифр или почтой без «@» —
/// наоборот: «Ваши данные» с галочкой, кнопка нажималась и получала общий
/// отказ «Пожалуйста, заполните все обязательные поля».
const _photo = 'https://res.cloudinary.com/demo/image/upload/a.jpg';
const _open = DayWorkingHours(isOpen: true, openTime: '10:00', closeTime: '22:00');
const _pdf = MenuPdf(
  url: 'https://res.cloudinary.com/demo/raw/upload/menu.pdf',
  thumbnailUrl: 'https://res.cloudinary.com/demo/image/upload/m.jpg',
  previewUrl: 'https://res.cloudinary.com/demo/image/upload/m.jpg',
  fileName: 'menu.pdf',
);

/// Карточка, у которой готовы все шаги; параметры — то, что обнуляет случай.
PartnerRegistration _card({
  String? priceRange = r'$$',
  String? primaryPhotoUrl = _photo,
  WeeklyWorkingHours? hours = const WeeklyWorkingHours(monday: _open),
}) =>
    PartnerRegistration(
      categories: const ['restaurant'],
      cuisineTypes: const ['european'],
      name: 'Кофейня у моста',
      phone: '+375291234567',
      priceRange: priceRange,
      weeklyWorkingHours: hours,
      interiorPhotos: const [_photo],
      menuPhotos: const ['https://res.cloudinary.com/demo/image/upload/b.jpg'],
      primaryPhotoUrl: primaryPhotoUrl,
      city: 'Минск',
      street: 'Немига',
      building: '1',
      legalName: 'ООО «Мост»',
      unp: '123456789',
      contactPerson: 'Анна',
      contactEmail: 'anna@example.com',
    );

const _items = [
  'Ваши данные',
  'Категория заведения',
  'Категория кухни',
  'О заведении',
  'Медиа',
  'Время работы',
  'Заполните адрес',
];

/// Случай: данные карточки, сработает ли «Отправить на верификацию» и какие
/// строки списка останутся без галочки.
typedef _Case = ({PartnerRegistration data, bool sends, List<String> unticked});

void main() {
  setUp(() => installWireStand((_) => jsonBody({'success': true})));

  /// Рисует итоговый шаг, читает галочки и жмёт «Отправить на верификацию».
  Future<({bool sent, bool canProceed, List<String> unticked})> open(
    WidgetTester tester,
    PartnerRegistration data,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(400, 1400);
    addTearDown(tester.view.reset);
    var sent = 0;
    final provider =
        PartnerRegistrationProvider(initialStep: 6, initialData: data);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ChangeNotifierProvider.value(
          value: provider,
          child: SummaryStep(onSubmit: () => sent++),
        ),
      ),
    ));
    final unticked = [
      for (final title in _items)
        if (find
            .descendant(
              of: find
                  .ancestor(of: find.text(title), matching: find.byType(Row))
                  .first,
              matching: find.byIcon(Icons.check),
            )
            .evaluate()
            .isEmpty)
          title,
    ];
    await tester.tap(find.text('Отправить на верификацию'));
    await tester.pump();
    return (sent: sent == 1, canProceed: provider.canProceed(), unticked: unticked);
  }

  final cases = <String, _Case>{
    'всё заполнено': (data: _card(), sends: true, unticked: []),
    // Телефон на шаге «О заведении» необязателен, сервер его не требует.
    'без телефона': (
      data: _card().copyWith(phone: ''),
      sends: true,
      unticked: [],
    ),
    'телефон набран не до конца': (
      data: _card().copyWith(phone: '+37529123'),
      sends: false,
      unticked: ['О заведении'],
    ),
    'УНП из 3 цифр': (
      data: _card().copyWith(unp: '123'),
      sends: false,
      unticked: ['Ваши данные'],
    ),
    'почта без «@»': (
      data: _card().copyWith(contactEmail: 'anna.example.com'),
      sends: false,
      unticked: ['Ваши данные'],
    ),
    'меню только PDF': (
      data: _card().copyWith(menuPhotos: const [], menuPdfs: const [_pdf]),
      sends: true,
      unticked: [],
    ),
    'меню нет совсем': (
      data: _card().copyWith(menuPhotos: const []),
      sends: false,
      unticked: ['Медиа'],
    ),
    'нет главного фото': (
      data: _card(primaryPhotoUrl: null),
      sends: false,
      unticked: ['Медиа'],
    ),
    'название из одной буквы': (
      data: _card().copyWith(name: 'К'),
      sends: false,
      unticked: ['О заведении'],
    ),
    'цена не выбрана': (
      data: _card(priceRange: null),
      sends: false,
      unticked: ['О заведении'],
    ),
    // Часы — своя строка; «О заведении» без них заполнено.
    'нет рабочего дня': (
      data: _card(hours: null),
      sends: false,
      unticked: ['Время работы'],
    ),
  };

  group('итоговый шаг спрашивает мастера', () {
    cases.forEach((name, c) {
      testWidgets(name, (tester) async {
        final result = await open(tester, c.data);

        expect(result.unticked, c.unticked, reason: 'строки без галочки');
        expect(result.sent, c.sends, reason: '«Отправить на верификацию»');
        // Одни проверки на обе кнопки: верхняя работает ровно тогда, когда
        // работает нижняя «Отправить», и ровно тогда стоят все галочки.
        expect(result.sent, result.canProceed,
            reason: 'верхняя и нижняя кнопки расходятся');
        expect(result.unticked.isEmpty, result.sent,
            reason: 'все галочки ⇔ кнопка работает');
      });
    });
  });
}
