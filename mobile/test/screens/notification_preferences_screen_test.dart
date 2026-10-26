// Экран настроек уведомлений: четыре переключателя, четвёртый — «Меню» —
// пишет menu_push_enabled (миграция 033 на бэкенде).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/notification_preferences_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/fake_api_client.dart';

Future<FakeApiClient> _pumpScreen(
  WidgetTester tester, {
  Map<String, dynamic> server = const <String, dynamic>{
    'booking_push_enabled': true,
    'reviews_push_enabled': true,
    'promotions_push_enabled': true,
    'menu_push_enabled': true,
  },
}) async {
  final fake = FakeApiClient()..prefsFromServer = server;
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

  testWidgets('каждая строка показывает своё значение сервера и пишет свой '
      'ключ', (tester) async {
    // Значения сервера разные: при всех `true` перестановка показа или
    // записи между строками не видна. Ключи — литералы колонок сервера
    // (`backend/src/models/notificationPreferencesModel.js`).
    final fake = await _pumpScreen(tester, server: <String, dynamic>{
      'booking_push_enabled': true,
      'reviews_push_enabled': false,
      'promotions_push_enabled': true,
      'menu_push_enabled': false,
    });

    Finder row(String title) => find.widgetWithText(SwitchListTile, title);
    bool shown(String title) =>
        tester.widget<SwitchListTile>(row(title)).value;

    expect(
      [
        shown('Бронирование'),
        shown('Отзывы и заведения'),
        shown('Акции из избранного'),
        shown('Меню'),
      ],
      [true, false, true, false],
      reason: 'строка показывает значение чужой категории',
    );

    await tester.tap(row('Отзывы и заведения'));
    await tester.pump();
    expect(fake.putBodies.last, <String, dynamic>{'reviews_push_enabled': true});
    expect(shown('Отзывы и заведения'), isTrue);

    await tester.tap(row('Акции из избранного'));
    await tester.pump();
    expect(fake.putBodies.last,
        <String, dynamic>{'promotions_push_enabled': false});
    expect(shown('Акции из избранного'), isFalse);

    // Брони выключаются только после подтверждения в диалоге.
    await tester.tap(row('Бронирование'));
    await tester.pumpAndSettle();
    expect(fake.putBodies, hasLength(2),
        reason: 'до подтверждения запрос не уходит');
    await tester.tap(find.text('Отключить'));
    await tester.pumpAndSettle();
    expect(fake.putBodies.last,
        <String, dynamic>{'booking_push_enabled': false});
    expect(shown('Бронирование'), isFalse);

    expect(fake.putBodies, hasLength(3));
    // Чужие строки не тронуты.
    expect(shown('Отзывы и заведения'), isTrue);
    expect(shown('Акции из избранного'), isFalse);
    expect(shown('Меню'), isFalse);
  });
}
