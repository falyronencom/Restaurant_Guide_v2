import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_registration_screen.dart';

/// Правка карточки клуба в мастере партнёра (сверка «Честность тестов
/// клиентов», 25.10.2026, W5c).
///
/// Карточка приходит с сервера с названиями категорий (`['Клуб']`), мастер
/// переводит их в id плиток. С 16.03 «Клуба» не было в обратном
/// сопоставлении: название возвращалось как есть, плитка «Клуб» не
/// отмечалась, снять её было нельзя, повторное нажатие давало два «Клуба», а
/// кухня у клуба становилась обязательной — хотя сервер её клубу не требует
/// (`CUISINE_OPTIONAL_CATEGORIES`, решение В5).
void main() {
  /// Карточка клуба без кухни — так её хранит сервер. Названия категорий —
  /// литералы канона `backend/src/constants/establishmentVocab.js`.
  PartnerEstablishment clubCard(List<String> categories) => PartnerEstablishment(
        id: 'club-1',
        name: 'Ночной клуб',
        status: EstablishmentStatus.approved,
        categories: categories,
        cuisineTypes: const [],
        createdAt: DateTime(2026, 1, 1),
        updatedAt: DateTime(2026, 1, 1),
      );

  PartnerRegistrationProvider editing(PartnerEstablishment card,
          {int step = 0}) =>
      PartnerRegistrationProvider(
        editMode: true,
        establishmentId: card.id,
        initialStep: step,
        initialData: PartnerRegistrationProvider.dataFromEstablishment(card),
      );

  test('плитка «Клуб» отмечена, счётчик 1/2', () {
    final wizard = editing(clubCard(const ['Клуб']));

    expect(wizard.isCategorySelected('nightclub'), isTrue,
        reason: 'категория «Клуб» с сервера не узнана мастером');
    expect(wizard.selectedCategoriesCount, 1);
  });

  test('«Клуб» снимается нажатием, повторное нажатие не даёт двух клубов', () {
    final wizard = editing(clubCard(const ['Клуб']));

    wizard.toggleCategory('nightclub');
    expect(wizard.selectedCategoriesCount, 0,
        reason: 'нажатие на «Клуб» не сняло категорию');

    wizard.toggleCategory('nightclub');
    expect(wizard.data.toJson()['categories'], ['Клуб'],
        reason: 'на сервер уходит «Клуб» дважды');
  });

  test('клуб без кухни: шаг кухни сохраняется', () {
    final wizard = editing(clubCard(const ['Клуб']), step: 1);

    expect(wizard.isCuisineOptional, isTrue,
        reason: 'для клуба кухня стала обязательной');
    expect(wizard.canProceed(), isTrue,
        reason: '«Сохранить» на шаге кухни выключена без кухни');
  });

  test('клуб и бар без кухни: шаг кухни сохраняется', () {
    final wizard = editing(clubCard(const ['Клуб', 'Бар']), step: 1);

    expect(wizard.canProceed(), isTrue);
  });

  testWidgets('шаг кухни у клуба: подсказка «кухню выбирать необязательно»',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: PartnerRegistrationScreen(
        editMode: true,
        establishmentId: 'club-1',
        initialStep: 1,
        initialData:
            PartnerRegistrationProvider.dataFromEstablishment(clubCard(const [
          'Клуб',
        ])),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('кухню выбирать необязательно'),
        findsOneWidget);
    expect(find.text('Сохранить'), findsOneWidget);
  });
}
