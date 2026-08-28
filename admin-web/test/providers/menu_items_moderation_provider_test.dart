import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';

/// Фильтры этого экрана СЕРВЕРНЫЕ — клиентских больше нет. Поэтому тесты
/// проверяют не «что осталось в списке после отбора», а «с чем позвали сервер»
/// и «что провайдер сделал с ответом».
class _FakeAdminService implements AdminMenuItemService {
  /// Запросы по порядку: то, с чем реально позвали.
  final List<Map<String, dynamic>> calls = <Map<String, dynamic>>[];

  /// Ответы по очереди; когда кончаются, повторяется последний.
  List<FlaggedMenuItemsResponse> responses = <FlaggedMenuItemsResponse>[];

  /// Ручное управление завершением — для проверки обгона ответов.
  List<Completer<FlaggedMenuItemsResponse>>? gates;

  Object? throwFromLoad;
  Object? throwFromAction;
  int actionCalls = 0;

  @override
  Future<FlaggedMenuItemsResponse> getFlaggedItems({
    int page = 1,
    int perPage = 20,
    String? reason,
    String? visibility,
    String? city,
    String? search,
  }) {
    calls.add(<String, dynamic>{
      'page': page,
      'per_page': perPage,
      'reason': reason,
      'visibility': visibility,
      'city': city,
      'search': search,
    });

    if (throwFromLoad != null) return Future<FlaggedMenuItemsResponse>.error(throwFromLoad!);

    final pending = gates;
    if (pending != null) {
      final gate = Completer<FlaggedMenuItemsResponse>();
      pending.add(gate);
      return gate.future;
    }

    final index = calls.length - 1;
    final response = index < responses.length
        ? responses[index]
        : (responses.isEmpty ? _response() : responses.last);
    return Future<FlaggedMenuItemsResponse>.value(response);
  }

  @override
  Future<Map<String, dynamic>> hideItem({
    required String menuItemId,
    required String reason,
  }) =>
      _action();

  @override
  Future<Map<String, dynamic>> unhideItem(String menuItemId) => _action();

  @override
  Future<Map<String, dynamic>> dismissFlag(String menuItemId) => _action();

  Future<Map<String, dynamic>> _action() {
    actionCalls++;
    if (throwFromAction != null) {
      return Future<Map<String, dynamic>>.error(throwFromAction!);
    }
    return Future<Map<String, dynamic>>.value(<String, dynamic>{});
  }
}

FlaggedMenuItem _item({
  String id = '1',
  String name = 'Кофе',
  String city = 'Минск',
  bool hidden = false,
  String status = 'active',
}) {
  return FlaggedMenuItem(
    id: id,
    establishmentId: 'est-1',
    mediaId: 'media-1',
    itemName: name,
    priceByn: 5.0,
    categoryRaw: 'Напитки',
    confidence: 0.9,
    sanityFlag: const <String, dynamic>{'reason': 'price_below_threshold'},
    isHiddenByAdmin: hidden,
    hiddenReason: hidden ? 'проверено вручную' : null,
    createdAt: DateTime(2026, 4, 1),
    establishmentName: 'Cafe-$id',
    establishmentCity: city,
    establishmentStatus: status,
    establishmentCategories: const <String>['Кофейня'],
    establishmentCuisines: const <String>['Европейская'],
  );
}

FlaggedMenuItemsResponse _response({
  List<FlaggedMenuItem>? items,
  int? total,
  int page = 1,
  int pages = 1,
  int? visible,
  int? hidden,
  List<String> cities = const <String>['Гродно', 'Минск'],
  List<String> reasons = const <String>['price_below_threshold', 'low_confidence'],
}) {
  final list = items ?? <FlaggedMenuItem>[_item()];
  return FlaggedMenuItemsResponse(
    items: list,
    total: total ?? list.length,
    page: page,
    pages: pages,
    perPage: 20,
    visibleCount: visible ?? list.length,
    hiddenCount: hidden ?? 0,
    cities: cities,
    reasons: reasons,
  );
}

void main() {
  group('область и фильтры уезжают на сервер', () {
    late _FakeAdminService fake;
    late MenuItemsModerationProvider provider;

    setUp(() async {
      fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[_response()];
      provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();
    });

    test('по умолчанию запрашиваются нескрытые', () {
      // Бейдж рейла считает нескрытые, и клик по «12» обязан открыть двенадцать
      // строк. Раньше это держалось клиентским отбором поверх всей выборки —
      // теперь спрашивается у сервера, и знаменатель совпадает по построению.
      expect(provider.visibility, MenuItemVisibility.visible);
      expect(fake.calls.single['visibility'], 'visible');
    });

    test('смена области перечитывает выборку с новым режимом', () async {
      await provider.setVisibility(MenuItemVisibility.hidden);

      expect(fake.calls.last['visibility'], 'hidden');
      expect(provider.visibility, MenuItemVisibility.hidden);
    });

    test('повторный выбор той же области запроса не делает', () async {
      await provider.setVisibility(MenuItemVisibility.visible);

      expect(fake.calls.length, 1);
    });

    test('город, причина и поиск уходят параметрами', () async {
      await provider.setCityFilter('Гродно');
      await provider.setReasonFilter('low_confidence');
      await provider.setSearchFilter('драники');

      expect(fake.calls.last['city'], 'Гродно');
      expect(fake.calls.last['reason'], 'low_confidence');
      expect(fake.calls.last['search'], 'драники');
    });

    test('снятый фильтр уходит пустым, а не пустой строкой', () async {
      await provider.setCityFilter('Гродно');
      await provider.setCityFilter(null);

      expect(fake.calls.last['city'], isNull);
      expect(provider.cityFilter, isNull);
    });

    test('любой фильтр возвращает на первую страницу', () async {
      // Индексы считаются от НУЛЕВОГО вызова, а его уже сделал setUp: ответ на
      // `goToPage(3)` — это responses[1]. Смещение на единицу делало первый
      // элемент мёртвым, и тест держался на том, что соседние совпадали.
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(), // вызов setUp
        _response(page: 3, pages: 5, total: 90),
        _response(page: 1, pages: 5, total: 90),
      ];
      await provider.goToPage(3);
      expect(fake.calls.last['page'], 3);

      await provider.setCityFilter('Минск');

      // Иначе фильтр применяется к третьей странице прежней выборки, и
      // модератор видит пусто там, где строки есть.
      expect(fake.calls.last['page'], 1);
    });

    test('сброс сужающих фильтров не трогает выбранную область', () async {
      await provider.setVisibility(MenuItemVisibility.all);
      await provider.setCityFilter('Минск');
      await provider.setSearchFilter('кофе');

      await provider.resetNarrowingFilters();

      expect(provider.cityFilter, isNull);
      expect(provider.searchFilter, '');
      expect(provider.visibility, MenuItemVisibility.all);
      expect(fake.calls.last['visibility'], 'all');
    });

    test('города берутся из ответа, а канон причин не стирается пустым', () async {
      expect(provider.availableCities, <String>['Гродно', 'Минск']);
      expect(provider.availableReasons,
          <String>['price_below_threshold', 'low_confidence']);

      // Ответ без причин (старый бэкенд, обрезанная мета) не должен опустошать
      // фильтр: пустой список вариантов читается как «правил не существует».
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(reasons: const <String>[]),
      ];
      await provider.refresh();

      expect(provider.availableReasons,
          <String>['price_below_threshold', 'low_confidence']);
    });
  });

  group('снимок загруженного окна', () {
    test('после неудачного обновления список и подпись остаются прежними',
        () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(items: <FlaggedMenuItem>[_item(id: '1')], total: 7, visible: 7, hidden: 2),
      ];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();

      fake.throwFromLoad = Exception('500');
      await provider.setVisibility(MenuItemVisibility.hidden);

      // Пилюля показывает выбор модератора, а вот ЧИСЛА и область описывают то,
      // что реально на экране, — иначе подпись рассказывала бы про выборку,
      // которой никто не видит.
      expect(provider.visibility, MenuItemVisibility.hidden);
      expect(provider.items, hasLength(1));
      expect(provider.loadedTotal, 7);
      expect(provider.loadedVisibility, MenuItemVisibility.visible);
      expect(provider.loadedHiddenCount, 2);
      expect(provider.error, isNotNull);
    });

    test('первая неудача оставляет экран без снимка — под карточку ошибки',
        () async {
      final fake = _FakeAdminService()..throwFromLoad = Exception('500');
      final provider = MenuItemsModerationProvider(service: fake);

      await provider.loadFlaggedItems();

      expect(provider.hasLoaded, isFalse);
      expect(provider.error, isNotNull);
    });

    test('обогнанный ответ свой результат не пишет', () async {
      final fake = _FakeAdminService();
      fake.gates = <Completer<FlaggedMenuItemsResponse>>[];
      final provider = MenuItemsModerationProvider(service: fake);

      // Модератор нажал город, не дождался и переключил область.
      final first = provider.setCityFilter('Минск');
      final second = provider.setVisibility(MenuItemVisibility.all);

      // Отвечают в обратном порядке — так и бывает при двух запросах в полёте.
      fake.gates![1].complete(_response(
        items: <FlaggedMenuItem>[_item(id: 'второй')],
        total: 2,
      ));
      fake.gates![0].complete(_response(
        items: <FlaggedMenuItem>[_item(id: 'первый')],
        total: 99,
      ));
      await Future.wait(<Future<void>>[first, second]);

      expect(provider.items.single.id, 'второй');
      expect(provider.loadedTotal, 2);
    });
  });

  group('страницы', () {
    test('страница за пределами выборки уводит на последнюю существующую',
        () async {
      // Провайдер живёт на уровне приложения: номер страницы переживает уход с
      // экрана, а очередь тем временем убывает. Возврат на третью страницу
      // очереди из двадцати позиций давал тупик — тело говорило «очередь
      // разобрана», футера не было, вернуться было нечем.
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(page: 3, pages: 3, total: 41),
        _response(items: <FlaggedMenuItem>[], page: 3, pages: 1, total: 20),
        _response(page: 1, pages: 1, total: 20),
      ];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems(page: 3);

      await provider.refresh();

      expect(fake.calls.last['page'], 1);
      expect(provider.items, isNotEmpty);
    });

    test('пустая выборка на первой странице никуда не уводит', () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(items: <FlaggedMenuItem>[], page: 1, pages: 1, total: 0),
      ];
      final provider = MenuItemsModerationProvider(service: fake);

      await provider.loadFlaggedItems();

      // Иначе пустая очередь перечитывалась бы вечно.
      expect(fake.calls.length, 1);
    });

    test('повтор после неудачного перехода просит ТУ ЖЕ страницу', () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(page: 3, pages: 5, total: 90),
      ];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems(page: 3);

      fake.throwFromLoad = Exception('500');
      await provider.goToPage(4);
      fake.throwFromLoad = null;
      await provider.refresh();

      // Иначе «Ещё раз» в тосте молча возвращает на третью — намерение перейти
      // на четвёртую теряется без единого слова.
      expect(fake.calls.last['page'], 4);
    });
  });

  group('сброс фильтров', () {
    test('после неудачного сброса повторное нажатие снова шлёт запрос',
        () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[_response()];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();
      await provider.setSearchFilter('драники');

      fake.throwFromLoad = Exception('500');
      await provider.resetNarrowingFilters();
      final callsAfterFailure = fake.calls.length;

      fake.throwFromLoad = null;
      await provider.resetNarrowingFilters();

      // Фильтры уже обнулены, но на экране всё ещё «Ничего не нашлось» с этой
      // кнопкой. Кнопка, не реагирующая на нажатие, читается как поломка.
      expect(fake.calls.length, callsAfterFailure + 1);
    });
  });

  group('выбор позиции', () {
    test('исчезнувшая из выборки позиция снимает выбор', () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(items: <FlaggedMenuItem>[_item(id: '1'), _item(id: '2')]),
        _response(items: <FlaggedMenuItem>[_item(id: '2')]),
      ];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();
      provider.selectItem('1');
      expect(provider.selected?.id, '1');

      await provider.refresh();

      // Иначе панель разбора показывает позицию, которой в очереди уже нет.
      expect(provider.selectedId, isNull);
      expect(provider.selected, isNull);
    });

    test('выбранная позиция переопределяется по свежему списку', () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[
        _response(items: <FlaggedMenuItem>[_item(id: '1', hidden: false)]),
        _response(items: <FlaggedMenuItem>[_item(id: '1', hidden: true)]),
      ];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();
      provider.selectItem('1');

      await provider.refresh();

      // Панель обязана показывать состояние из последнего ответа, а не тот
      // объект, который выбрали до действия.
      expect(provider.selected?.isHiddenByAdmin, isTrue);
    });
  });

  group('действия', () {
    test('успешное действие перечитывает страницу', () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[_response(), _response()];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();

      final ok = await provider.hideItem('1', 'причина не короче десяти');

      expect(ok, isTrue);
      // Правка строки на месте не годится: скрытие меняет и членство в выборке,
      // и оба счётчика подписи, и число страниц. Считает это сервер.
      expect(fake.calls.length, 2);
    });

    test('опустевшая страница уводит на предыдущую', () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[
        // Первая загрузка: модератор на второй странице.
        _response(page: 2, pages: 2, total: 21),
        // Перечитка после действия: страница осталась, но опустела.
        _response(items: <FlaggedMenuItem>[], page: 2, pages: 1, total: 20),
        // Шаг назад.
        _response(page: 1, pages: 1, total: 20),
      ];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems(page: 2);

      await provider.dismissFlag('1');

      // Последняя позиция страницы ушла из выборки — иначе модератор упирается
      // в пустоту там, где очередь ещё есть.
      expect(fake.calls.last['page'], 1);
      expect(provider.items, isNotEmpty);
    });

    test('неудача действия не трогает список и объясняется', () async {
      final fake = _FakeAdminService();
      fake.responses = <FlaggedMenuItemsResponse>[_response()];
      final provider = MenuItemsModerationProvider(service: fake);
      await provider.loadFlaggedItems();

      fake.throwFromAction = Exception('500');
      final ok = await provider.hideItem('1', 'причина не короче десяти');

      expect(ok, isFalse);
      expect(provider.actionError, isNotNull);
      expect(provider.items, hasLength(1));
      // Перечитки не было: список остался тем же, что и был.
      expect(fake.calls.length, 1);
    });
  });
}
