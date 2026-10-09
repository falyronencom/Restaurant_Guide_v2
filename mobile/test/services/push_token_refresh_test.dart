import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/push_home_stand.dart';

/// Firebase сменил адрес телефона — сервер обязан узнать новый.
///
/// **Почему отдельный файл.** Подписки на Firebase сервис push заводит один
/// раз за процесс — при первой регистрации. В `flutter test` каждый тест
/// идёт в своей подставной зоне времени. Подписка, заведённая в первом тесте
/// файла, исполняет свои обработчики в его зоне, а эту зону после конца
/// теста уже никто не прокручивает. Смена адреса, поданная в любом следующем
/// тесте, повисала бы там и подвешивала регистрацию для всех тестов после
/// неё (найдено 08.10.2026). Каждый файл — свой процесс, поэтому здесь
/// первая регистрация случается в этом же тесте.
void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });

  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues({
      BelarusCities.persistenceKey: BelarusCities.defaultCity,
    });
  });

  testWidgets('Firebase сменил адрес телефона — новый адрес уходит на сервер',
      (tester) async {
    final phone = PhoneMessaging()..install();
    final home = await pumpPushHome(tester, storedUser: userA);
    expect(home.deviceTokenPuts(), hasLength(1), reason: 'предпосылка');

    await phone.refreshToken('fcm-token-2');
    await settlePush(tester);

    final puts = home.deviceTokenPuts();
    expect(puts, hasLength(2),
        reason: 'со сменой адреса старый перестаёт работать: сервер обязан '
            'узнать новый, иначе push уходят в никуда');
    expect((puts.last.data as Map)['fcm_token'], 'fcm-token-2');

    await unmountPushHome(tester);
  });
}
