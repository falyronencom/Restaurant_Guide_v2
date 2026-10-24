import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/menu_recognition.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/services/partner_menu_service.dart';

/// Minimal fake that exposes scripted responses; no mocking framework needed.
/// Uses `implements` to avoid depending on the service's private constructor.
class _FakeMenuService implements PartnerMenuService {
  List<PartnerMenuItem> fetchResult = [];
  MenuRecognition? recognitionResult;
  Exception? fetchThrow;

  PartnerMenuItem? updateResult;
  Exception? updateThrow;

  RetryOcrResult retryResult =
      RetryOcrResult.success(enqueuedJobs: 1, totalPdfs: 1);

  int fetchCalls = 0;
  int updateCalls = 0;

  @override
  Future<PartnerMenuSnapshot> fetchMenu(String establishmentId) async {
    fetchCalls++;
    if (fetchThrow != null) throw fetchThrow!;
    return PartnerMenuSnapshot(
        items: fetchResult, recognition: recognitionResult);
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

    // Находка 3 инцидента Railway (24.10.2026): состояние распознавания —
    // из ответа, и оно не переживает смену заведения и учётки.
    test('recognition comes from the answer; a silent poll error keeps it',
        () async {
      final fake = _FakeMenuService();
      fake.recognitionResult = const MenuRecognition(
          status: MenuRecognitionStatus.failed, reason: 'Сбой распознавания — попробуйте позже.');

      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      provider.stopPolling();

      expect(provider.recognition?.status, MenuRecognitionStatus.failed);
      expect(provider.recognition?.reason,
          'Сбой распознавания — попробуйте позже.');

      fake.fetchThrow = Exception('network');
      await provider.fetchMenuItems(silent: true);
      expect(provider.recognition?.status, MenuRecognitionStatus.failed,
          reason: 'фоновый сбой опроса не стирает показанное');

      fake.fetchThrow = null;
      fake.recognitionResult =
          const MenuRecognition(status: MenuRecognitionStatus.processing);
      await provider.fetchMenuItems(silent: true);
      expect(provider.recognition?.status, MenuRecognitionStatus.processing);
    });

    test('recognition is dropped on another establishment and on account reset',
        () async {
      final fake = _FakeMenuService();
      fake.recognitionResult =
          const MenuRecognition(status: MenuRecognitionStatus.failed);
      final provider = PartnerMenuProvider(service: fake);
      await provider.loadForEstablishment('est-1');
      provider.stopPolling();
      expect(provider.recognition, isNotNull);

      // Другое заведение: до его ответа — ничего от прежнего.
      final gate = Completer<void>();
      final gated = _GatedMenuService(gate);
      final switching = PartnerMenuProvider(service: gated);
      gated.recognitionResult =
          const MenuRecognition(status: MenuRecognitionStatus.failed);
      final first = switching.loadForEstablishment('est-1');
      gate.complete();
      await first;
      switching.stopPolling();
      expect(switching.recognition, isNotNull);
      final gate2 = Completer<void>();
      gated.gate = gate2;
      final second = switching.loadForEstablishment('est-2');
      expect(switching.recognition, isNull,
          reason: 'отказ прежнего заведения на экране чужого');
      gate2.complete();
      await second;
      switching.stopPolling();

      provider.resetAccountScope();
      expect(provider.recognition, isNull);
    });

    // Ревью 24.10.2026 (линза): поздний ответ прежней карточки ложился на
    // экран новой — до следующего опроса.
    test('a late answer of the previous card is dropped, not shown on the new one',
        () async {
      final slow = Completer<void>();
      final fake = _PerCardMenuService({
        'est-1': (
          gate: slow,
          snapshot: PartnerMenuSnapshot(
            items: [_item('1', name: 'Борщ')],
            recognition: const MenuRecognition(
                status: MenuRecognitionStatus.failed,
                reason: 'Сбой распознавания — попробуйте позже.'),
          ),
        ),
        'est-2': (
          gate: null,
          snapshot: PartnerMenuSnapshot(
            items: [_item('2', name: 'Хачапури')],
            recognition:
                const MenuRecognition(status: MenuRecognitionStatus.done),
          ),
        ),
      });
      final provider = PartnerMenuProvider(service: fake);

      final first = provider.loadForEstablishment('est-1');
      await provider.loadForEstablishment('est-2');
      provider.stopPolling();
      slow.complete();
      await first;

      expect(provider.items.map((item) => item.itemName), ['Хачапури']);
      expect(provider.recognition?.status, MenuRecognitionStatus.done);
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

      // Партнёр ввёл 6,499; `price_byn` — DECIMAL(10,2) (миграция 024), и
      // сервер сохраняет 6,50. «Подтверждение» — это ответ сервера, а не своя
      // догадка: при совпадающих значениях это не различить.
      final future =
          provider.updateItem('1', itemName: 'Эспрессо', priceByn: 6.499);

      // Optimistic: change visible immediately (before await completes)
      expect(provider.items.first.itemName, 'Эспрессо');
      expect(provider.items.first.priceByn, 6.499);

      final ok = await future;
      expect(ok, true);
      expect(fake.updateCalls, 1);
      expect(provider.items.first.itemName, 'Эспрессо');
      expect(provider.items.first.priceByn, 6.5,
          reason: 'после ответа — то, что сохранил сервер');
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

  // Ушли с экрана «Меню», пока список грузился: экран останавливал опрос
  // раньше, чем загрузка его запускала, и опрос шёл в фоне каждые 30 с.
  // testWidgets — ради управляемых часов: незакрытый таймер роняет тест сам.
  group('опрос и уход с экрана во время загрузки', () {
    testWidgets('остановили до ответа — опрос не запускается', (tester) async {
      final gate = Completer<void>();
      final fake = _GatedMenuService(gate);
      final provider = PartnerMenuProvider(service: fake);

      final load = provider.loadForEstablishment('est-1');
      provider.stopPolling(); // экран закрыт, ответа ещё нет
      gate.complete();
      await load;
      await tester.pump(const Duration(seconds: 61));

      expect(fake.fetchCalls, 1, reason: 'меню запрашивалось после ухода');
    });

    testWidgets('без остановки опрос идёт, как раньше', (tester) async {
      final gate = Completer<void>()..complete();
      final fake = _GatedMenuService(gate);
      final provider = PartnerMenuProvider(service: fake);

      await provider.loadForEstablishment('est-1');
      await tester.pump(const Duration(seconds: 31));

      expect(fake.fetchCalls, 2);
      provider.stopPolling();
    });
  });
}

/// Ответ по карточке: свой снимок и, если задан, свой замок.
class _PerCardMenuService extends _FakeMenuService {
  _PerCardMenuService(this.cards);
  final Map<String, ({Completer<void>? gate, PartnerMenuSnapshot snapshot})>
      cards;

  @override
  Future<PartnerMenuSnapshot> fetchMenu(String establishmentId) async {
    fetchCalls++;
    final card = cards[establishmentId]!;
    await card.gate?.future;
    return card.snapshot;
  }
}

/// Загрузка, которая отвечает, когда тест откроет [gate].
class _GatedMenuService extends _FakeMenuService {
  _GatedMenuService(this.gate);

  /// Не `final`: тест смены заведения открывает второй ответ другим замком.
  Completer<void> gate;

  @override
  Future<PartnerMenuSnapshot> fetchMenu(String establishmentId) async {
    fetchCalls++;
    await gate.future;
    return PartnerMenuSnapshot(
        items: fetchResult, recognition: recognitionResult);
  }
}
