import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Список и карточка одного места говорят одно и то же.
///
/// Находки 18.10.2026 на телефоне Координатора (сравнение с Resty, сборка с
/// `main`): у VARKA (Новая Боровая) в списке «{Авторская}», «0,0» зелёным
/// значком и «$», в карточке того же места — «{авторская}», «0.0» и «$$».
/// Сервер в обоих местах отдаёт одно: `cuisines: ["Авторская"]`,
/// `average_rating: 0`, `review_count: 0`, `price_range: "$"` (прод, поиск и
/// карточка, 18.10).
///
/// Ожидания — из брифа, литералами: кухня без скобок; у места без отзывов —
/// никакого числа; у места с оценкой — одна запись с русской запятой; цена —
/// как на сервере, одна и та же в списке и в карточке.
///
/// Строка заведения идёт по проводу (стенд транспорта) — так карточка берёт
/// её тем же путём, что на телефоне; список строит карточку из той же строки.

const _id = '33333333-3333-4333-8333-333333333333';

const _weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/// Место как VARKA (Новая Боровая) на проде 18.10: отзывов нет, цена «$».
Map<String, dynamic> _unrated() => _row(
      name: 'VARKA (Новая Боровая)',
      category: 'Кофейня',
      cuisines: const ['Авторская'],
      price: r'$',
      rating: 0,
      reviews: 0,
    );

/// Место с оценкой и самой высокой ценой; кухонь две — первая главная.
Map<String, dynamic> _rated() => _row(
      name: 'Васильки',
      category: 'Ресторан',
      cuisines: const ['Европейская', 'Итальянская'],
      price: r'$$$',
      rating: 4.5,
      reviews: 12,
    );

Map<String, dynamic> _row({
  required String name,
  required String category,
  required List<String> cuisines,
  required String price,
  required num rating,
  required int reviews,
}) =>
    establishmentRow(
      id: _id,
      name: name,
      categories: [category],
      cuisines: cuisines,
      // Круглосуточно: «Открыто» не зависит от часов машины.
      workingHours: {for (final d in _weekdays) d: '00:00-00:00'},
    )
      ..['price_range'] = price
      ..['average_rating'] = rating
      ..['review_count'] = reviews
      // Сетевая картинка и карта Яндекса в тесте не работают.
      ..['primary_image_url'] = null
      ..['latitude'] = null
      ..['longitude'] = null;

class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

class _Guest extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

/// Всё, что нарисовано текстом, — построчно.
List<String> _texts(WidgetTester tester) => tester
    .widgetList<RichText>(find.byType(RichText))
    .map((w) => w.text.toPlainText())
    .toList();

/// Текст, похожий на оценку: «0,0», «0.0», «4.5», «4,5».
final _ratingLike = RegExp(r'^\d[.,]\d$');

Future<void> _pumpListCard(
    WidgetTester tester, Map<String, dynamic> row) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = const Size(390, 844);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    home: Scaffold(
      body: ListView(children: [
        EstablishmentCard(establishment: Establishment.fromJson(row)),
      ]),
    ),
  ));
  await tester.pump();
}

Future<void> _pumpDetail(
  WidgetTester tester,
  Map<String, dynamic> row, {
  Size screen = const Size(390, 900),
}) async {
  installWireStand((options) {
    final path = options.uri.path;
    if (path == '/api/v1/search/establishments/$_id') {
      return jsonBody({'success': true, 'data': row});
    }
    if (path == '/api/v1/establishments/$_id/reviews') {
      return jsonBody(reviewsEnvelope(reviews: const [], total: 0));
    }
    return jsonBody({'success': false}, status: 404);
  });
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = screen;
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
      home: const EstablishmentDetailScreen(establishmentId: _id),
    ),
  ));
  await tester.pumpAndSettle();
  // Предпосылка: карточка открылась, а не застряла на загрузке или ошибке.
  expect(find.text(row['name'] as String), findsOneWidget);
}

void main() {
  group('Место без отзывов (VARKA, прод 18.10)', () {
    testWidgets('список: кухня без скобок, числа оценки нет, цена «\$»',
        (tester) async {
      await _pumpListCard(tester, _unrated());
      final texts = _texts(tester);

      expect(find.text('Авторская'), findsOneWidget);
      expect(texts.where((t) => t.contains('{') || t.contains('}')), isEmpty,
          reason: 'кухня в фигурных скобках');
      expect(texts.where(_ratingLike.hasMatch), isEmpty,
          reason: 'у места без отзывов не должно быть числа оценки');
      expect(find.text(r'$'), findsOneWidget);
    });

    testWidgets('карточка: кухня без скобок, числа оценки нет, цена «\$» — '
        'как в списке', (tester) async {
      await _pumpDetail(tester, _unrated());
      final texts = _texts(tester);

      expect(find.text('авторская'), findsOneWidget,
          reason: 'кухня под типом, строчными — как тип «кофейня»');
      expect(texts.where((t) => t.contains('{') || t.contains('}')), isEmpty,
          reason: 'кухня в фигурных скобках');
      expect(texts.where(_ratingLike.hasMatch), isEmpty,
          reason: 'у места без отзывов не должно быть числа оценки');
      expect(find.text('—'), findsNothing,
          reason: 'и прочерка вместо оценки тоже');
      expect(find.text(r'$'), findsOneWidget,
          reason: 'цена — как на сервере и в списке');
      expect(find.text(r'$$'), findsNothing);
    });
  });

  testWidgets(
      'список: без оценки (0 или поле не пришло) цена стоит там же, где у '
      'места с оценкой', (tester) async {
    // Зелёного квадрата нет, но его место остаётся: цена — под ним, на одной
    // вертикали с сердечком, и раскладка верха карточки (замер 30.09) у мест
    // с оценкой и без одна.
    Future<Rect> priceAt(num? rating) async {
      final row = _row(
        name: 'Васильки',
        category: 'Ресторан',
        cuisines: const ['Европейская'],
        price: r'$$',
        rating: rating ?? 0,
        reviews: rating == null || rating == 0 ? 0 : 12,
      );
      if (rating == null) row.remove('average_rating');
      await _pumpListCard(tester, row);
      return tester.getRect(find.text(r'$$'));
    }

    final rated = await priceAt(4.5);
    expect(await priceAt(0), rated, reason: 'средняя 0 — оценок нет');
    expect(await priceAt(null), rated, reason: 'поле оценки не пришло');
  });

  group('Место с оценкой', () {
    testWidgets('список: «4,5», главная кухня, «\$\$\$»', (tester) async {
      await _pumpListCard(tester, _rated());

      expect(find.text('4,5'), findsOneWidget);
      expect(find.text('Европейская'), findsOneWidget);
      expect(find.text(r'$$$'), findsOneWidget);
    });

    testWidgets('карточка: та же оценка «4,5» и та же цена «\$\$\$»',
        (tester) async {
      await _pumpDetail(tester, _rated());

      expect(find.text('4,5'), findsOneWidget,
          reason: 'один разделитель — русская запятая, как в списке');
      expect(find.text('4.5'), findsNothing);
      expect(find.text(r'$$$'), findsOneWidget,
          reason: 'цена — как на сервере и в списке');
      expect(find.text(r'$$'), findsNothing);
      expect(find.text('европейская'), findsOneWidget);
    });

    testWidgets('карточка, крупный шрифт ×2: цена «\$\$\$» в одну строку',
        (tester) async {
      // Колонка оценки и цены не уже квадрата (50 dp), но и не уже цены: при
      // крупном шрифте «$$$» шире квадрата и раньше расширяла колонку, а не
      // переносилась (ревью 18.10.2026). Экран широкий: при ×2 на 390 dp
      // переполняются другие строки карточки ниже героя — это не про цену и
      // было до этой правки.
      tester.platformDispatcher.textScaleFactorTestValue = 2.0;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await _pumpDetail(tester, _rated(), screen: const Size(900, 1400));

      final price = tester.renderObject<RenderParagraph>(find.text(r'$$$'));
      expect(price.getMaxIntrinsicWidth(double.infinity),
          lessThanOrEqualTo(price.size.width + 0.01),
          reason: 'цена переносится — колонка уже цены');
    });
  });
}
