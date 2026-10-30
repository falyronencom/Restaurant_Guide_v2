import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/widgets/booking_bottom_sheet.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Геолокация в тесте не нужна и канала у неё нет.
class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

/// Вход задаётся одним признаком: экран смотрит только на `isAuthenticated`.
class _Auth extends AuthProvider {
  _Auth({required this.signedIn});
  final bool signedIn;

  @override
  bool get isAuthenticated => signedIn;
}

/// Карточка заведения: при прокрутке текст страницы ехал под системную
/// строку и ложился на часы («6,9 км от вас» поверх часов, Galaxy A72,
/// 10.10.2026). Шапки у экрана нет — фото героя по макету уходит под часы.
///
/// Оракул — пиксели полосы системной строки на снимке экрана, не дерево
/// виджетов: «полоса есть» по дереву выполнялось бы и тогда, когда она
/// нарисована под содержимым.
void main() {
  const id = '11111111-1111-4111-8111-111111111111';
  const statusBar = 24; // dp = px при devicePixelRatio 1
  const width = 360;
  final shot = GlobalKey();
  // Координаты места: без них карточка не предлагает маршрут и не строит
  // мини-карту (платформенный вид).
  var withCoords = false;
  // Атрибуты карточки; null — ключ в ответе со значением null (по умолчанию).
  Map<String, dynamic>? attributes;

  setUp(() {
    withCoords = false;
    attributes = null;
    installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/search/establishments/$id') {
        final row = establishmentRow(
          id: id,
          attributes: attributes,
          workingHours: {
            for (final d in [
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday',
              'sunday',
            ])
              d: '10:00-22:00',
          },
        )
          // Без фото и без координат: сетевая картинка и карта Яндекса
          // в тесте не работают, герой рисует серую заглушку.
          ..['primary_image_url'] = null
          ..['latitude'] = withCoords ? 53.9023 : null
          ..['longitude'] = withCoords ? 27.5619 : null;
        return jsonBody({'success': true, 'data': row});
      }
      if (path == '/api/v1/establishments/$id/reviews') {
        return jsonBody(reviewsEnvelope(reviews: []));
      }
      if (path == '/api/v1/establishments/$id/booking-settings') {
        return jsonBody({
          'success': true,
          'data': {
            'is_enabled': true,
            'max_guests_per_booking': 6,
            'max_days_ahead': 7,
            'min_hours_before': 2,
            'confirmation_timeout_hours': 4,
          },
        });
      }
      return jsonBody({'success': false}, status: 404);
    });
  });

  Future<void> pumpDetail(
    WidgetTester tester, {
    bool signedIn = false,
    TargetPlatform platform = TargetPlatform.android,
    double inset = 24,
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(360, 800);
    tester.view.padding = FakeViewPadding(top: inset);
    tester.view.viewPadding = FakeViewPadding(top: inset);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(RepaintBoundary(
      key: shot,
      child: MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(
              create: (_) => _Auth(signedIn: signedIn)),
          ChangeNotifierProvider<EstablishmentsProvider>(
              create: (_) => _NoLocation()),
          ChangeNotifierProvider<BookingProvider>(
              create: (_) => BookingProvider()),
        ],
        child: MaterialApp(
          // Тема приложения — значит, настоящие шрифты (flutter_test_config).
          theme: AppTheme.lightTheme.copyWith(platform: platform),
          // Ленточка DEBUG лежит поверх всего в правом верхнем углу.
          debugShowCheckedModeBanner: false,
          home: const EstablishmentDetailScreen(establishmentId: id),
          routes: {
            '/auth/login': (_) => const Scaffold(body: Text('Экран входа')),
          },
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Васильки'), findsWidgets,
        reason: 'карточка не загрузилась');
  }

  /// Сколько пикселей полосы системной строки отличаются от фона экрана.
  Future<int> foreignPixelsUnderStatusBar(WidgetTester tester,
      {int rows = statusBar}) async {
    final boundary =
        shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    late ByteData bytes;
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 1);
      bytes = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
      image.dispose();
    });
    const bg = AppTheme.backgroundWarm;
    final r = (bg.r * 255).round(), g = (bg.g * 255).round();
    final b = (bg.b * 255).round();
    var foreign = 0;
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < width; x++) {
        final i = (y * width + x) * 4;
        final same = (bytes.getUint8(i) - r).abs() <= 2 &&
            (bytes.getUint8(i + 1) - g).abs() <= 2 &&
            (bytes.getUint8(i + 2) - b).abs() <= 2;
        if (!same) foreign++;
      }
    }
    return foreign;
  }

  Future<void> scrollTo(WidgetTester tester, double offset) async {
    final scrollable = find
        .descendant(
          of: find.byType(SingleChildScrollView),
          matching: find.byType(Scrollable),
        )
        .first;
    tester.state<ScrollableState>(scrollable).position.jumpTo(offset);
    await tester.pumpAndSettle();
  }

  // Высота строки — та, что даёт телефон: 24 у Android, 47 у iPhone с
  // «чёлкой». Одна высота не отличит полосу по отступу телефона от полосы
  // на 24 навсегда.
  for (final inset in [24, 47]) {
    testWidgets(
        'прокрученная страница не заходит под системную строку '
        '(строка $inset)', (tester) async {
      await pumpDetail(tester, inset: inset.toDouble());

      // 40 — кнопка «назад» у строки; 560 — низ героя с адресом и
      // расстоянием; 900 — описание и меню.
      final foreign = <double, int>{};
      for (final offset in [40.0, 560.0, 900.0]) {
        await scrollTo(tester, offset);
        foreign[offset] = await foreignPixelsUnderStatusBar(tester, rows: inset);
      }

      expect(foreign, {40.0: 0, 560.0: 0, 900.0: 0},
          reason: 'под часами видно содержимое страницы');
    });
  }

  testWidgets('вверху страницы фото героя по-прежнему уходит под часы',
      (tester) async {
    await pumpDetail(tester);

    // Серая заглушка фото, а не полоса фона: макет «во весь рост» сохранён.
    expect(await foreignPixelsUnderStatusBar(tester), statusBar * width);
  });

  testWidgets('iPhone: тап по строке состояния возвращает карточку наверх',
      (tester) async {
    // Своего контроллера прокрутки у страницы нет: Scaffold поднимает
    // наверх только основной контроллер маршрута, и с отдельным тап молчал.
    await pumpDetail(tester, platform: TargetPlatform.iOS);
    await scrollTo(tester, 900);

    await tester.tapAt(const Offset(180, 10));
    await tester.pumpAndSettle();

    final scrollable = find
        .descendant(
          of: find.byType(SingleChildScrollView),
          matching: find.byType(Scrollable),
        )
        .first;
    expect(tester.state<ScrollableState>(scrollable).position.pixels, 0);
  });

  group('«Хочу забронировать»', () {
    Future<void> tapBook(WidgetTester tester) async {
      final cta = find.text('Хочу забронировать');
      await tester.ensureVisible(cta);
      await tester.pumpAndSettle();
      await tester.tap(cta);
      await tester.pumpAndSettle();
    }

    testWidgets('без входа — просьба войти, форма не открывается',
        (tester) async {
      // Условия и время форма видит и без входа, а отправить бронь без
      // входа нельзя: гость заполнял форму и получал невнятную ошибку.
      await pumpDetail(tester);
      await tapBook(tester);

      expect(find.text('Чтобы забронировать столик, войдите в учётную запись.'),
          findsOneWidget);
      expect(find.byType(BookingBottomSheet), findsNothing);

      await tester.tap(find.text('Войти'));
      await tester.pumpAndSettle();
      expect(find.text('Экран входа'), findsOneWidget);
    });

    testWidgets('после входа — форма открывается', (tester) async {
      await pumpDetail(tester, signedIn: true);
      await tapBook(tester);

      expect(find.byType(BookingBottomSheet), findsOneWidget);
      expect(find.text('Чтобы забронировать столик, войдите в учётную запись.'),
          findsNothing);
    });
  });

  // Этап 3 (17.10.2026): выбор навигатора вынесен в общий код (его зовёт и
  // кнопка «Маршрут» на картах) — адресная шторка карточки прежняя.
  group('адресная шторка', () {
    Future<List<String>> openSheet(WidgetTester tester) async {
      await pumpDetail(tester);
      await tester.tap(find.text('пр. Независимости, 43').first);
      await tester.pumpAndSettle();
      return [
        for (final tile in tester.widgetList<ListTile>(find.byType(ListTile)))
          (tile.title! as Text).data!,
      ];
    }

    testWidgets('с координатами: два маршрута и «Скопировать адрес»',
        (tester) async {
      withCoords = true;
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(
          SystemChannels.platform_views, (_) async => null);
      addTearDown(() => messenger.setMockMethodCallHandler(
          SystemChannels.platform_views, null));

      expect(await openSheet(tester), [
        'Маршрут в Яндекс.Картах',
        'Маршрут в Google Картах',
        'Скопировать адрес',
      ]);
    });

    testWidgets('без координат: только «Скопировать адрес»', (tester) async {
      expect(await openSheet(tester), ['Скопировать адрес']);
    });

    testWidgets('кнопка «Как добраться» блока «Карта» открывает ту же шторку',
        (tester) async {
      // Тест выше открывает шторку тапом по адресу; кнопку блока, которую
      // экран подключает своим обработчиком, не нажимал никто.
      withCoords = true;
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(
          SystemChannels.platform_views, (_) async => null);
      addTearDown(() => messenger.setMockMethodCallHandler(
          SystemChannels.platform_views, null));
      await pumpDetail(tester);

      final route = find.text('Как добраться');
      await tester.ensureVisible(route);
      await tester.pumpAndSettle();
      await tester.tap(route);
      await tester.pumpAndSettle();

      expect([
        for (final tile in tester.widgetList<ListTile>(find.byType(ListTile)))
          (tile.title! as Text).data!,
      ], [
        'Маршрут в Яндекс.Картах',
        'Маршрут в Google Картах',
        'Скопировать адрес',
      ]);
    });

    testWidgets('без координат кнопки «Как добраться» нет — адрес остаётся',
        (tester) async {
      // Блок проверен своим тестом с готовым признаком; условие «есть
      // координаты» живёт в экране.
      await pumpDetail(tester);

      expect(find.text('Как добраться'), findsNothing);
      // Строка адреса самого блока «Карта» («адрес, город»), а не плашка
      // адреса на фото: блок без координат остаётся, теряет только кнопку.
      expect(find.text('пр. Независимости, 43, Минск'), findsOneWidget);
    });
  });

  // Раздел «Атрибуты» карточки: показывает только заявленное. Модельный тест
  // (`establishment_attributes_test`) проверяет помощника; подстановка же
  // умолчаний в 07.09 жила в самом экране, и экран не проверял никто.
  group('раздел «Атрибуты»', () {
    for (final (what, value) in <(String, Map<String, dynamic>?)>[
      ('нет вовсе (null)', null),
      ('пустые ({})', <String, dynamic>{}),
    ]) {
      testWidgets('атрибуты $what — раздела нет, ничего не дорисовано',
          (tester) async {
        attributes = value;
        await pumpDetail(tester);

        expect(find.text('Атрибуты'), findsNothing);
        for (final name in ['Доставка еды', 'Wi-Fi', 'Терраса']) {
          expect(find.text(name), findsNothing,
              reason: '«$name» не заявлено заведением');
        }
      });
    }

    testWidgets('заявленные атрибуты — раздел с ними, и только с ними',
        (tester) async {
      attributes = <String, dynamic>{'wifi': true, 'parking': true};
      await pumpDetail(tester);

      expect(find.text('Атрибуты'), findsOneWidget);
      expect(find.text('Wi-Fi'), findsOneWidget);
      expect(find.text('Парковка'), findsOneWidget);
      expect(find.text('Доставка еды'), findsNothing);
      expect(find.text('Терраса'), findsNothing);
    });
  });
}
