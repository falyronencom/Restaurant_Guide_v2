import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/public_menu_item.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/establishment/menu_screen.dart';
import 'package:restaurant_guide_mobile/widgets/glass_action_chip.dart';
import 'package:restaurant_guide_mobile/widgets/menu/menu_text.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Меню текстом с ценами в приложении и кнопка «Меню» на первом экране
/// карточки (бриф В3, 18.10.2026; SDL CAT-C-2.6, CAT-C-2.7 ред. 2026-05-26,
/// CAT-D-1.6).
///
/// До этой правки гость видел в приложении только фото и PDF меню, а
/// распознанное меню с ценами — лишь на сайте. Поверх настоящих `ApiClient`
/// и `PublicMenuService`, подменён только провод: адрес запроса, конверт и
/// ключи позиции проверяются те, что отдаёт сервер (`wire_fixtures.dart`).
const _id = '11111111-1111-4111-8111-111111111111';
const _menuPath =
    '/api/v1/public/establishments/by-slug/vasilki-minsk/menu-items';

/// Семь позиций в трёх разделах — порядок, как отдаёт сервер (по `position`).
/// Цены и пометки — литералы: «14,50 BYN», «—», «уточнить» списаны с сайта
/// (`MenuItemsList.tsx`), а не посчитаны тем же кодом.
final _items = [
  menuItemRow(
      id: 'm1', name: 'Борщ', price: 9.5, category: 'Супы', position: 0),
  menuItemRow(
      id: 'm2', name: 'Солянка', price: 12, category: 'Супы', position: 1),
  menuItemRow(
      id: 'm3',
      name: 'Драники',
      price: 14.5,
      category: 'Горячее',
      position: 2,
      tier: 'needs_caution'),
  menuItemRow(id: 'm4', name: 'Мачанка', category: 'Горячее', position: 3),
  menuItemRow(
      id: 'm5', name: 'Котлета', price: 16, category: 'Горячее', position: 4),
  menuItemRow(
      id: 'm6', name: 'Сырники', price: 8, category: 'Десерты', position: 5),
  menuItemRow(
      id: 'm7', name: 'Блины', price: 7, category: 'Десерты', position: 6),
];

final _pdf = mediaRow(
  id: '22222222-2222-4222-8222-000000000001',
  type: 'menu',
  fileType: 'pdf',
);

ResponseBody _offline(RequestOptions options) =>
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'нет сети (тест)',
    );

class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

class _Guest extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

/// Что сервер отвечает на меню: строки, сбой сети — или ответ строит тест.
late ResponseBody Function(RequestOptions) _menuAnswer;
late StubAdapter _wire;

void _stand({List<dynamic>? media}) {
  _wire = installWireStand((options) {
    final path = options.uri.path;
    if (path == '/api/v1/search/establishments/$_id') {
      final row = establishmentRow(id: _id, media: media ?? [_pdf])
        // Сетевая картинка и карта Яндекса в тесте не работают.
        ..['primary_image_url'] = null
        ..['latitude'] = null
        ..['longitude'] = null;
      return jsonBody({'success': true, 'data': row});
    }
    if (path == _menuPath) return _menuAnswer(options);
    if (path == '/api/v1/establishments/$_id/reviews') {
      return jsonBody(reviewsEnvelope(reviews: [], total: 0, pages: 0));
    }
    return jsonBody({'success': false}, status: 404);
  });
}

int _menuRequests() =>
    _wire.requests.where((r) => r.uri.path == _menuPath).length;

/// Телефон 360 × [height]: при 700 раздел «Меню» ниже первого экрана (герой
/// 657 + «Описание»), при 900 — край раздела уже виден.
Future<void> _pumpCard(WidgetTester tester, {double height = 700}) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = Size(360, height);
  tester.view.padding = const FakeViewPadding(top: 24);
  tester.view.viewPadding = const FakeViewPadding(top: 24);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthProvider>(create: (_) => _Guest()),
      ChangeNotifierProvider<EstablishmentsProvider>(
          create: (_) => _NoLocation()),
      ChangeNotifierProvider<BookingProvider>(create: (_) => BookingProvider()),
    ],
    child: MaterialApp(
      theme: AppTheme.lightTheme,
      debugShowCheckedModeBanner: false,
      home: const EstablishmentDetailScreen(establishmentId: _id),
    ),
  ));
  await tester.pumpAndSettle();
}

/// Долистать карточку до раздела «Меню».
Future<void> _scrollToMenu(WidgetTester tester) async {
  await tester.drag(
      find.byType(SingleChildScrollView).first, const Offset(0, -400));
  await tester.pumpAndSettle();
}

final _heroButton = find.byKey(EstablishmentDetailScreen.menuButtonKey);

Future<void> _openMenuScreen(WidgetTester tester) async {
  await tester.tap(_heroButton);
  await tester.pumpAndSettle();
  expect(find.byType(MenuScreen), findsOneWidget,
      reason: 'кнопка «Меню» не открыла экран меню');
}

void main() {
  setUp(() {
    _menuAnswer = (_) => jsonBody(menuItemsEnvelope(_items));
  });

  group('Карточка заведения', () {
    testWidgets(
        'кнопка «Меню» на первом экране: целиком видна, не под правой '
        'колонкой и не на чипах', (tester) async {
      _stand();
      await _pumpCard(tester);

      expect(_heroButton, findsOneWidget);
      final button = tester.getRect(_heroButton);
      // Первый экран — 700 dp высотой; кнопка — внутри фото-героя (657).
      expect(button.top, greaterThan(24 + 36 + 50),
          reason: 'кнопка залезла под «Назад» и «Поделиться»');
      expect(button.bottom, lessThanOrEqualTo(657));
      expect(button.height, greaterThanOrEqualTo(48),
          reason: 'зона тапа меньше 48 dp');
      // Правая колонка — сердечко избранного под оценкой.
      final heart = tester.getRect(find.byIcon(Icons.favorite_border));
      expect(button.right, lessThan(heart.left),
          reason: 'кнопка уехала под правую колонку');
      for (final chip in tester.widgetList(find.byType(GlassActionChip))) {
        expect(button.overlaps(tester.getRect(find.byWidget(chip))), isFalse,
            reason: 'кнопка наехала на чип');
      }
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'у заведения нет меню-файлов: кнопки нет, меню не запрашивается',
        (tester) async {
      _stand(media: []);
      await _pumpCard(tester, height: 900);
      await _scrollToMenu(tester);

      expect(_heroButton, findsNothing);
      expect(_menuRequests(), 0);
    });

    testWidgets(
        'меню грузится лениво: пока раздел не на экране — запроса нет, '
        'долистал — пришло', (tester) async {
      _stand();
      await _pumpCard(tester);

      expect(_menuRequests(), 0,
          reason: 'меню запрошено до того, как гость до него дошёл');

      await _scrollToMenu(tester);
      expect(_menuRequests(), 1);
      expect(find.text('Борщ'), findsOneWidget);
    });

    testWidgets(
        'высокий экран: край раздела «Меню» виден сразу — меню приходит '
        'без прокрутки', (tester) async {
      _stand();
      await _pumpCard(tester, height: 900);

      expect(_menuRequests(), 1);
      expect(find.text('Борщ'), findsOneWidget);
    });

    testWidgets(
        'первые пять позиций текстом с ценами, пометка «извлечено '
        'автоматически», остальное — за «Всё меню»', (tester) async {
      _stand();
      await _pumpCard(tester, height: 900);
      await _scrollToMenu(tester);

      expect(find.text(MenuAutoExtractedNote.text), findsOneWidget);
      for (final name in ['Борщ', 'Солянка', 'Драники', 'Мачанка', 'Котлета']) {
        expect(find.textContaining(name), findsOneWidget, reason: name);
      }
      expect(find.text('Сырники'), findsNothing,
          reason: 'в карточке — только первые пять');
      expect(find.text('Супы'), findsOneWidget);
      expect(find.text('Горячее'), findsOneWidget);

      // Цены — словами сайта.
      expect(find.text('9,50 BYN'), findsOneWidget);
      expect(find.text('12 BYN'), findsOneWidget);
      expect(find.text('14,50 BYN'), findsOneWidget);
      // Без цены — позиция есть, вместо цены «—».
      expect(find.text('—'), findsOneWidget);
      // needs_caution — показана, с пометкой; clean — без неё.
      expect(find.text(MenuItemRow.cautionLabel), findsOneWidget);

      expect(find.text('Всё меню · 7 позиций'), findsOneWidget);
      // Оригинал остаётся.
      expect(find.text('Открыть PDF'), findsOneWidget);
    });

    testWidgets(
        'нет сети: «Не удалось загрузить меню» и «Повторить», PDF на месте; '
        'повтор приносит меню', (tester) async {
      _menuAnswer = _offline;
      _stand();
      await _pumpCard(tester, height: 900);
      await _scrollToMenu(tester);

      expect(find.text(MenuLoadFailedBox.text), findsOneWidget);
      expect(find.text('Открыть PDF'), findsOneWidget);
      expect(find.text(MenuAutoExtractedNote.text), findsNothing);

      _menuAnswer = (_) => jsonBody(menuItemsEnvelope(_items));
      await tester.tap(find.text('Повторить'));
      await tester.pumpAndSettle();

      expect(find.text(MenuLoadFailedBox.text), findsNothing);
      expect(find.text('Борщ'), findsOneWidget);
    });

    testWidgets(
        'распознанного меню нет — как раньше: PDF без пометки и без ошибки',
        (tester) async {
      _menuAnswer = (_) => jsonBody(menuItemsEnvelope([]));
      _stand();
      await _pumpCard(tester, height: 900);
      await _scrollToMenu(tester);

      expect(_menuRequests(), 1);
      expect(find.text('Открыть PDF'), findsOneWidget);
      expect(find.text(MenuAutoExtractedNote.text), findsNothing);
      expect(find.text(MenuLoadFailedBox.text), findsNothing);
      expect(find.text(MenuLoadingBox.text), findsNothing);
    });
  });

  group('Экран меню', () {
    testWidgets(
        'кнопка «Меню» до прокрутки грузит меню: на экране все позиции и '
        'разделы чипами', (tester) async {
      _stand();
      await _pumpCard(tester);
      expect(_menuRequests(), 0);

      await _openMenuScreen(tester);

      expect(_menuRequests(), 1);
      final screen = find.byType(MenuScreen);
      for (final name in ['Борщ', 'Котлета', 'Сырники', 'Блины']) {
        await tester.scrollUntilVisible(
            find.descendant(of: screen, matching: find.textContaining(name)),
            200,
            scrollable: find
                .descendant(of: screen, matching: find.byType(Scrollable))
                .last);
        expect(find.descendant(of: screen, matching: find.textContaining(name)),
            findsOneWidget,
            reason: name);
      }
      // Чипы разделов — по одному на раздел, сверху.
      for (final title in ['Супы', 'Горячее', 'Десерты']) {
        expect(find.descendant(of: screen, matching: find.text(title)),
            findsWidgets);
      }
    });

    testWidgets('«Оригинал» приводит к PDF; тап по чипу — раздел к верху',
        (tester) async {
      // Десерты длиннее экрана: после «Оригинал» их заголовок уходит вверх,
      // и подсвечен должен быть их чип, а не «Супы» с начала.
      _menuAnswer = (_) => jsonBody(menuItemsEnvelope([
            ..._items,
            for (var i = 0; i < 15; i++)
              menuItemRow(
                  id: 'd$i',
                  name: 'Торт $i',
                  price: 9,
                  category: 'Десерты',
                  position: 10 + i),
          ]));
      _stand();
      await _pumpCard(tester);
      await _openMenuScreen(tester);

      final screen = find.byType(MenuScreen);
      final list = find
          .descendant(of: screen, matching: find.byType(SingleChildScrollView))
          .last;
      final listTop = tester.getRect(list).top;
      final position = tester
          .state<ScrollableState>(find
              .descendant(of: list, matching: find.byType(Scrollable))
              .first)
          .position;
      expect(position.pixels, 0);

      // «Оригинал» — от верха списка: PDF ниже первого экрана.
      expect(tester.getRect(find.text('Открыть PDF')).top, greaterThan(700),
          reason: 'PDF и без перехода на экране — проверка ничего не покажет');
      await tester.tap(find.text('Оригинал'));
      await tester.pumpAndSettle();
      final pdf = tester.getRect(find.text('Открыть PDF'));
      expect(pdf.top, greaterThanOrEqualTo(listTop));
      expect(pdf.bottom, lessThanOrEqualTo(700));
      final selected = find.descendant(
          of: screen,
          matching: find.byWidgetPredicate(
              (w) => w is Semantics && w.properties.selected == true));
      expect(selected, findsOneWidget);
      expect(find.descendant(of: selected, matching: find.text('Десерты')),
          findsOneWidget,
          reason: 'после «Оригинал» подсвечен не тот раздел, где оказались');

      position.jumpTo(0);
      await tester.pumpAndSettle();

      // Чип «Горячее» — в ряду чипов (первый найденный текст), заголовок
      // раздела — в списке.
      final header = find.descendant(
          of: find.byType(MenuSectionView), matching: find.text('Горячее'));
      final chip =
          find.descendant(of: screen, matching: find.text('Горячее')).first;
      await tester.tap(chip);
      await tester.pumpAndSettle();
      // Раздел у верха списка — или список докручен до конца, и выше
      // поднять раздел нельзя.
      final atTop = (tester.getRect(header).top - listTop).abs() < 40;
      final atEnd = position.pixels == position.maxScrollExtent;
      expect(position.pixels, greaterThan(0),
          reason: 'тап по чипу не прокрутил');
      expect(atTop || atEnd, isTrue,
          reason: 'раздел «Горячее» не пришёл к верху списка');
      expect(tester.getRect(header).top, greaterThanOrEqualTo(listTop));
    });

    testWidgets('меню уже пришло в карточке — экран второй раз не ходит',
        (tester) async {
      _stand();
      await _pumpCard(tester, height: 900);
      await _scrollToMenu(tester);
      expect(_menuRequests(), 1);

      await tester.ensureVisible(find.text('Всё меню · 7 позиций'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Всё меню · 7 позиций'));
      await tester.pumpAndSettle();

      expect(find.byType(MenuScreen), findsOneWidget);
      expect(_menuRequests(), 1);
    });

    testWidgets('нет сети на экране меню: ошибка, «Повторить», оригинал виден',
        (tester) async {
      _menuAnswer = _offline;
      _stand();
      await _pumpCard(tester);
      await _openMenuScreen(tester);

      final screen = find.byType(MenuScreen);
      expect(
          find.descendant(
              of: screen, matching: find.text(MenuLoadFailedBox.text)),
          findsOneWidget);
      expect(find.descendant(of: screen, matching: find.text('Открыть PDF')),
          findsOneWidget);

      _menuAnswer = (_) => jsonBody(menuItemsEnvelope(_items));
      await tester
          .tap(find.descendant(of: screen, matching: find.text('Повторить')));
      await tester.pumpAndSettle();
      expect(find.descendant(of: screen, matching: find.text('Борщ')),
          findsOneWidget);
    });
  });

  group('Правила показа (как на сайте)', () {
    test('разделы — в порядке первой встречи, внутри — по position', () {
      final items = [
        PublicMenuItem.fromJson(menuItemRow(
            id: 'a', name: 'Чай', category: 'Напитки', position: 3)),
        PublicMenuItem.fromJson(
            menuItemRow(id: 'b', name: 'Суп', category: 'Супы', position: 1)),
        PublicMenuItem.fromJson(menuItemRow(
            id: 'c', name: 'Кофе', category: 'Напитки', position: 2)),
        PublicMenuItem.fromJson(
            menuItemRow(id: 'd', name: 'Хлеб', category: '', position: 0)),
      ];
      final sections = groupMenuSections(items);
      expect(sections.map((s) => s.title), ['Напитки', 'Супы', null]);
      expect(sections.first.items.map((i) => i.itemName), ['Кофе', 'Чай']);
    });

    test(
        'равные position (несколько файлов меню) — порядок сервера, как у '
        'сайта, и в длинном разделе', () {
      // Сервер отдаёт по `position`, затем по названию; у всех 40 позиций
      // номер один и тот же.
      final names = [
        for (var i = 0; i < 40; i++) 'Блюдо ${i.toString().padLeft(2, '0')}'
      ];
      final items = [
        for (final name in names)
          PublicMenuItem.fromJson(menuItemRow(
              id: name, name: name, category: 'Завтраки', position: 0)),
      ];
      expect(
          groupMenuSections(items).single.items.map((i) => i.itemName), names);
    });

    test('цена: целая, с копейками, без цены', () {
      expect(formatMenuPrice(14), '14 BYN');
      expect(formatMenuPrice(14.5), '14,50 BYN');
      expect(formatMenuPrice(null), '—');
    });

    test('незнакомая пометка качества читается как «уточнить»', () {
      final item = PublicMenuItem.fromJson(
          menuItemRow(id: 'x', name: 'Компот', tier: 'something_new'));
      expect(item.needsCaution, isTrue);
      final clean = PublicMenuItem.fromJson(menuItemRow(id: 'y', name: 'Морс'));
      expect(clean.needsCaution, isFalse);
    });

    test('превью берёт первые позиции через границу разделов', () {
      final sections = groupMenuSections([
        for (final row in _items) PublicMenuItem.fromJson(row),
      ]);
      final preview = menuPreviewSections(sections, 5);
      expect(preview.map((s) => s.title), ['Супы', 'Горячее']);
      expect(preview.expand((s) => s.items).length, 5);
    });
  });
}
