import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/favorites/favorites_screen.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_cover.dart';

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

  group('Экран', () {
    late Map<String, dynamic> Function() envelope;

    setUp(() {
      envelope = () => favoritesEnvelope(favorites: []);
      installWireStand((_) => jsonBody(envelope()));
    });

    Future<EstablishmentsProvider> pump(
      WidgetTester tester, {
      required bool signedIn,
    }) async {
      final establishments = EstablishmentsProvider();
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(
              create: (_) => _Auth(signedIn: signedIn)),
          ChangeNotifierProvider.value(value: establishments),
        ],
        child: const MaterialApp(home: FavoritesScreen()),
      ));
      await tester.pumpAndSettle();
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

      await tester.tap(find.byType(FavoritesCoverChip));
      await tester.pumpAndSettle();
      await tester.tap(find.text('По цене ↑'));
      await tester.pumpAndSettle();

      expect(find.text('По цене ↑'), findsOneWidget);
      expect(find.text('По рейтингу'), findsNothing);
    });

    testWidgets('чип: видимая плашка 34, зона тапа 44', (tester) async {
      envelope = () => favoritesEnvelope(favorites: [_row(0)]);
      await pump(tester, signedIn: true);

      final tap = tester.getRect(find.byType(FavoritesCoverChip));
      final plate = tester.getRect(find.descendant(
        of: find.byType(FavoritesCoverChip),
        matching: find.byType(Container),
      ));
      expect(plate.height, FavoritesCoverChip.visibleHeight);
      expect(tap.height, FavoritesCoverChip.minTapHeight);
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
        expect(full.height, statusBar + FavoritesCover.expandedBodyHeight);

        await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
        await tester.pumpAndSettle();
        expect(tester.getRect(find.byType(FavoritesCover)).height,
            statusBar + FavoritesCover.collapsedBodyHeight);
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

      await tester.tap(find.byType(FavoritesCoverChip));
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
  });
}
