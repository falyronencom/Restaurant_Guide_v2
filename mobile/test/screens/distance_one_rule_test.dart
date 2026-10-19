import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/utils/venue_labels.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_preview.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Расстояние — одно правило на всех экранах (Н1, 19.10.2026).
///
/// Было: список — «0,2 км от вас» (всегда километры), карточка того же места —
/// «200 м от вас» до километра и «2.0 км от вас» (с точкой) дальше, подсказки
/// умного поиска — «1.2 км». Правило из брифа: до 1 км — метры («200 м»),
/// дальше — километры с русской запятой («2,0 км»). Карточку проверяет
/// `detail_screen_location_test.dart` («2,0 км от вас»).
void main() {
  group('distanceLabel', () {
    for (final (km, expected) in const [
      (0.2, '200 м'),
      (0.0004, '10 м'),
      (0.547, '550 м'),
      (0.994, '990 м'),
      (0.995, '1,0 км'),
      (1.234, '1,2 км'),
      (2.0, '2,0 км'),
      (12.36, '12,4 км'),
    ]) {
      test('$km км → «$expected»', () {
        expect(distanceLabel(km), expected);
      });
    }
  });

  group('список', () {
    Future<void> pumpCard(WidgetTester tester, double km) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.reset);
      final row = establishmentRow(id: '55555555-5555-4555-8555-555555555555')
        ..['primary_image_url'] = null;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: ListView(children: [
            EstablishmentCard(
              establishment: Establishment.fromJson(row),
              distanceKm: km,
            ),
          ]),
        ),
      ));
      await tester.pump();
    }

    testWidgets('200 м — метрами, как в карточке', (tester) async {
      await pumpCard(tester, 0.2);
      expect(find.text('200 м от вас'), findsOneWidget);
      expect(find.textContaining('0,2 км'), findsNothing);
    });

    testWidgets('2 км — «2,0 км от вас»', (tester) async {
      await pumpCard(tester, 2.0);
      expect(find.text('2,0 км от вас'), findsOneWidget);
    });
  });

  testWidgets('подсказки умного поиска: «1,2 км» с запятой, «350 м»',
      (tester) async {
    AccountScope.debugReset();
    Map<String, dynamic> place(String id, String name, double km) =>
        establishmentRow(id: id, name: name, categories: const ['Кофейня'])
          ..['distance'] = km;
    installWireStand((options) => options.uri.path == '/api/v1/search/smart'
        ? jsonBody({
            'success': true,
            'data': {
              'establishments': [
                place('11111111-1111-4111-8111-111111111111', 'VARKA', 1.234),
                place('22222222-2222-4222-8222-222222222222', 'Зерно', 0.35),
              ],
              'pagination': {
                'total': 2,
                'page': 1,
                'limit': 3,
                'totalPages': 1,
                'hasNext': false,
              },
              'fallback': true,
            },
          })
        : jsonBody({'success': false}, status: 404));

    final provider = SmartSearchProvider();
    addTearDown(provider.dispose);
    await tester.runAsync(() => provider.executeSmartSearch('кофе'));
    // Предпосылка: выдача пришла, расстояние разобрано.
    expect(provider.smartResults, hasLength(2));
    expect(provider.smartResults.first.distance, 1.234);

    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ChangeNotifierProvider<SmartSearchProvider>.value(
          value: provider,
          child: SmartSearchPreview(
            onShowAll: () {},
            onEstablishmentTap: (_) {},
          ),
        ),
      ),
    ));

    expect(find.text('Кофейня · 1,2 км'), findsOneWidget);
    expect(find.text('Кофейня · 350 м'), findsOneWidget);
    expect(find.textContaining('1.2'), findsNothing);
  });
}
