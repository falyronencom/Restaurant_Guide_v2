import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_menu_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Партнёр видит всё меню. У строки, которую гость не видит, — пометка; без неё
/// партнёр принял бы пропавшую с карточки строку за ошибку (бриф 05.11.2026, п. 5).
const _est = '11111111-2222-3333-4444-555555555555';

const _mark = 'Гостям не показывается: алкоголь и табак';

Map<String, dynamic> _item(String name, String? reason) => {
      'id': 'item-$name',
      'establishment_id': _est,
      'media_id': 'media-1',
      'item_name': name,
      'price_byn': '12.50',
      'category_raw': 'Меню',
      'confidence': 0.9,
      'sanity_flag': null,
      'position': 0,
      if (reason != null) 'guest_hidden_reason': reason,
    };

void main() {
  late List<Map<String, dynamic>> items;

  setUp(() {
    AccountScope.debugReset();
    installWireStand(
        (options) => jsonBody({'success': true, 'data': items}));
  });

  Future<void> open(WidgetTester tester) async {
    final provider = PartnerMenuProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(home: PartnerMenuScreen(establishmentId: _est)),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
  }

  testWidgets('у алкоголя и табака пометка, у блюда — нет', (tester) async {
    items = [
      _item('Вино красное', 'alcohol'),
      _item('Кальян', 'tobacco'),
      _item('Борщ', null),
    ];
    await open(tester);

    expect(find.text('Вино красное'), findsOneWidget);
    expect(find.text('Кальян'), findsOneWidget);
    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_mark), findsNWidgets(2));
  });

  testWidgets('нет такой строки — нет и пометки', (tester) async {
    items = [_item('Борщ', null)];
    await open(tester);

    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_mark), findsNothing);
  });
}
