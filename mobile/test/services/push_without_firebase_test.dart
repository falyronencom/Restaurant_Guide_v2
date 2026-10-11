import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/push_notification_service.dart';

import '../support/push_home_stand.dart';

/// Firebase не поднялся при запуске приложения.
///
/// `main.dart` такой сбой переживает: приложение работает, push на телефоне
/// нет. До 08.10.2026 сервис push брал `FirebaseMessaging.instance` прямо
/// при создании. Без Firebase это бросало исключение уже в
/// `PushNotificationService()` — в том числе в кнопке «Выйти», которая
/// отвязывает адрес телефона ДО выхода: выйти из аккаунта было нельзя. Сам
/// сбой при этом был виден только в отладочном журнале.
///
/// Firebase в этом файле намеренно не инициализирован.
void main() {
  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues({
      BelarusCities.persistenceKey: BelarusCities.defaultCity,
    });
  });

  testWidgets('выход из аккаунта не падает, если Firebase не запустился',
      (tester) async {
    await PushNotificationService().deregisterToken();
  });

  testWidgets('вошедший видит в настройках уведомлений, что сервис '
      'уведомлений не запустился', (tester) async {
    await pumpPushHome(tester, storedUser: userA);

    await pumpPushPreferences(tester);
    expect(find.textContaining('сервис уведомлений не запустился'),
        findsOneWidget);

    await unmountPushHome(tester);
  });
}
