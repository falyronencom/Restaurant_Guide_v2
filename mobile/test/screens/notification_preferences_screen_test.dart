// Экран настроек уведомлений: четыре переключателя, четвёртый — «Меню» —
// пишет menu_push_enabled (миграция 033 на бэкенде).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/notification_preferences_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/fake_api_client.dart';

Future<FakeApiClient> _pumpScreen(WidgetTester tester) async {
  final fake = FakeApiClient()
    ..prefsFromServer = <String, dynamic>{
      'booking_push_enabled': true,
      'reviews_push_enabled': true,
      'promotions_push_enabled': true,
      'menu_push_enabled': true,
    };
  final provider = NotificationPreferencesProvider(apiClient: fake);
  addTearDown(provider.dispose);

  await tester.pumpWidget(
    ChangeNotifierProvider<NotificationPreferencesProvider>.value(
      value: provider,
      child: const MaterialApp(home: NotificationPreferencesScreen()),
    ),
  );
  // Post-frame ensureLoaded → spinner; the fake resolves in microtasks, the
  // list renders on the following frame.
  await tester.pump();
  await tester.pump();
  return fake;
}

void main() {
  setUp(AccountScope.debugReset);

  testWidgets('renders four toggles, the last one is «Меню»', (tester) async {
    await _pumpScreen(tester);

    expect(find.byType(SwitchListTile), findsNWidgets(4));
    expect(find.text('Меню'), findsOneWidget);
    expect(find.text('Результат распознавания загруженного меню'),
        findsOneWidget);

    final tiles = tester
        .widgetList<SwitchListTile>(find.byType(SwitchListTile))
        .toList();
    expect((tiles[3].title as Text).data, 'Меню');
    expect(tiles[3].value, isTrue);
  });

  testWidgets('tapping «Меню» sends menu_push_enabled=false and flips the switch',
      (tester) async {
    final fake = await _pumpScreen(tester);

    await tester.tap(find.byType(SwitchListTile).at(3));
    await tester.pump();

    expect(fake.putBodies, [
      <String, dynamic>{'menu_push_enabled': false},
    ]);

    await tester.pumpAndSettle();
    final menuTile =
        tester.widget<SwitchListTile>(find.byType(SwitchListTile).at(3));
    expect(menuTile.value, isFalse);
    // The three older toggles are untouched.
    for (var i = 0; i < 3; i++) {
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile).at(i)).value,
        isTrue,
      );
    }
  });
}
