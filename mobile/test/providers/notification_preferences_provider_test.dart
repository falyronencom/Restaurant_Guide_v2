// Контракт четвёртого переключателя «Меню» (menu_push_enabled, миграция 033
// на бэкенде): разбор ответа, частичный PUT, откат при ошибке, сброс аккаунта.

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/fake_api_client.dart';

Map<String, dynamic> _allOn({bool menu = true}) => <String, dynamic>{
      'booking_push_enabled': true,
      'reviews_push_enabled': true,
      'promotions_push_enabled': true,
      'menu_push_enabled': menu,
    };

void main() {
  setUp(AccountScope.debugReset);

  group('NotificationPreferencesProvider — menu_push_enabled', () {
    test('fetchPreferences reads menu_push_enabled from the envelope', () async {
      final fake = FakeApiClient()..prefsFromServer = _allOn(menu: false);
      final provider = NotificationPreferencesProvider(apiClient: fake);
      addTearDown(provider.dispose);

      await provider.fetchPreferences();

      expect(provider.menuPushEnabled, isFalse);
      expect(provider.bookingPushEnabled, isTrue);
      expect(provider.reviewsPushEnabled, isTrue);
      expect(provider.promotionsPushEnabled, isTrue);
      expect(provider.isLoading, isFalse);
    });

    test('menu toggle stays on when the backend omits the field (pre-033 schema)',
        () async {
      final fake = FakeApiClient()
        ..prefsFromServer = <String, dynamic>{
          'booking_push_enabled': false,
          'reviews_push_enabled': true,
          'promotions_push_enabled': true,
        };
      final provider = NotificationPreferencesProvider(apiClient: fake);
      addTearDown(provider.dispose);

      await provider.fetchPreferences();

      expect(provider.menuPushEnabled, isTrue);
      expect(provider.bookingPushEnabled, isFalse);
    });

    test('updatePreferences(menu:) sends only menu_push_enabled', () async {
      final fake = FakeApiClient()..prefsFromServer = _allOn();
      final provider = NotificationPreferencesProvider(apiClient: fake);
      addTearDown(provider.dispose);
      await provider.fetchPreferences();

      await provider.updatePreferences(menu: false);

      expect(provider.menuPushEnabled, isFalse);
      expect(fake.putBodies, [
        <String, dynamic>{'menu_push_enabled': false},
      ]);
      // Siblings untouched locally as well.
      expect(provider.bookingPushEnabled, isTrue);
      expect(provider.reviewsPushEnabled, isTrue);
      expect(provider.promotionsPushEnabled, isTrue);
    });

    test('a sibling update does not carry menu_push_enabled', () async {
      final fake = FakeApiClient()..prefsFromServer = _allOn(menu: false);
      final provider = NotificationPreferencesProvider(apiClient: fake);
      addTearDown(provider.dispose);
      await provider.fetchPreferences();

      await provider.updatePreferences(promotions: false);

      expect(fake.putBodies.single.containsKey('menu_push_enabled'), isFalse);
      expect(provider.menuPushEnabled, isFalse);
    });

    test('optimistic menu update rolls back when PUT fails', () async {
      final fake = FakeApiClient()
        ..prefsFromServer = _allOn()
        ..putError = Exception('network');
      final provider = NotificationPreferencesProvider(apiClient: fake);
      addTearDown(provider.dispose);
      await provider.fetchPreferences();

      var notifications = 0;
      provider.addListener(() => notifications++);

      await provider.updatePreferences(menu: false);

      expect(provider.menuPushEnabled, isTrue);
      // Optimistic flip + rollback = two notifications.
      expect(notifications, 2);
    });

    test('resetAccountScope restores menu default and forces a re-fetch',
        () async {
      final fake = FakeApiClient()..prefsFromServer = _allOn(menu: false);
      final provider = NotificationPreferencesProvider(apiClient: fake);
      addTearDown(provider.dispose);
      await provider.ensureLoaded();
      expect(provider.menuPushEnabled, isFalse);
      expect(fake.getCalls, 1);

      AccountScope.resetAll();

      expect(provider.menuPushEnabled, isTrue);
      await provider.ensureLoaded();
      expect(fake.getCalls, 2);
    });
  });
}
