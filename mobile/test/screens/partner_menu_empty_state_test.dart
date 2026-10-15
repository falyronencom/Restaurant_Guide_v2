import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_menu_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Что читает партнёр на пустом экране «Меню».
///
/// До 15.10.2026 подсказка звала загрузить именно PDF, хотя распознаются и
/// фото меню, а заголовок говорил программистским «Распарсенных позиций».
/// Тексты — литералы решений Координатора 15.10.2026.
const _est = '11111111-2222-3333-4444-555555555555';

const _title = 'Распознанных позиций меню пока нет';

const _hint = 'Если вы добавили фото меню или PDF в разделе «Медиа», '
    'распознавание выполняется автоматически в течение нескольких минут. '
    'Если ещё не добавили — добавьте их в разделе «Медиа».';

void main() {
  setUp(() {
    AccountScope.debugReset();
    installWireStand((options) => jsonBody({'success': true, 'data': <dynamic>[]}));
  });

  testWidgets('пустой список: заголовок без жаргона, подсказка — фото меню или PDF',
      (tester) async {
    final provider = PartnerMenuProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(home: PartnerMenuScreen(establishmentId: _est)),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text(_title), findsOneWidget);
    expect(find.text(_hint), findsOneWidget);
  });
}
