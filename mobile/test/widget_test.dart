// Смоук главной навигации (нижние вкладки).
//
// Сплэш сюда сознательно не входит: он — функциональный гейт (ждёт
// AuthProvider с 10-секундным таймаутом), его кольцо крутится бесконечно,
// поэтому pumpAndSettle на нём не сходится, а гостя он уводит на
// /auth/method-selection, не на /home. Смоук проверяет MainNavigationScreen
// напрямую — как и остальные тесты в test/widgets/.

import 'package:flutter/material.dart';
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

/// Поднимает MainNavigationScreen с тем же набором провайдеров, что и
/// RestaurantGuideApp (создаются лениво — неиспользуемые не строятся).
Future<void> _pumpMainNavigation(WidgetTester tester) async {
  // Город уже «сохранён»: иначе post-frame цепочка SearchHomeScreen не найдёт
  // его в префсах, не получит GPS (плагина в тестах нет) и откроет шторку
  // выбора города — её modal barrier перехватил бы тапы по вкладкам.
  SharedPreferences.setMockInitialValues({
    BelarusCities.persistenceKey: BelarusCities.defaultCity,
  });

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
        ChangeNotifierProvider(create: (_) => NotificationPreferencesProvider()),
        ChangeNotifierProvider(create: (_) => SmartSearchProvider()),
      ],
      child: const MaterialApp(home: MainNavigationScreen()),
    ),
  );

  // Первый кадр + хвост post-frame цепочек (мок-префсы, отказ геолокации).
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
}

/// Ярлык вкладки внутри нижней навигации: тот же текст может встречаться и на
/// самих экранах, поэтому ищем только среди потомков BottomNavigationBar.
Finder _tab(String label) => find.descendant(
      of: find.byType(BottomNavigationBar),
      matching: find.text(label),
    );

BottomNavigationBar _navBar(WidgetTester tester) =>
    tester.widget<BottomNavigationBar>(find.byType(BottomNavigationBar));

void main() {
  testWidgets('App launches successfully with navigation', (tester) async {
    await _pumpMainNavigation(tester);

    expect(find.byType(BottomNavigationBar), findsOneWidget);

    expect(_tab('Поиск'), findsOneWidget);
    expect(_tab('Новости'), findsOneWidget);
    expect(_tab('Карта'), findsOneWidget);
    expect(_tab('Избранное'), findsOneWidget);
    expect(_tab('Профиль'), findsOneWidget);

    expect(find.byType(Scaffold), findsWidgets);
  });

  testWidgets('Tab switching works', (tester) async {
    await _pumpMainNavigation(tester);

    await tester.tap(_tab('Новости'));
    await tester.pump();

    expect(_navBar(tester).currentIndex, 1);
    expect(find.text('Новости и акции'), findsOneWidget);

    await tester.tap(_tab('Профиль'));
    await tester.pump();

    expect(_navBar(tester).currentIndex, 4);
    // Гостевая карточка профиля (пользователь в тестах не авторизован).
    expect(find.text('Войти в аккаунт'), findsOneWidget);
  });
}
