import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/favorites/favorites_screen.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_cover.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_map.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_view_mode.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Вход задаётся подменой одного признака: настоящий вход через хранилище
/// токенов здесь ни при чём, экран смотрит только на `isAuthenticated`.
class _Auth extends AuthProvider {
  _Auth({required this.signedIn});
  final bool signedIn;

  @override
  bool get isAuthenticated => signedIn;
}

Map<String, dynamic> _row(int i, {String city = 'Минск', double lat = 53.9}) {
  final row = favoriteRow(id: 'id-$i', name: 'Место $i');
  row['establishment_city'] = city;
  row['establishment_latitude'] = lat;
  row['establishment_average_rating'] = 3.0 + i / 100;
  // Без фото: плейсхолдер CachedNetworkImage — бесконечный спиннер, и
  // pumpAndSettle не дождался бы тишины.
  row['establishment_primary_image'] = null;
  return row;
}

Establishment _place(String name, String? price) => Establishment(
      id: name,
      name: name,
      category: 'Ресторан',
      priceRange: price,
      address: 'пр. Независимости, 43',
      city: 'Минск',
      status: 'active',
      createdAt: DateTime(2026, 10, 13),
      updatedAt: DateTime(2026, 10, 13),
    );

/// Чип сортировки — с повёрнутой иконкой; рядом может стоять «На карте».
final _sortChip = find.byWidgetPredicate(
    (w) => w is FavoritesCoverChip && w.rotateIcon,
    description: 'чип сортировки');
final _mapChip = find.widgetWithText(FavoritesCoverChip, 'На карте');
final _toggle = find.byType(FavoritesViewToggle);

/// Провайдер, который навсегда «грузит» избранное.
class _AlwaysLoading extends EstablishmentsProvider {
  @override
  bool get isFavoritesLoading => true;
}

List<String> _sortedNames(List<Establishment> places, SortOption sort) =>
    sortFavorites(places, sort, distanceKm: (_) => null)
        .map((e) => e.name)
        .toList();

/// «Избранное» после редизайна 29.09.2026: обложка вместо белого AppBar и
/// строки «Сортировка» (макет `2b`).
void main() {
  group('Счётчик мест', () {
    test('склонение по русскому правилу', () {
      expect(favoritePlacesCount(1), '1 место');
      expect(favoritePlacesCount(2), '2 места');
      expect(favoritePlacesCount(4), '4 места');
      expect(favoritePlacesCount(5), '5 мест');
      expect(favoritePlacesCount(11), '11 мест');
      expect(favoritePlacesCount(12), '12 мест');
      expect(favoritePlacesCount(14), '14 мест');
      expect(favoritePlacesCount(21), '21 место');
      expect(favoritePlacesCount(22), '22 места');
      expect(favoritePlacesCount(111), '111 мест');
    });

    test('город — только если он у всех мест один', () {
      expect(favoritesSubtitle(['Минск', 'Минск', 'Минск']), '3 места · Минск');
      expect(favoritesSubtitle(['Минск', 'Гродно']), '2 места',
          reason: 'подпись с одним городом была бы неправдой');
      expect(favoritesSubtitle(['Минск', null]), '2 места');
      expect(favoritesSubtitle([null]), '1 место');
    });
  });

  // «Избранное» сортирует телефон сам: правило сервера «без цены — в конце
  // при обоих направлениях» (стратегия §2.4, `NULLS LAST`) здесь повторено
  // своим кодом.
  group('Сортировка по цене', () {
    // Место без цены — посередине: порядок «как пришли» не сошёл бы за
    // верный ни в одном направлении.
    final places = [
      _place('Дорогое', r'$$$'),
      _place('Без цены', null),
      _place('Дешёвое', r'$'),
    ];

    test(r'«По цене ↑»: $ → $$$ → без цены', () {
      expect(_sortedNames(places, SortOption.priceAsc),
          ['Дешёвое', 'Дорогое', 'Без цены']);
    });

    test(r'«По цене ↓»: $$$ → $ → без цены', () {
      expect(_sortedNames(places, SortOption.priceDesc),
          ['Дорогое', 'Дешёвое', 'Без цены']);
    });

    test('пустая цена — то же, что её нет', () {
      final withEmpty = [
        _place('Без цены', null),
        _place('Среднее', r'$$'),
        _place('Пустая цена', ''),
      ];
      // Оба места без цены — в конце и в том порядке, в каком пришли.
      for (final sort in [SortOption.priceAsc, SortOption.priceDesc]) {
        expect(_sortedNames(withEmpty, sort),
            ['Среднее', 'Без цены', 'Пустая цена'],
            reason: sort.displayLabel);
      }
    });

    test('внутри яруса — порядок, в каком пришли, и в длинном списке', () {
      // 40 мест, а не 3: список до 33 Dart сортирует вставками, они равные
      // не переставляют, и короткий список не отличил бы ключ с индексом от
      // простого sort. Длиннее — быстрая сортировка, она порядок равных не
      // хранит.
      const prices = [r'$$', null, r'$', r'$$$'];
      final many = [
        for (var i = 0; i < 40; i++) _place('Место $i', prices[i % 4]),
      ];
      // Ожидание — по определению, а не повтором сортировки: ярусы по
      // очереди, внутри яруса места в порядке входа.
      List<String> byTiers(List<String?> order) => [
            for (final price in order)
              for (final e in many)
                if (e.priceRange == price) e.name,
          ];
      expect(_sortedNames(many, SortOption.priceAsc),
          byTiers([r'$', r'$$', r'$$$', null]),
          reason: SortOption.priceAsc.displayLabel);
      expect(_sortedNames(many, SortOption.priceDesc),
          byTiers([r'$$$', r'$$', r'$', null]),
          reason: SortOption.priceDesc.displayLabel);
    });
  });

  group('Экран', () {
    late Map<String, dynamic> Function() envelope;
    late StubAdapter wire;
    late int status;

    setUp(() {
      envelope = () => favoritesEnvelope(favorites: []);
      status = 200;
      wire = installWireStand((_) => jsonBody(envelope(), status: status));
      SharedPreferences.setMockInitialValues({});
      // Карта — платформенный вид: здесь она не рождается, строится только
      // виджет.
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(
          SystemChannels.platform_views, (_) async => null);
      addTearDown(() => messenger.setMockMethodCallHandler(
          SystemChannels.platform_views, null));
    });

    /// [visible] — признак видимости вкладки (TickerMode, как в
    /// main_navigation).
    Future<EstablishmentsProvider> pump(
      WidgetTester tester, {
      required bool signedIn,
      EstablishmentsProvider? provider,
      ValueNotifier<bool>? visible,
      bool settle = true,
    }) async {
      final establishments = provider ?? EstablishmentsProvider();
      final shown = visible ?? ValueNotifier(true);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(
              create: (_) => _Auth(signedIn: signedIn)),
          ChangeNotifierProvider.value(value: establishments),
        ],
        child: MaterialApp(
          home: ValueListenableBuilder<bool>(
            valueListenable: shown,
            builder: (context, enabled, child) =>
                TickerMode(enabled: enabled, child: child!),
            child: const FavoritesScreen(),
          ),
        ),
      ));
      if (settle) {
        await tester.pumpAndSettle();
      } else {
        await tester.pump();
        await tester.pump();
      }
      return establishments;
    }

    testWidgets('гость: обложка, приглашение войти, чипа сортировки нет',
        (tester) async {
      await pump(tester, signedIn: false);

      expect(find.byType(AppBar), findsNothing,
          reason: 'белый AppBar заменён обложкой');
      expect(find.byType(FavoritesCover), findsOneWidget);
      expect(find.text('Избранное'), findsOneWidget);
      expect(find.text('Здесь будут ваши места'), findsOneWidget);
      expect(find.text('Войти'), findsOneWidget);
      expect(find.byType(FavoritesCoverChip), findsNothing,
          reason: 'сортировать нечего');
    });

    testWidgets('пусто у вошедшего: обложка есть, чипа нет', (tester) async {
      await pump(tester, signedIn: true);

      expect(find.byType(FavoritesCover), findsOneWidget);
      expect(find.text('Здесь будут ваши места'), findsOneWidget);
      expect(find.text('Войти'), findsNothing);
      expect(find.byType(FavoritesCoverChip), findsNothing);
    });

    testWidgets(
        'список: счётчик в обложке, чип называет порядок, '
        '«Результаты» больше нет', (tester) async {
      envelope = () =>
          favoritesEnvelope(favorites: [for (var i = 0; i < 12; i++) _row(i)]);
      await pump(tester, signedIn: true);

      expect(find.text('12 мест · Минск'), findsOneWidget);
      expect(find.text('По рейтингу'), findsOneWidget);
      expect(find.textContaining('Результаты'), findsNothing);
      expect(find.byType(EstablishmentCard), findsWidgets);
    });

    testWidgets('выбор сортировки меняет подпись чипа', (tester) async {
      envelope = () =>
          favoritesEnvelope(favorites: [for (var i = 0; i < 3; i++) _row(i)]);
      await pump(tester, signedIn: true);

      await tester.tap(_sortChip);
      await tester.pumpAndSettle();
      await tester.tap(find.text('По цене ↑'));
      await tester.pumpAndSettle();

      expect(find.text('По цене ↑'), findsOneWidget);
      expect(find.text('По рейтингу'), findsNothing);
    });

    testWidgets('чип: видимая плашка 34, зона тапа 44', (tester) async {
      envelope = () => favoritesEnvelope(favorites: [_row(0)]);
      await pump(tester, signedIn: true);

      final tap = tester.getRect(_sortChip);
      final plate = tester.getRect(find.descendant(
        of: _sortChip,
        matching: find.byType(Container),
      ));
      // Числа из макета литералами: константа экрана согласилась бы сама с
      // собой при любом значении.
      expect(plate.height, 34);
      expect(tap.height, 44);
    });

    testWidgets('при скролле обложка сжимается до компактной и чип уходит',
        (tester) async {
      envelope = () =>
          favoritesEnvelope(favorites: [for (var i = 0; i < 12; i++) _row(i)]);
      await pump(tester, signedIn: true);

      expect(tester.getRect(find.byType(FavoritesCover)).height,
          FavoritesCover.expandedBodyHeight);

      await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
      await tester.pumpAndSettle();

      expect(tester.getRect(find.byType(FavoritesCover)).height,
          FavoritesCover.collapsedBodyHeight,
          reason: 'обложка прижата к верху компактной');
      expect(find.byType(FavoritesCoverChip), findsNothing);
      expect(find.text('Избранное'), findsOneWidget);
    });

    group('со статус-баром', () {
      // Окно по умолчанию — без отступа сверху, и высоты обложки совпали бы
      // с голыми 163/93 при любой ошибке в учёте статус-бара.
      const statusBar = 47.0;

      void withStatusBar(WidgetTester tester) {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        tester.view.padding = const FakeViewPadding(top: statusBar);
        addTearDown(tester.view.reset);
      }

      testWidgets('обложка уходит под статус-бар: 47 + 163, сжатая 47 + 93',
          (tester) async {
        withStatusBar(tester);
        envelope = () => favoritesEnvelope(
            favorites: [for (var i = 0; i < 12; i++) _row(i)]);
        await pump(tester, signedIn: true);

        final full = tester.getRect(find.byType(FavoritesCover));
        expect(full.top, 0);
        expect(full.height, statusBar + 163);

        await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
        await tester.pumpAndSettle();
        expect(tester.getRect(find.byType(FavoritesCover)).height,
            statusBar + 93);
      });

      testWidgets('пустой экран вошедшего не прокручивается сам по себе',
          (tester) async {
        withStatusBar(tester);
        await pump(tester, signedIn: true);

        final scrollable = tester.state<ScrollableState>(find.descendant(
          of: find.byType(ListView),
          matching: find.byType(Scrollable),
        ));
        expect(scrollable.position.maxScrollExtent, 0,
            reason: 'ListView прибавил отступ статус-бара — сердце съехало');
      });

      // Список при ×2 целиком — тест ниже. Обложка проверяется отдельно:
      // до 29.09.2026 при ×2 переполнялась сама карточка заведения, и её
      // ошибка раскладки заслоняла проверку обложки.
      for (final collapse in [0.0, 1.0]) {
        testWidgets(
            'крупный системный шрифт не загоняет заголовок под статус-бар '
            '(сжатие $collapse)', (tester) async {
          withStatusBar(tester);
          final body = collapse == 0
              ? FavoritesCover.expandedBodyHeight
              : FavoritesCover.collapsedBodyHeight;
          await tester.pumpWidget(MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(
                textScaler: TextScaler.linear(2.0),
                padding: EdgeInsets.only(top: statusBar),
              ),
              child: Align(
                alignment: Alignment.topCenter,
                child: SizedBox(
                  height: statusBar + body,
                  child: FavoritesCover(
                    topInset: statusBar,
                    collapse: collapse,
                    subtitle: '12 мест · Минск',
                    sortLabel: 'По рейтингу',
                    onSortTap: () {},
                  ),
                ),
              ),
            ),
          ));

          expect(tester.getRect(find.text('Избранное')).top,
              greaterThanOrEqualTo(statusBar));
        });
      }

      // Сценарий дефекта 29.09.2026: при системном шрифте ×2 карточка
      // заведения давала «RenderFlex overflowed by 130 pixels on the bottom».
      // 130 — число этой обвязки: она без темы приложения, и текст без
      // семейства меряется подставным шрифтом; проверка — только «без
      // ошибок». Масштаб задаётся через платформу — тем же путём, что на
      // телефоне.
      testWidgets('системный шрифт ×2: список без ошибок раскладки',
          (tester) async {
        withStatusBar(tester);
        tester.platformDispatcher.textScaleFactorTestValue = 2.0;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        envelope = () => favoritesEnvelope(
            favorites: [for (var i = 0; i < 3; i++) _row(i)]);
        await pump(tester, signedIn: true);

        expect(find.byType(EstablishmentCard), findsWidgets);
        expect(tester.takeException(), isNull);
      });
    });

    testWidgets(
        '«По расстоянию» сортирует по расстоянию, без координат — '
        'в конце', (tester) async {
      // Пользователь на широте 53.90; рейтинг задан обратным расстоянию,
      // чтобы порядок «по рейтингу» и «по расстоянию» различался.
      envelope = () => favoritesEnvelope(favorites: [
            _row(90, lat: 53.95)..['establishment_name'] = 'Дальнее',
            _row(50, lat: 53.91)..['establishment_name'] = 'Ближнее',
            (_row(99)
              ..['establishment_name'] = 'Без координат'
              ..['establishment_latitude'] = null),
            (_row(10)
              ..['establishment_name'] = 'Без координат 2'
              ..['establishment_latitude'] = null),
          ]);
      // Окно выше трёх карточек (291 каждая): строятся все, иначе порядок
      // проверялся бы только у видимых.
      tester.view.physicalSize = const Size(800, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final provider = await pump(tester, signedIn: true);
      provider.setUserLocation(53.90, 27.5619);
      await tester.pumpAndSettle();

      await tester.tap(_sortChip);
      await tester.pumpAndSettle();
      await tester.tap(find.text('По расстоянию'));
      await tester.pumpAndSettle();

      final names = tester
          .widgetList<EstablishmentCard>(find.byType(EstablishmentCard))
          .map((c) => c.establishment.name)
          .toList();
      // Места без расстояния — в конце и в порядке, в котором пришли
      // (рейтинг «Без координат 2» ниже, но по рейтингу здесь не сортируют).
      expect(names, ['Ближнее', 'Дальнее', 'Без координат', 'Без координат 2']);
    });

    // Этап 3 (17.10.2026): второй режим — «На карте» (макет `3a`).
    group('Списком / На карте', () {
      const statusBar = 47.0;
      const screen = Size(390, 844);

      void withStatusBar(WidgetTester tester) {
        tester.view.physicalSize = screen;
        tester.view.devicePixelRatio = 1;
        tester.view.padding = const FakeViewPadding(top: statusBar);
        addTearDown(tester.view.reset);
      }

      List<Map<String, dynamic>> rows(int n) =>
          [for (var i = 0; i < n; i++) _row(i)];

      Future<String?> savedMode() async =>
          (await SharedPreferences.getInstance())
              .getString(FavoritesViewModeStore.key);

      double fontSizeOf(WidgetTester tester, String text) => tester
          .renderObject<RenderParagraph>(find.text(text))
          .text
          .style!
          .fontSize!;

      testWidgets('чип «На карте» с иконкой карты — рядом с сортировкой, '
          'через 8', (tester) async {
        envelope = () => favoritesEnvelope(favorites: rows(3));
        await pump(tester, signedIn: true);

        final sort = tester.getRect(_sortChip);
        final map = tester.getRect(_mapChip);
        expect(map.left, sort.right + 8);
        expect(map.center.dy, sort.center.dy);
        expect(
            find.descendant(of: _mapChip, matching: find.byIcon(Icons.map)),
            findsOneWidget);
      });

      testWidgets(
          '«На карте» → компактная обложка 47 + 93 с тумблером и карта до '
          'низа; «Списком» → полная обложка и список', (tester) async {
        withStatusBar(tester);
        envelope = () => favoritesEnvelope(favorites: rows(12));
        await pump(tester, signedIn: true);

        await tester.tap(_mapChip);
        await tester.pumpAndSettle();

        final cover = tester.getRect(find.byType(FavoritesCover));
        expect(cover.top, 0);
        expect(cover.height, statusBar + 93);
        expect(_toggle, findsOneWidget);
        expect(find.byType(FavoritesMap), findsOneWidget);
        expect(find.byType(EstablishmentCard), findsNothing);
        expect(find.byType(FavoritesCoverChip), findsNothing);
        final map = tester.getRect(find.byType(FavoritesMap));
        expect(map.top, cover.bottom, reason: 'карта стыкуется с обложкой');
        expect(map.bottom, screen.height);
        // Компактная обложка: заголовок 22, подпись 13, угол без скругления.
        expect(fontSizeOf(tester, 'Избранное'), 22);
        expect(fontSizeOf(tester, '12 мест · Минск'), 13);
        final clip = tester.widget<ClipRRect>(find
            .descendant(
                of: find.byType(FavoritesCover),
                matching: find.byType(ClipRRect))
            .first);
        expect(clip.borderRadius,
            const BorderRadius.only(bottomLeft: Radius.circular(0)));

        await tester.tap(find.text('Списком'));
        await tester.pumpAndSettle();

        expect(tester.getRect(find.byType(FavoritesCover)).height,
            statusBar + 163);
        expect(find.byType(EstablishmentCard), findsWidgets);
        expect(find.byType(FavoritesMap), findsNothing);
        expect(_toggle, findsNothing);
        expect(_mapChip, findsOneWidget);
      });

      testWidgets(
          'тумблер: зона нажатия сегмента на 3 выше и ниже плашки; активный '
          '— белый с тёмной подписью', (tester) async {
        envelope = () => favoritesEnvelope(favorites: rows(3));
        await pump(tester, signedIn: true);
        await tester.tap(_mapChip);
        await tester.pumpAndSettle();

        final plate = tester.getRect(find
            .descendant(of: _toggle, matching: find.byType(DecoratedBox))
            .first);
        final listTap = tester.getRect(find
            .ancestor(
                of: find.text('Списком'),
                matching: find.byType(GestureDetector))
            .first);
        expect(listTap.top, plate.top - 3);
        expect(listTap.bottom, plate.bottom + 3);

        Color? colorOf(String label) => tester
            .renderObject<RenderParagraph>(find.text(label))
            .text
            .style!
            .color;
        expect(colorOf('На карте'), const Color(0xFF3E3E3E));
        expect(colorOf('Списком'), Colors.white.withValues(alpha: 0.85));

        // «Активный — белый»: плашка сегмента, а не только подпись.
        Decoration? plateOf(String label) => tester
            .widget<Container>(find
                .ancestor(of: find.text(label), matching: find.byType(Container))
                .first)
            .decoration;
        expect((plateOf('На карте') as BoxDecoration?)?.color,
            const Color(0xFFFFFFFF),
            reason: 'активный сегмент — на белой плашке');
        expect(plateOf('Списком'), isNull,
            reason: 'у неактивного плашки нет');
      });

      testWidgets(
          'выбор режима запоминается: новый экран открывается так, как ушли',
          (tester) async {
        envelope = () => favoritesEnvelope(favorites: rows(3));
        await pump(tester, signedIn: true);

        await tester.tap(_mapChip);
        await tester.pumpAndSettle();
        expect(await savedMode(), 'map');

        // Экран закрыт и открыт заново (перезапуск приложения).
        await tester.pumpWidget(const SizedBox());
        await pump(tester, signedIn: true);
        expect(find.byType(FavoritesMap), findsOneWidget);
        expect(_toggle, findsOneWidget);

        await tester.tap(find.text('Списком'));
        await tester.pumpAndSettle();
        expect(await savedMode(), 'list');
        await tester.pumpWidget(const SizedBox());
        await pump(tester, signedIn: true);
        expect(find.byType(FavoritesMap), findsNothing);
        expect(find.byType(EstablishmentCard), findsWidgets);
      });

      testWidgets('ничего не запомнено — список', (tester) async {
        envelope = () => favoritesEnvelope(favorites: rows(3));
        await pump(tester, signedIn: true);
        expect(find.byType(FavoritesMap), findsNothing);
        expect(_mapChip, findsOneWidget);
      });

      for (final signedIn in [true, false]) {
        testWidgets(
            '${signedIn ? 'пусто у вошедшего' : 'гость'}: чипа «На карте» '
            'нет; запомненная карта — пустое состояние под полной обложкой',
            (tester) async {
          SharedPreferences.setMockInitialValues(
              {FavoritesViewModeStore.key: 'map'});
          await pump(tester, signedIn: signedIn);

          expect(find.text('Здесь будут ваши места'), findsOneWidget);
          expect(find.byType(FavoritesCoverChip), findsNothing);
          expect(_toggle, findsNothing);
          expect(find.byType(FavoritesMap), findsNothing);
          expect(tester.getRect(find.byType(FavoritesCover)).height,
              FavoritesCover.expandedBodyHeight);
        });
      }

      testWidgets(
          'на карте убрали все места — пустое состояние списком, карты нет',
          (tester) async {
        envelope = () => favoritesEnvelope(favorites: rows(2));
        final provider = await pump(tester, signedIn: true);
        await tester.tap(_mapChip);
        await tester.pumpAndSettle();
        expect(find.byType(FavoritesMap), findsOneWidget);

        envelope = () => favoritesEnvelope(favorites: []);
        // Без await: ответ стенда приходит по часам теста, их крутит pump.
        provider.refreshFavorites();
        await tester.pumpAndSettle();

        expect(find.text('Здесь будут ваши места'), findsOneWidget);
        expect(find.byType(FavoritesMap), findsNothing);
        expect(_toggle, findsNothing);
      });

      testWidgets(
          'загрузка в режиме карты — под компактной обложкой с тумблером',
          (tester) async {
        SharedPreferences.setMockInitialValues(
            {FavoritesViewModeStore.key: 'map'});
        await pump(tester,
            signedIn: true, provider: _AlwaysLoading(), settle: false);

        expect(find.byType(CircularProgressIndicator), findsOneWidget);
        expect(_toggle, findsOneWidget);
        expect(tester.getRect(find.byType(FavoritesCover)).height,
            FavoritesCover.collapsedBodyHeight);
        // Запрос избранного, начатый экраном, доходит до конца.
        await tester.pump(const Duration(seconds: 1));
      });

      testWidgets(
          'ошибка в режиме карты — под компактной обложкой с тумблером',
          (tester) async {
        SharedPreferences.setMockInitialValues(
            {FavoritesViewModeStore.key: 'map'});
        status = 500;
        envelope = () => {'success': false};
        await pump(tester, signedIn: true);

        expect(find.text('Ошибка загрузки'), findsOneWidget);
        expect(find.text('Повторить'), findsOneWidget);
        expect(_toggle, findsOneWidget);
        expect(tester.getRect(find.byType(FavoritesCover)).height,
            FavoritesCover.collapsedBodyHeight);
      });

      testWidgets(
          'стенд сети: вход в карту и переключения — ни одного запроса',
          (tester) async {
        envelope = () => favoritesEnvelope(favorites: rows(3));
        await pump(tester, signedIn: true);
        final before = wire.requests.length;
        expect(before, greaterThan(0),
            reason: 'предпосылка: избранное пришло через этот стенд');

        await tester.tap(_mapChip);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Списком'));
        await tester.pumpAndSettle();
        await tester.tap(_mapChip);
        await tester.pumpAndSettle();

        expect(find.byType(FavoritesMap), findsOneWidget);
        expect(wire.requests.length, before,
            reason: wire.requests.skip(before).map((r) => r.path).join(', '));
      });

      testWidgets(
          'вкладку не видно — нативной карты нет; снова видно — новая карта',
          (tester) async {
        SharedPreferences.setMockInitialValues(
            {FavoritesViewModeStore.key: 'map'});
        envelope = () => favoritesEnvelope(favorites: rows(3));
        final visible = ValueNotifier(true);
        await pump(tester, signedIn: true, visible: visible);
        final first = tester.state(find.byType(FavoritesMap));

        visible.value = false;
        await tester.pump();
        expect(find.byType(FavoritesMap), findsNothing);
        expect(_toggle, findsOneWidget, reason: 'режим остаётся картой');

        visible.value = true;
        await tester.pump();
        expect(find.byType(FavoritesMap), findsOneWidget);
        expect(
            identical(tester.state(find.byType(FavoritesMap)), first), isFalse,
            reason: 'новая карта — камера снова охватывает все места');
      });

      testWidgets(
          'поверх вкладки открыт другой экран (карточка заведения) — карты '
          'нет; вернулись — карта снова', (tester) async {
        SharedPreferences.setMockInitialValues(
            {FavoritesViewModeStore.key: 'map'});
        envelope = () => favoritesEnvelope(favorites: rows(3));
        await pump(tester, signedIn: true);
        expect(find.byType(FavoritesMap), findsOneWidget);

        final navigator = tester.state<NavigatorState>(find.byType(Navigator));
        navigator.push(MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Карточка заведения'))));
        await tester.pumpAndSettle();
        expect(find.byType(FavoritesMap, skipOffstage: false), findsNothing);

        navigator.pop();
        await tester.pumpAndSettle();
        expect(find.byType(FavoritesMap), findsOneWidget);
      });

      // Крупный системный шрифт: обложка ограничивает его ×1,3, поэтому ×2
      // проверяет то же, что ×1,3. Подписи чипов и тумблера ширину не
      // ограничивают (ряд чипов в FittedBox, тумблер — негибкий сосед):
      // переполнение ловит takeException, экранный край — getRect, который
      // учитывает сжатие.

      Future<void> pumpCover(WidgetTester tester, double width, double scale,
          FavoritesCover cover, double bodyHeight) async {
        tester.view.physicalSize = Size(width, 844);
        tester.view.devicePixelRatio = 1;
        tester.view.padding = const FakeViewPadding(top: statusBar);
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await tester.pumpWidget(MaterialApp(
          home: Align(
            alignment: Alignment.topCenter,
            child: SizedBox(height: statusBar + bodyHeight, child: cover),
          ),
        ));
      }

      for (final width in [320.0, 360.0, 390.0]) {
        for (final scale in [1.2, 2.0]) {
          testWidgets(
              'шрифт ×$scale, ширина ${width.toInt()}: оба чипа целиком',
              (tester) async {
            await pumpCover(
              tester,
              width,
              scale,
              FavoritesCover(
                topInset: statusBar,
                subtitle: '12 мест · Минск',
                sortLabel: 'По расстоянию',
                onSortTap: () {},
                onMapTap: () {},
              ),
              FavoritesCover.expandedBodyHeight,
            );
            expect(tester.takeException(), isNull);
            expect(
                tester.getRect(_mapChip).right, lessThanOrEqualTo(width - 16));
          });

          testWidgets(
              'шрифт ×$scale, ширина ${width.toInt()}: тумблер целиком, '
              'заголовок с ним не сталкивается', (tester) async {
            await pumpCover(
              tester,
              width,
              scale,
              FavoritesCover(
                topInset: statusBar,
                collapse: 1,
                subtitle: '12 мест · Минск',
                trailing: FavoritesViewToggle(
                  mode: FavoritesViewMode.map,
                  onChanged: (_) {},
                ),
              ),
              FavoritesCover.collapsedBodyHeight,
            );
            expect(tester.takeException(), isNull);
            final toggle = tester.getRect(_toggle);
            expect(toggle.right, lessThanOrEqualTo(width - 16));
            expect(toggle.top, greaterThanOrEqualTo(statusBar));
            // Заголовок ужимается, а не уходит под тумблер: рамка текста —
            // с учётом сжатия (getRect переводит углы в экранные)...
            final title = tester.getRect(find.text('Избранное'));
            expect(title.right, lessThanOrEqualTo(toggle.left - 12));
            // ...и не обрезан: текст получил всю ширину, какую хочет. Без
            // ужатия одна строка заголовка молча режется по краю места.
            final paragraph =
                tester.renderObject<RenderParagraph>(find.text('Избранное'));
            expect(paragraph.size.width,
                greaterThanOrEqualTo(
                    paragraph.getMaxIntrinsicWidth(double.infinity) - 0.01),
                reason: 'заголовок обрезан');
            expect(tester.getRect(find.text('Избранное')).top,
                greaterThanOrEqualTo(statusBar));
          });
        }
      }
    });
  });
}
