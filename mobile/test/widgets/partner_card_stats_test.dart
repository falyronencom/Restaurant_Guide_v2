// Числа на карточке заведения в кабинете партнёра: просмотры, «поделились»,
// избранное.
//
// «Поделились» было пустышкой и снято 01.11.2026 (П7): сервер не считал, партнёр
// всегда видел ноль. С 06.11.2026 счётчик настоящий (миграция 039): число приходит
// в поле `share_count` списка заведений и показывается рядом с остальными.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/widgets/partner_establishment_card.dart';

void main() {
  testWidgets('карточка партнёра: просмотры, «поделились» и избранное',
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
    expect(find.byIcon(Icons.ios_share_outlined), findsOneWidget,
        reason: 'значок «поделились»');
    expect(find.text('777'), findsOneWidget, reason: 'число «поделились»');
    expect(find.byIcon(Icons.favorite_border), findsOneWidget);
    expect(find.text('45'), findsOneWidget);
  });

  test('список заведений: число «поделились» — из `share_count`', () {
    final establishment = PartnerEstablishment.fromJson(const {
      'id': 'p-1',
      'name': 'Zalkind Kitchen',
      'status': 'active',
      'view_count': 3,
      'favorite_count': 2,
      'share_count': 11,
      'created_at': '2026-01-01T00:00:00.000Z',
      'updated_at': '2026-01-01T00:00:00.000Z',
    });

    expect(establishment.stats.shares, 11);
    expect(establishment.stats.views, 3);
    expect(establishment.stats.favorites, 2);
  });

  test('сервер без `share_count` — ноль, а не отказ разбора', () {
    final establishment = PartnerEstablishment.fromJson(const {
      'id': 'p-1',
      'name': 'Zalkind Kitchen',
      'status': 'active',
      'created_at': '2026-01-01T00:00:00.000Z',
      'updated_at': '2026-01-01T00:00:00.000Z',
    });

    expect(establishment.stats.shares, 0);
  });

  test('withShares меняет только «поделились»', () {
    const stats = EstablishmentStats(
      views: 1,
      viewsTrend: 2,
      shares: 3,
      sharesTrend: 4,
      favorites: 5,
      favoritesTrend: 6,
      reviews: 7,
      averageRating: 4.5,
      ratingDistribution: {5: 1},
    );

    final changed = stats.withShares(30);

    expect(changed.shares, 30);
    expect(changed.toJson()..remove('shares'), stats.toJson()..remove('shares'));
  });
}
