import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/services/partner_menu_service.dart';

/// Minimal fake that exposes scripted responses; no mocking framework needed.
/// Uses `implements` to avoid depending on the service's private constructor.
class _FakeMenuService implements PartnerMenuService {
  List<PartnerMenuItem> fetchResult = [];
  Exception? fetchThrow;

  PartnerMenuItem? updateResult;
  Exception? updateThrow;

  RetryOcrResult retryResult =
      RetryOcrResult.success(enqueuedJobs: 1, totalPdfs: 1);

  int fetchCalls = 0;
  int updateCalls = 0;

  @override
  Future<List<PartnerMenuItem>> fetchMenuItems(String establishmentId) async {
    fetchCalls++;
    if (fetchThrow != null) throw fetchThrow!;
    return fetchResult;
  }

  @override
  Future<PartnerMenuItem> updateMenuItem(
    String menuItemId, {
    String? itemName,
    double? priceByn,
    String? categoryRaw,
  }) async {
    updateCalls++;
    if (updateThrow != null) throw updateThrow!;
    return updateResult!;
  }

  @override
  Future<RetryOcrResult> retryOcr(String establishmentId) async {
    return retryResult;
  }
}

PartnerMenuItem _item(String id, {String name = 'Кофе', double price = 5.0}) {
  return PartnerMenuItem(
    id: id,
    establishmentId: 'est-1',
    mediaId: 'media-1',
    itemName: name,
    priceByn: price,
    categoryRaw: 'Напитки',
    confidence: 0.95,
    sanityFlag: null,
    position: 0,
  );
}

void main() {
  group('PartnerMenuProvider', () {
    test('fetchMenuItems populates items', () async {
      final fake = _FakeMenuService();
      fake.fetchResult = [_item('1'), _item('2')];

      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      // Stop polling to avoid timer leak in tests
      provider.stopPolling();

      expect(provider.items.length, 2);
      expect(provider.hasItems, true);
      expect(provider.error, isNull);
    });

    test('fetchMenuItems on network error sets error', () async {
      final fake = _FakeMenuService();
      fake.fetchThrow = Exception('network');

      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      provider.stopPolling();

      expect(provider.items, isEmpty);
      expect(provider.error, isNotNull);
    });

    test('optimistic update applies immediately and confirms on success',
        () async {
      final fake = _FakeMenuService();
      fake.fetchResult = [_item('1', name: 'Кофе', price: 5.0)];
      fake.updateResult = _item('1', name: 'Эспрессо', price: 6.5);

      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      provider.stopPolling();

      final future =
          provider.updateItem('1', itemName: 'Эспрессо', priceByn: 6.5);

      // Optimistic: change visible immediately (before await completes)
      expect(provider.items.first.itemName, 'Эспрессо');
      expect(provider.items.first.priceByn, 6.5);

      final ok = await future;
      expect(ok, true);
      expect(fake.updateCalls, 1);
      expect(provider.items.first.itemName, 'Эспрессо');
    });

    test('optimistic update rolls back on backend failure', () async {
      final fake = _FakeMenuService();
      fake.fetchResult = [_item('1', name: 'Кофе', price: 5.0)];
      fake.updateThrow = Exception('4xx');

      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      provider.stopPolling();

      final ok = await provider.updateItem('1', itemName: 'X', priceByn: 99);

      expect(ok, false);
      expect(provider.error, isNotNull);
      // Rolled back to original
      expect(provider.items.first.itemName, 'Кофе');
      expect(provider.items.first.priceByn, 5.0);
    });

    test('retryOcr surfaces rate limit with retry-after', () async {
      final fake = _FakeMenuService();
      fake.fetchResult = [];
      fake.retryResult = RetryOcrResult.rateLimited(
        retryAfter: 300,
        message: 'Лимит перезапусков исчерпан',
      );

      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      provider.stopPolling();

      final result = await provider.retryOcr();
      expect(result.success, false);
      expect(result.errorCode, 'RATE_LIMITED');
      expect(result.retryAfterSeconds, 300);
    });

    test('itemsByCategory groups by category_raw', () async {
      final fake = _FakeMenuService();
      fake.fetchResult = [
        _item('1', name: 'A'),
        PartnerMenuItem(
          id: '2',
          establishmentId: 'est-1',
          mediaId: 'm',
          itemName: 'B',
          priceByn: 2,
          categoryRaw: 'Десерты',
          confidence: null,
          sanityFlag: null,
          position: 1,
        ),
      ];

      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      provider.stopPolling();

      final groups = provider.itemsByCategory;
      expect(groups.keys.toList(), containsAll(['Напитки', 'Десерты']));
      expect(groups['Напитки']!.length, 1);
      expect(groups['Десерты']!.length, 1);
    });
  });
}
