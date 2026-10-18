import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_preview.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Оценка в подсказках умного поиска под строкой поиска.
///
/// Без расстояния подсказка пишет «тип · оценка★». У места без отзывов
/// сервер отдаёт среднюю 0, и подсказка писала «Кофейня · 0.0★» — тот же
/// «ноль из пяти», что зелёный «0,0» в списке (находка 18.10.2026 на телефоне
/// Координатора), да ещё с точкой, а не с запятой, как в списке.
///
/// Выдача идёт по проводу (стенд транспорта): так оценка проходит тот же
/// разбор, что на телефоне.

Map<String, dynamic> _place(String id, String name, String category,
        {required num rating, required int reviews}) =>
    establishmentRow(id: id, name: name, categories: [category])
      ..['average_rating'] = rating
      ..['review_count'] = reviews;

void main() {
  setUp(AccountScope.debugReset);

  testWidgets('без отзывов — только тип; с оценкой — «4,5★» через запятую',
      (tester) async {
    installWireStand((options) => options.uri.path == '/api/v1/search/smart'
        ? jsonBody({
            'success': true,
            'data': {
              'establishments': [
                _place('11111111-1111-4111-8111-111111111111', 'VARKA',
                    'Кофейня',
                    rating: 0, reviews: 0),
                _place('22222222-2222-4222-8222-222222222222', 'Васильки',
                    'Ресторан',
                    rating: 4.5, reviews: 12),
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
    // Предпосылка: выдача пришла, обе подсказки на месте.
    expect(provider.state, SmartSearchState.results);
    expect(provider.smartResults, hasLength(2));

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

    expect(find.text('Кофейня'), findsOneWidget,
        reason: 'у места без отзывов оценки нет — только тип');
    expect(find.textContaining('0.0'), findsNothing);
    expect(find.textContaining('0,0'), findsNothing);
    expect(find.text('Ресторан · 4,5★'), findsOneWidget);
  });
}
