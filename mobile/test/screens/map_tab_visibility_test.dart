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
import 'package:restaurant_guide_mobile/screens/map/map_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Видит ли карта, что её вкладку скрыли.
///
/// Ревью 29.09.2026: вкладка «Карта» живёт в стопке вкладок (IndexedStack) и
/// с фразой поиска перезагружала пины на каждое касание чипа на экране
/// фильтров — семь касаний, семь скрытых запросов к умному поиску при лимите
/// 30 в минуту. Карта откладывает загрузку, пока её не видно, а видимость
/// узнаёт из TickerMode. IndexedStack тикеры скрытых вкладок НЕ гасит
/// (Visibility.maintain с maintainAnimation), поэтому вкладку карты
/// main_navigation оборачивает в TickerMode сама — это и проверяется.
///
/// Сама карта (YandexMap) — платформенный вид: канал platform_views здесь
/// заглушен, карта не «рождается» и ничего не загружает; проверяется только
/// признак видимости, который до неё доходит.
void main() {
  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues({
      BelarusCities.persistenceKey: BelarusCities.defaultCity,
    });
  });

  Future<void> pumpHome(WidgetTester tester) async {
    installWireStand((_) => jsonBody(searchEnvelope()));
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform, (_) async => null);
    messenger.setMockMethodCallHandler(SystemChannels.platform_views, (_) async => null);
    addTearDown(() {
      messenger.setMockMethodCallHandler(SystemChannels.platform, null);
      messenger.setMockMethodCallHandler(SystemChannels.platform_views, null);
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
          ChangeNotifierProvider(
              create: (_) => NotificationPreferencesProvider()),
          ChangeNotifierProvider(create: (_) => SmartSearchProvider()),
        ],
        child: const MaterialApp(home: MainNavigationScreen()),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
  }

  Finder tab(String label) => find.descendant(
        of: find.byType(BottomNavigationBar),
        matching: find.text(label),
      );

  bool mapTickerEnabled(WidgetTester tester) => TickerMode.of(
      tester.element(find.byType(MapScreen, skipOffstage: false)));

  testWidgets('скрытая вкладка карты видит TickerMode выключенным, показанная — включённым',
      (tester) async {
    await pumpHome(tester);

    await tester.tap(tab('Карта'));
    await tester.pump();
    expect(mapTickerEnabled(tester), isTrue, reason: 'карту видно');

    await tester.tap(tab('Поиск'));
    await tester.pump();
    expect(mapTickerEnabled(tester), isFalse,
        reason: 'вкладка скрыта — без этого признака карта грузила бы пины '
            'на каждое касание фильтров');

    await tester.tap(tab('Карта'));
    await tester.pump();
    expect(mapTickerEnabled(tester), isTrue, reason: 'карту снова видно');
  });
}
