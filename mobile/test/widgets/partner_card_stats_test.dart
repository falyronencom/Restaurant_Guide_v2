// Числа на карточке заведения в кабинете партнёра.
//
// Сверка документов с продуктом 01.11.2026 (П7): карточка показывала три
// числа — просмотры, «поделились», избранное. «Поделились» сервер не считает
// и не присылает, приложение подставляло 0, так что партнёр всегда видел
// ноль. Теперь на карточке только просмотры и избранное.
//
// «Поделились» в данных намеренно ненулевое: на старом коде его число
// находится на карточке, и тест краснеет не только по значку.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/widgets/partner_establishment_card.dart';

void main() {
  testWidgets('карточка партнёра: просмотры и избранное, без «поделились»',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: SingleChildScrollView(
          child: PartnerEstablishmentCard(
            establishment: PartnerEstablishment(
              id: 'p-1',
              name: 'Zalkind Kitchen',
              status: EstablishmentStatus.approved,
              categories: const ['restaurant'],
              cuisineTypes: const ['author'],
              street: 'Революционная',
              building: '24',
              baseScore: 65,
              stats: const EstablishmentStats(
                  views: 123, shares: 777, favorites: 45),
              createdAt: DateTime(2026, 1, 1),
              updatedAt: DateTime(2026, 1, 1),
            ),
          ),
        ),
      ),
    ));
    await tester.pump();

    expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);
    expect(find.text('123'), findsOneWidget);
    expect(find.byIcon(Icons.favorite_border), findsOneWidget);
    expect(find.text('45'), findsOneWidget);

    expect(find.byIcon(Icons.ios_share_outlined), findsNothing,
        reason: 'значок «поделились»');
    expect(find.text('777'), findsNothing, reason: 'число «поделились»');
  });
}
