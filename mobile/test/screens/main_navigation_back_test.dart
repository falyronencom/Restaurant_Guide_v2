import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/main_navigation.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Системная «Назад» на главной: выйти из приложения, а не закрыть экран.
///
/// Найдено 23.09.2026 на A72: на корне вкладки «Поиск» «Назад» давала чёрный
/// экран, не реагирующий на касания; лечился только перезапуск. Обработчик
/// `PopScope` главной на корне «Поиска» звал `Navigator.of(context).pop()` —
/// задумывалось как выход, а на деле это закрытие маршрута КОРНЕВОГО
/// навигатора. Главная к этому моменту — единственный маршрут в нём: заставка,
/// вход и регистрация приходят на `/home` через
/// `pushNamedAndRemoveUntil(..., (route) => false)`. После `pop()` навигатор
/// пуст, рисовать нечего. Выход из приложения — `SystemNavigator.pop()`.
///
/// Системная «Назад» эмулируется так же, как её доставляет движок:
/// `handlePopRoute` биндинга → `didPopRoute` приложения → `maybePop`
/// корневого навигатора → `PopScope` главной.
void main() {
  setUp(() {
    AccountScope.debugReset();
    // Город уже «сохранён»: иначе post-frame цепочка главной не найдёт его,
    // не получит GPS (плагина в тестах нет) и откроет шторку выбора города —
    // её барьер перехватил бы и тапы по вкладкам, и «Назад».
    SharedPreferences.setMockInitialValues({
      BelarusCities.persistenceKey: BelarusCities.defaultCity,
    });
  });

  /// Вызовы канала платформы за тест; «Назад» ищем среди них по имени метода.
  late List<MethodCall> platformCalls;

  int systemNavigatorPops() =>
      platformCalls.where((call) => call.method == 'SystemNavigator.pop').length;

  /// Главная — единственный маршрут корневого навигатора, как в приложении
  /// после заставки, входа или регистрации. Набор провайдеров — как в
  /// RestaurantGuideApp (test/widget_test.dart).
  Future<void> pumpHome(WidgetTester tester) async {
    installWireStand((_) => jsonBody(searchEnvelope()));

    platformCalls = <MethodCall>[];
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      platformCalls.add(call);
      return null;
    });
    addTearDown(
      () => messenger.setMockMethodCallHandler(SystemChannels.platform, null),
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AuthProvider()),
          ChangeNotifierProvider(create: (_) => EstablishmentsProvider()),
          ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
          ChangeNotifierProvider(create: (_) => NotificationProvider()),
          ChangeNotifierProvider(create: (_) => PromotionProvider()),
          ChangeNotifierProvider(create: (_) => PartnerMenuProvider()),
          ChangeNotifierProvider(create: (_) => BookingSettingsProvider()),
          ChangeNotifierProvider(create: (_) => BookingProvider()),
          ChangeNotifierProvider(
              create: (_) => NotificationPreferencesProvider()),
          ChangeNotifierProvider(create: (_) => SmartSearchProvider()),
        ],
        child: const MaterialApp(home: MainNavigationScreen()),
      ),
    );

    // Первый кадр + хвост post-frame цепочек (мок-префсы, отказ геолокации).
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    final rootNavigator =
        tester.state<NavigatorState>(find.byType(Navigator).first);
    expect(rootNavigator.canPop(), isFalse,
        reason: 'предпосылка: главная — единственный маршрут корневого '
            'навигатора, как в приложении; иначе дефект не воспроизводится');
  }

  /// Системная «Назад» — тем путём, каким её доставляет движок.
  Future<void> pressSystemBack(WidgetTester tester) async {
    await tester.binding.handlePopRoute();
    // Закрытый маршрут уходит анимацией перехода и до её конца остаётся в
    // дереве, а сдвигов два: обработчик PopScope асинхронный, и pop() на
    // сломанном коде случается уже после первого кадра; таймер анимации
    // стартует кадром позже. Поэтому после первого кадра — ещё два по
    // секунде. С одним (проверено 24.09.2026) экран на сломанном коде ещё
    // в дереве, и находка «экран на месте» была бы зелёной.
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
  }

  testWidgets('на корне «Поиска» «Назад» выходит из приложения, а не '
      'закрывает главную', (tester) async {
    await pumpHome(tester);
    expect(systemNavigatorPops(), 0, reason: 'предпосылка: до «Назад» выхода нет');

    await pressSystemBack(tester);

    expect(find.byType(MainNavigationScreen), findsOneWidget,
        reason: 'закрыть единственный маршрут значит оставить навигатор '
            'пустым — чёрный экран, не реагирующий на касания');
    expect(systemNavigatorPops(), 1,
        reason: 'выход из приложения на Android — SystemNavigator.pop, ровно '
            'один раз');
  });

  testWidgets('на другой вкладке «Назад» возвращает на «Поиск» и из '
      'приложения не выходит', (tester) async {
    await pumpHome(tester);
    await tester.tap(_tab('Профиль'));
    await tester.pump();
    expect(_navBar(tester).currentIndex, 4, reason: 'предпосылка');

    await pressSystemBack(tester);

    expect(systemNavigatorPops(), 0,
        reason: 'с вкладки, отличной от «Поиска», «Назад» не выходит из '
            'приложения');
    expect(_navBar(tester).currentIndex, 0,
        reason: '«Назад» с корня вкладки ведёт на «Поиск»');
    expect(find.byType(MainNavigationScreen), findsOneWidget);
  });
}

/// Ярлык вкладки внутри нижней навигации: тот же текст может встречаться и на
/// самих экранах, поэтому ищем только среди потомков BottomNavigationBar.
Finder _tab(String label) => find.descendant(
      of: find.byType(BottomNavigationBar),
      matching: find.text(label),
    );

BottomNavigationBar _navBar(WidgetTester tester) =>
    tester.widget<BottomNavigationBar>(find.byType(BottomNavigationBar));
