import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';

/// Fake via `implements` — no mocking framework needed.
class _FakeAdminService implements AdminMenuItemService {
  FlaggedMenuItemsResponse fetchResult = FlaggedMenuItemsResponse(
    items: [],
    total: 0,
    page: 1,
    pages: 1,
  );
  Map<String, dynamic>? hideResult;
  Map<String, dynamic>? unhideResult;
  Map<String, dynamic>? dismissResult;
  Exception? throwFromHide;

  @override
  Future<FlaggedMenuItemsResponse> getFlaggedItems({
    int page = 1,
    int perPage = 50,
    String? reason,
  }) async =>
      fetchResult;

  @override
  Future<Map<String, dynamic>> hideItem({
    required String menuItemId,
    required String reason,
  }) async {
    if (throwFromHide != null) throw throwFromHide!;
    return hideResult ?? {};
  }

  @override
  Future<Map<String, dynamic>> unhideItem(String menuItemId) async =>
      unhideResult ?? {};

  @override
  Future<Map<String, dynamic>> dismissFlag(String menuItemId) async =>
      dismissResult ?? {};
}

FlaggedMenuItem _item({
  String id = '1',
  String name = 'Кофе',
  String city = 'Минск',
  bool hidden = false,
  Map<String, dynamic>? flag,
}) {
  return FlaggedMenuItem(
    id: id,
    establishmentId: 'est-1',
    mediaId: 'media-1',
    itemName: name,
    priceByn: 5.0,
    categoryRaw: 'Напитки',
    confidence: 0.9,
    sanityFlag: flag ?? {'reason': 'price_below_threshold'},
    isHiddenByAdmin: hidden,
    hiddenReason: hidden ? 'stale' : null,
    createdAt: DateTime(2026, 4, 1),
    establishmentName: 'Cafe-$id',
    establishmentCity: city,
    establishmentStatus: 'active',
  );
}

void main() {
  group('MenuItemsModerationProvider filters', () {
    late _FakeAdminService fake;
    late MenuItemsModerationProvider provider;

    setUp(() async {
      fake = _FakeAdminService();
      fake.fetchResult = FlaggedMenuItemsResponse(
        items: [
          _item(id: '1', city: 'Минск', hidden: false),
          _item(id: '2', city: 'Гомель', hidden: false),
          _item(id: '3', city: 'Минск', hidden: true),
        ],
        total: 3,
        page: 1,
        pages: 1,
      );
      provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();
    });

    test('no filter returns all items', () {
      expect(provider.items.length, 3);
    });

    test('city filter narrows to matching items', () {
      provider.setCityFilter('Минск');
      expect(provider.items.length, 2);
      expect(provider.items.every((i) => i.establishmentCity == 'Минск'), true);
    });

    test('status=hidden filter returns only hidden', () {
      provider.setStatusFilter(HiddenStatusFilter.hidden);
      expect(provider.items.length, 1);
      expect(provider.items.first.isHiddenByAdmin, true);
    });

    test('status=notHidden filter excludes hidden', () {
      provider.setStatusFilter(HiddenStatusFilter.notHidden);
      expect(provider.items.every((i) => !i.isHiddenByAdmin), true);
      expect(provider.items.length, 2);
    });

    test('combined filters intersect', () {
      provider.setCityFilter('Минск');
      provider.setStatusFilter(HiddenStatusFilter.hidden);
      expect(provider.items.length, 1);
      expect(provider.items.first.id, '3');
    });

    test('search matches item or establishment name', () {
      provider.setSearchFilter('Cafe-2');
      expect(provider.items.length, 1);
      expect(provider.items.first.id, '2');
    });

    test('availableCities lists unique cities sorted', () {
      expect(provider.availableCities, ['Гомель', 'Минск']);
    });
  });

  group('MenuItemsModerationProvider actions', () {
    test('hideItem success updates row in place', () async {
      final fake = _FakeAdminService();
      fake.fetchResult = FlaggedMenuItemsResponse(
        items: [_item(id: '1', hidden: false)],
        total: 1,
        page: 1,
        pages: 1,
      );
      fake.hideResult = {
        'is_hidden_by_admin': true,
        'hidden_reason': 'Ошибочная цена',
      };

      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();

      final ok = await provider.hideItem('1', 'Ошибочная цена');
      expect(ok, true);
      expect(provider.items.first.isHiddenByAdmin, true);
      expect(provider.items.first.hiddenReason, 'Ошибочная цена');
    });

    test('hideItem failure sets actionError, leaves state', () async {
      final fake = _FakeAdminService();
      fake.fetchResult = FlaggedMenuItemsResponse(
        items: [_item(id: '1', hidden: false)],
        total: 1,
        page: 1,
        pages: 1,
      );
      fake.throwFromHide = Exception('500');

      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();

      final ok = await provider.hideItem('1', 'test reason min 10 chars');
      expect(ok, false);
      expect(provider.actionError, isNotNull);
      expect(provider.items.first.isHiddenByAdmin, false);
    });

    test('dismissFlag removes item when sanity_flag becomes null', () async {
      final fake = _FakeAdminService();
      fake.fetchResult = FlaggedMenuItemsResponse(
        items: [_item(id: '1'), _item(id: '2')],
        total: 2,
        page: 1,
        pages: 1,
      );
      fake.dismissResult = {'sanity_flag': null};

      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();

      final ok = await provider.dismissFlag('1');
      expect(ok, true);
      expect(provider.items.length, 1);
      expect(provider.items.first.id, '2');
    });
  });
}
