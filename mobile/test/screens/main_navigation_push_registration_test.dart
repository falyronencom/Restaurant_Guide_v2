import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart' show AppLifecycleState;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/push_notification_service.dart';

import '../support/push_home_stand.dart';

/// Регистрация адреса телефона для push: после ЛЮБОГО входа и не молча.
///
/// **Что было.** С июля 2026 ни один телефон не присылал серверу адрес: в
/// таблице `device_tokens` последняя запись с iPhone — 09.07, с Android —
/// 30.07, а в журнале Railway с 24.09 нет ни одного
/// `PUT /notifications/device-token`. На A72 08.10.2026 по кабелю: вход через
/// «Профиль» → «Войти» → Яндекс — сервер вход подтвердил, адрес не ушёл; ушёл
/// только после полного перезапуска приложения. Регистрация жила в одном
/// месте — первый кадр главной, если человек к этому моменту уже вошёл, — а
/// вход изнутри приложения возвращал на уже открытую главную. Сбои пути
/// (Firebase, адрес Apple, сервер) уходили только в отладочный журнал.
///
/// **Как проверяется.** Сервис push, `FirebaseMessaging` и `ApiClient` —
/// настоящие; подменены канал плагина Firebase (ответы «телефона») и
/// транспорт `ApiClient` (ответы «сервера»). Тест видит то же, что сервер:
/// дошёл ли `PUT /api/v1/notifications/device-token` и с каким телом. Тесты
/// пользуются только тем, что было и в старом коде: их можно прогнать на
/// старом коде и увидеть красными.
void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });

  late PhoneMessaging phone;

  setUp(() {
    AccountScope.debugReset();
    // Город уже «сохранён»: иначе главная откроет шторку выбора города.
    SharedPreferences.setMockInitialValues({
      BelarusCities.persistenceKey: BelarusCities.defaultCity,
    });
    phone = PhoneMessaging()..install();
  });

  testWidgets('вход при уже открытой главной отправляет адрес телефона на '
      'сервер', (tester) async {
    final home = await pumpPushHome(tester);
    expect(home.deviceTokenPuts(), isEmpty,
        reason: 'предпосылка: гость адрес не регистрирует');

    await home.auth.login(emailOrPhone: 'a@example.com', password: 'secret');
    await settlePush(tester);

    final puts = home.deviceTokenPuts();
    expect(puts, hasLength(1),
        reason: 'вход из «Профиля», «Избранного» или карточки возвращает на '
            'уже открытую главную — адрес обязан уйти и в этом случае, а не '
            'после перезапуска приложения');
    expect(puts.single.data, <String, dynamic>{
      'fcm_token': 'fcm-token-1',
      'platform': 'android',
    });

    await unmountPushHome(tester);
  });

  testWidgets('холодный старт с сохранённым входом — адрес уходит ровно один '
      'раз', (tester) async {
    final home = await pumpPushHome(tester, storedUser: userA);
    // Обновление профиля — ещё одно уведомление авторизации, но не новый
    // вход: регистрировать заново нечего.
    await home.auth.refreshUser();
    await settlePush(tester);

    expect(home.deviceTokenPuts(), hasLength(1),
        reason: 'восстановленная сессия регистрирует адрес, и только один '
            'раз: ни первый кадр главной вместе с подпиской на вход, ни '
            'любое уведомление авторизации без смены аккаунта не должны '
            'слать адрес повторно');

    await unmountPushHome(tester);
  });

  testWidgets('выход и вход другим аккаунтом — адрес уходит заново',
      (tester) async {
    final home = await pumpPushHome(tester, storedUser: userA);
    expect(home.deviceTokenPuts(), hasLength(1), reason: 'предпосылка');

    await home.auth.logout();
    await settlePush(tester);
    home.authService.nextLoginUser = userB;
    await home.auth.login(emailOrPhone: 'b@example.com', password: 'secret');
    await settlePush(tester);

    expect(home.putAccounts, <String?>['u-a', 'u-b'],
        reason: 'сервер хранит адрес за аккаунтом: после смены аккаунта '
            'адрес обязан уйти под новым, иначе push нового аккаунта до '
            'телефона не дойдут');

    await unmountPushHome(tester);
  });

  testWidgets('выход во время регистрации: адрес не уходит после выхода',
      (tester) async {
    phone.tokenGate = Completer<void>();
    final home = await pumpPushHome(tester, storedUser: userA);
    expect(home.deviceTokenPuts(), isEmpty,
        reason: 'предпосылка: регистрация ждёт адрес от Firebase');

    // Так выходит «Профиль»: сначала отвязать адрес, потом выйти.
    final unbinding = PushNotificationService().deregisterToken();
    phone.tokenGate!.complete();
    await settlePush(tester);
    await unbinding;
    await home.auth.logout();
    await settlePush(tester);

    expect(home.deviceTokenPuts(), isEmpty,
        reason: 'адрес, отправленный уже после выхода, остался бы за прежним '
            'аккаунтом: его push приходили бы на телефон, с которого он '
            'вышел');

    await unmountPushHome(tester);
  });

  testWidgets('сбой регистрации после выхода не показывается гостю',
      (tester) async {
    phone.tokenGate = Completer<void>();
    final home = await pumpPushHome(tester, storedUser: userA);

    // Firebase молчит дольше, чем выход ждёт регистрацию: выход проходит
    // целиком, и только потом приходит отказ.
    final unbinding = PushNotificationService().deregisterToken();
    await tester.pump(const Duration(seconds: 6));
    await unbinding;
    await home.auth.logout();
    await settlePush(tester);
    phone.tokenError = PlatformException(code: 'SERVICE_NOT_AVAILABLE');
    phone.tokenGate!.complete();
    await settlePush(tester);

    await pumpPushPreferences(tester);
    expect(find.textContaining('не работают'), findsNothing,
        reason: 'сбой случился уже после выхода и не о вошедшем аккаунте; '
            '«Повторить» у гостя отправил бы адрес без сессии');

    await unmountPushHome(tester);
  });

  testWidgets('уведомления разрешили в настройках телефона — после возврата в '
      'приложение строка говорит «включены»', (tester) async {
    phone.authorizationStatus = 0;
    final home = await pumpPushHome(tester, storedUser: userA);
    expect(home.deviceTokenPuts(), hasLength(1), reason: 'предпосылка');

    // Человек последовал подсказке: разрешил уведомления и вернулся.
    phone.authorizationStatus = 1;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await settlePush(tester);

    expect(home.deviceTokenPuts(), hasLength(1),
        reason: 'адрес сервер уже принял — слать его повторно незачем');
    await pumpPushPreferences(tester);
    expect(find.textContaining('push-уведомления включены'), findsOneWidget,
        reason: 'строка с подсказкой «запрещены» не должна пережить само '
            'разрешение');

    await unmountPushHome(tester);
  });

  testWidgets('сбой Firebase виден в настройках уведомлений, «Повторить» '
      'регистрирует адрес', (tester) async {
    phone.tokenError = PlatformException(
      code: 'SERVICE_NOT_AVAILABLE',
      message: 'java.io.IOException: SERVICE_NOT_AVAILABLE',
    );
    final home = await pumpPushHome(tester, storedUser: userA);
    expect(home.deviceTokenPuts(), isEmpty,
        reason: 'предпосылка: Firebase адрес не выдал');

    await pumpPushPreferences(tester);
    expect(find.textContaining('push-уведомления не работают'), findsOneWidget,
        reason: 'сбой регистрации обязан быть виден человеку, а не только '
            'отладочному журналу');
    expect(find.textContaining('сервиса уведомлений'), findsOneWidget,
        reason: 'причина — простыми словами');

    phone.tokenError = null;
    await tester.tap(find.text('Повторить'));
    await settlePush(tester);

    expect(home.deviceTokenPuts(), hasLength(1),
        reason: '«Повторить» регистрирует адрес заново');
    expect(find.textContaining('push-уведомления включены'), findsOneWidget);

    await unmountPushHome(tester);
  });

  testWidgets('возврат в приложение повторяет сорвавшуюся регистрацию',
      (tester) async {
    phone.tokenError = PlatformException(code: 'SERVICE_NOT_AVAILABLE');
    final home = await pumpPushHome(tester, storedUser: userA);
    expect(home.deviceTokenPuts(), isEmpty, reason: 'предпосылка');

    // Сеть вернулась, человек вернулся в приложение.
    phone.tokenError = null;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await settlePush(tester);

    expect(home.deviceTokenPuts(), hasLength(1),
        reason: 'энергосбережение или страница входа Wi-Fi при запуске не '
            'должны оставлять телефон без push до следующего входа');

    await unmountPushHome(tester);
  });

  testWidgets('уведомления запрещены в телефоне: адрес уходит, в настройках '
      '— подсказка', (tester) async {
    phone.authorizationStatus = 0;
    final home = await pumpPushHome(tester, storedUser: userA);

    expect(home.deviceTokenPuts(), hasLength(1),
        reason: 'адрес регистрируется и при запрете: разрешит человек '
            'уведомления в настройках телефона — push начнут приходить без '
            'повторного входа');

    await pumpPushPreferences(tester);
    expect(find.textContaining('запрещены в настройках телефона'),
        findsOneWidget);

    await unmountPushHome(tester);
  });

  testWidgets('iPhone без адреса Apple: адрес не уходит, в настройках — '
      'причина', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    phone.apnsToken = null;

    final home = await pumpPushHome(tester, storedUser: userA);
    // Ожидание адреса Apple ограничено: дольше десяти секунд не ждём.
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(seconds: 1));
    }

    expect(home.deviceTokenPuts(), isEmpty);
    await pumpPushPreferences(tester);
    expect(find.textContaining('Apple не выдал'), findsOneWidget,
        reason: 'без адреса Apple Firebase своего не выдаёт; это ровно '
            'признак сборки без права push — человек обязан его видеть');

    await unmountPushHome(tester);
    debugDefaultTargetPlatformOverride = null;
  });
}
