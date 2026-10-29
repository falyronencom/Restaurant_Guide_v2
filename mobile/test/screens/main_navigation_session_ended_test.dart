import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart' show TextButton;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/screens/main_navigation.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/push_home_stand.dart';

/// Сервер закончил сеанс и сказал почему (учётную запись отключили или
/// удалили) — главный экран показывает его слова в окне, один раз (решение
/// Координатора 29.10.2026). Обычный конец сеанса окна не открывает.
void main() {
  const serverText = 'Учётная запись отключена или удалена. Если это ошибка — '
      'напишите в поддержку: support@nirivio.by';

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues({
      BelarusCities.persistenceKey: BelarusCities.defaultCity,
    });
    PhoneMessaging().install();
  });

  testWidgets('отключили посреди работы — окно со словами сервера, один раз',
      (tester) async {
    final home = await pumpPushHome(tester, storedUser: userA);
    expect(home.auth.isAuthenticated, isTrue, reason: 'предпосылка: вошёл');

    SessionEvents.reportExpired(serverText);
    await settlePush(tester);

    expect(home.auth.isAuthenticated, isFalse);
    expect(find.byKey(MainNavigationScreen.sessionEndedDialogKey),
        findsOneWidget);
    expect(find.text(serverText), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Понятно'));
    await settlePush(tester);
    expect(find.byKey(MainNavigationScreen.sessionEndedDialogKey),
        findsNothing);

    // Следующие изменения входа окно не возвращают.
    home.auth.notifyListeners();
    await settlePush(tester);
    expect(find.byKey(MainNavigationScreen.sessionEndedDialogKey),
        findsNothing);

    await unmountPushHome(tester);
  });

  testWidgets('сеанс просто истёк — окна нет', (tester) async {
    final home = await pumpPushHome(tester, storedUser: userA);

    SessionEvents.reportExpired();
    await settlePush(tester);

    expect(home.auth.isAuthenticated, isFalse);
    expect(find.byKey(MainNavigationScreen.sessionEndedDialogKey),
        findsNothing);

    await unmountPushHome(tester);
  });
}
