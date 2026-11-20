// Та же медленная тень, что была у карточки выдачи (PR #218), стояла ещё в
// трёх местах: плитки ленты фото меню и мини-карта на странице заведения и та
// же лента в предпросмотре у партнёра. У них углы разные, и размытую тень
// такого прямоугольника движок считал заново на каждом кадре прокрутки.
// Теперь они рисуются подложкой FastSoftShadowDecoration — быстрым способом.
//
// Здесь стережётся:
//  - вид не изменился: по точкам сверяется ВЕСЬ узел — подложка с тенью и
//    обрезанное по тем же углам содержимое (у плиток фото своей заливки нет,
//    тень под фото видна там, где фото прозрачно; у мини-карты под тенью —
//    серая заливка и карта);
//  - на обоих экранах эти узлы — на быстрой подложке с прежними углами и
//    тенями, а размытых теней с разными углами на экране нет.
//
// Цвета, тени и размеры — литералами: проверка с константой согласилась бы с
// любой её правкой.

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/establishment_preview_screen.dart';
import 'package:restaurant_guide_mobile/widgets/fast_soft_shadow.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

const _white = Color(0xFFFFFFFF);
const _grey200 = Color(0xFFEEEEEE);
const _grey300 = Color(0xFFE0E0E0);

/// Тень плиток и мини-карты: тёмно-рыжая с прозрачностью 0,04.
final _shadowColor = const Color(0xFFD35620).withValues(alpha: 0.04);
final _down = BoxShadow(
  color: _shadowColor,
  blurRadius: 15,
  spreadRadius: 2,
  offset: const Offset(4, 4),
);
final _up = BoxShadow(
  color: _shadowColor,
  blurRadius: 15,
  spreadRadius: 2,
  offset: const Offset(-4, -4),
);

/// Плитка ленты фото меню: у первой большой угол слева сверху, у последней —
/// справа снизу, у единственной — оба.
BorderRadius _tileCorners({required bool first, required bool last}) =>
    BorderRadius.only(
      topLeft: Radius.circular(first ? 30 : 10),
      topRight: const Radius.circular(10),
      bottomLeft: const Radius.circular(10),
      bottomRight: Radius.circular(last ? 30 : 10),
    );

/// Мини-карта: справа снизу угол прямой.
const _mapCorners = BorderRadius.only(
  topLeft: Radius.circular(30),
  topRight: Radius.circular(30),
  bottomLeft: Radius.circular(30),
);

/// Подложка: прежняя ([fast] — false) или быстрая.
BoxDecoration _decoration(
  bool fast, {
  Color? color,
  required BorderRadius corners,
  required List<BoxShadow> shadows,
}) =>
    fast
        ? FastSoftShadowDecoration(
            color: color,
            borderRadius: corners,
            boxShadow: shadows,
          )
        : BoxDecoration(color: color, borderRadius: corners, boxShadow: shadows);

/// Узел, как на экране: подложка с тенью, внутри — содержимое, обрезанное по
/// тем же углам.
Widget _node(
  bool fast, {
  required Size size,
  Color? color,
  required BorderRadius corners,
  required List<BoxShadow> shadows,
  required Widget content,
}) =>
    Container(
      width: size.width,
      height: size.height,
      decoration: _decoration(fast,
          color: color, corners: corners, shadows: shadows),
      child: ClipRRect(borderRadius: corners, child: content),
    );

/// Заглушка фото, пока оно грузится, — как на экране.
const _placeholder = ColoredBox(color: _grey200);

/// Фото с прозрачностью: под ним видна тень — своей заливки у плитки нет.
const _transparentPhoto = SizedBox.expand();

/// Подставная «карта» — пёстрое содержимое, чтобы края обрезки было видно.
const _map = DecoratedBox(
  decoration: BoxDecoration(
    gradient: LinearGradient(
      colors: [Color(0xFF9CC3E6), Color(0xFFE8E2D0), Color(0xFF7FB77E)],
    ),
  ),
);

/// Узел [node] размером [size] на белом поле с запасом 50 под тень; точки
/// снимка и его ширина в точках.
Future<(Uint8List, int)> _render(
  WidgetTester tester,
  Widget node,
  Size size,
  double pixelRatio,
) async {
  final key = GlobalKey();
  await tester.pumpWidget(Directionality(
    textDirection: TextDirection.ltr,
    child: Center(
      child: RepaintBoundary(
        key: key,
        child: Container(
          width: size.width + 100,
          height: size.height + 100,
          color: _white,
          alignment: Alignment.center,
          child: node,
        ),
      ),
    ),
  ));
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  late Uint8List bytes;
  late int width;
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: pixelRatio);
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    bytes = data!.buffer.asUint8List();
    width = image.width;
    image.dispose();
  });
  return (bytes, width);
}

typedef _Case = ({
  String what,
  Size size,
  double ratio,
  Widget Function(bool fast) node,
});

/// Размытые фигуры, нарисованные на холсте: прямоугольники — как скруглённые
/// с нулевыми углами; остальные размытые фигуры (контур, кольцо, овал) — в
/// [others].
typedef _Draws = ({List<RRect> blurred, List<String> others});

PaintPattern _collect(_Draws into) => paints
  ..everything((Symbol method, List<dynamic> arguments) {
    final paint = arguments.whereType<Paint>().firstOrNull;
    if (paint == null || paint.maskFilter == null) return true;
    switch (method) {
      case #drawRect:
        into.blurred
            .add(RRect.fromRectAndRadius(arguments[0] as Rect, Radius.zero));
      case #drawRRect:
        into.blurred.add(arguments[0] as RRect);
      default:
        into.others.add('$method');
    }
    return true;
  });

/// На экране [screen]: размытых теней с разными углами и размытых контуров
/// нет, сами тени есть.
void _expectOnlyFastShadows(WidgetTester tester, Finder screen) {
  final draws = (blurred: <RRect>[], others: <String>[]);
  debugDisableShadows = false;
  try {
    expect(tester.renderObject(screen), _collect(draws));
  } finally {
    debugDisableShadows = true;
  }
  expect(draws.others, isEmpty, reason: 'размытые контуры медленные');
  expect(draws.blurred, isNotEmpty, reason: 'теней на экране нет');
  for (final r in draws.blurred) {
    expect({r.tlRadius, r.trRadius, r.brRadius, r.blRadius}, hasLength(1),
        reason: 'у размытой тени углы должны быть одинаковыми: $r');
  }
}

/// Все подложки с тенью на экране. У каждой с разными углами — быстрая.
List<BoxDecoration> _shadowedDecorations(WidgetTester tester) {
  final all = tester
      .widgetList<Container>(find.byType(Container))
      .map((c) => c.decoration)
      .whereType<BoxDecoration>()
      .where((d) => d.boxShadow != null)
      .toList();
  for (final d in all) {
    final r = d.borderRadius?.resolve(TextDirection.ltr) ?? BorderRadius.zero;
    final mixed =
        {r.topLeft, r.topRight, r.bottomRight, r.bottomLeft}.length > 1;
    if (mixed) {
      expect(d, isA<FastSoftShadowDecoration>(),
          reason: 'подложка с тенью и разными углами рисует тень медленно: '
              '$d');
    }
  }
  return all;
}

class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

class _Guest extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

void main() {
  testWidgets(
      'вид не изменился: плитки ленты фото меню, плитки предпросмотра и '
      'мини-карта по точкам равны прежним — с содержимым и без', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(700, 700);
    addTearDown(tester.view.reset);

    const tile = Size(165, 275);
    Widget detailTile(bool fast,
            {required bool first, required bool last, required Widget photo}) =>
        _node(fast,
            size: tile,
            corners: _tileCorners(first: first, last: last),
            shadows: [_down, _up],
            content: photo);
    Widget previewTile(bool fast,
            {required bool first, required bool last, required Widget photo}) =>
        _node(fast,
            size: tile,
            corners: _tileCorners(first: first, last: last),
            shadows: [_down],
            content: photo);
    // Мини-карта во всю ширину страницы без полей по 4: экраны 360, 390 и
    // 438 dp.
    Widget miniMap(bool fast, double width) => _node(fast,
        size: Size(width, 384),
        color: _grey300,
        corners: _mapCorners,
        shadows: [_down],
        content: _map);

    final cases = <_Case>[
      (
        what: 'страница: первая плитка, заглушка фото',
        size: tile,
        ratio: 3,
        node: (f) => detailTile(f, first: true, last: false, photo: _placeholder),
      ),
      (
        what: 'страница: первая плитка, плотность 2,625',
        size: tile,
        ratio: 2.625,
        node: (f) => detailTile(f, first: true, last: false, photo: _placeholder),
      ),
      (
        what: 'страница: последняя плитка, заглушка фото',
        size: tile,
        ratio: 3,
        node: (f) => detailTile(f, first: false, last: true, photo: _placeholder),
      ),
      (
        what: 'страница: единственная плитка, прозрачное фото',
        size: tile,
        ratio: 3,
        node: (f) =>
            detailTile(f, first: true, last: true, photo: _transparentPhoto),
      ),
      (
        what: 'страница: первая плитка, прозрачное фото',
        size: tile,
        ratio: 3,
        node: (f) =>
            detailTile(f, first: true, last: false, photo: _transparentPhoto),
      ),
      (
        what: 'предпросмотр: первая плитка, заглушка фото',
        size: tile,
        ratio: 3,
        node: (f) =>
            previewTile(f, first: true, last: false, photo: _placeholder),
      ),
      (
        what: 'предпросмотр: последняя плитка, прозрачное фото',
        size: tile,
        ratio: 3,
        node: (f) =>
            previewTile(f, first: false, last: true, photo: _transparentPhoto),
      ),
      (
        what: 'предпросмотр: единственная плитка, заглушка фото',
        size: tile,
        ratio: 2.625,
        node: (f) => previewTile(f, first: true, last: true, photo: _placeholder),
      ),
      (
        what: 'мини-карта, экран 360',
        size: const Size(352, 384),
        ratio: 3,
        node: (f) => miniMap(f, 352),
      ),
      (
        what: 'мини-карта, экран 390, плотность 2,625',
        size: const Size(382, 384),
        ratio: 2.625,
        node: (f) => miniMap(f, 382),
      ),
      (
        what: 'мини-карта, экран 438',
        size: const Size(430, 384),
        ratio: 3,
        node: (f) => miniMap(f, 430),
      ),
    ];

    final shots = <_Case, ((Uint8List, int), (Uint8List, int))>{};
    // В тестах тени по умолчанию рисуются без размытия — здесь нужны
    // настоящие.
    debugDisableShadows = false;
    try {
      for (final c in cases) {
        shots[c] = (
          await _render(tester, c.node(false), c.size, c.ratio),
          await _render(tester, c.node(true), c.size, c.ratio),
        );
      }
    } finally {
      // Вернуть до конца теста: привязка сверяет это раньше addTearDown.
      debugDisableShadows = true;
    }

    for (final MapEntry(key: c, value: ((before, width), (after, _)))
        in shots.entries) {
      expect(after.length, before.length, reason: c.what);

      // Предпосылка: тень на снимке есть и она размыта. В 7 точках справа от
      // узла, на середине его высоты, сплошная тень (сдвиг 4 и расползание
      // 2) уже кончилась бы — размытая ещё видна.
      final x = ((50 + c.size.width + 7) * c.ratio).floor();
      final y = ((50 + c.size.height / 2) * c.ratio).floor();
      expect(before.length, greaterThanOrEqualTo((y * width + x) * 4 + 4),
          reason: c.what);
      final blue = before[(y * width + x) * 4 + 2];
      expect(255 - blue, greaterThan(2),
          reason: '${c.what}: размытой тени на снимке нет');

      var maxDiff = 0, differing = 0;
      for (var i = 0; i < before.length; i++) {
        final diff = (before[i] - after[i]).abs();
        if (diff > maxDiff) maxDiff = diff;
        if (diff > 0) differing++;
      }
      // Отличие до 2 из 255 — глазу не видно (тот же допуск, что у карточки
      // выдачи, PR #218).
      expect(maxDiff, lessThanOrEqualTo(2),
          reason: '${c.what}: вид отличается от прежнего ($differing '
              'значений, самое большое отличие $maxDiff из 255)');
    }
  });

  group('страница заведения', () {
    const id = '11111111-1111-4111-8111-111111111111';

    setUp(() {
      // Три фото меню: первая, средняя и последняя плитки. Координат нет —
      // карта Яндекса в тесте не работает; подложка мини-карты с тенью
      // строится и без них.
      final row = establishmentRow(id: id, media: [
        for (var i = 0; i < 3; i++)
          mediaRow(
            id: '2222222$i-2222-4222-8222-222222222222',
            type: 'menu',
            position: i,
          ),
      ])
        ..['primary_image_url'] = null
        ..['latitude'] = null
        ..['longitude'] = null;
      installWireStand((options) {
        final path = options.uri.path;
        if (path == '/api/v1/search/establishments/$id') {
          return jsonBody({'success': true, 'data': row});
        }
        if (path == '/api/v1/establishments/$id/reviews') {
          return jsonBody(reviewsEnvelope(reviews: []));
        }
        return jsonBody({'success': false}, status: 404);
      });
    });

    testWidgets(
        'лента фото меню и мини-карта — на быстрой подложке с прежними '
        'углами и тенями; размытых теней с разными углами на странице нет',
        (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 900);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(create: (_) => _Guest()),
          ChangeNotifierProvider<EstablishmentsProvider>(
              create: (_) => _NoLocation()),
          ChangeNotifierProvider<BookingProvider>(
              create: (_) => BookingProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const EstablishmentDetailScreen(establishmentId: id),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Васильки'), findsWidgets,
          reason: 'страница не загрузилась');

      final decorations = _shadowedDecorations(tester);
      FastSoftShadowDecoration tile({required bool first, required bool last}) =>
          FastSoftShadowDecoration(
            borderRadius: _tileCorners(first: first, last: last),
            boxShadow: [_down, _up],
          );
      expect(
        decorations,
        containsAll(<BoxDecoration>[
          tile(first: true, last: false),
          tile(first: false, last: false),
          tile(first: false, last: true),
          FastSoftShadowDecoration(
            color: _grey300,
            borderRadius: _mapCorners,
            boxShadow: [_down],
          ),
        ]),
      );

      _expectOnlyFastShadows(tester, find.byType(EstablishmentDetailScreen));
    });
  });

  testWidgets(
      'предпросмотр у партнёра: лента фото меню — на быстрой подложке с '
      'прежними углами и тенью; размытых теней с разными углами нет',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 900);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: const EstablishmentPreviewScreen(
        registrationData: PartnerRegistration(
          name: 'Васильки',
          categories: ['Ресторан'],
          menuPhotos: [
            'https://cdn.example/menu-1',
            'https://cdn.example/menu-2',
            'https://cdn.example/menu-3',
          ],
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('Васильки'), findsWidgets,
        reason: 'предпросмотр не построен');

    final decorations = _shadowedDecorations(tester);
    FastSoftShadowDecoration tile({required bool first, required bool last}) =>
        FastSoftShadowDecoration(
          borderRadius: _tileCorners(first: first, last: last),
          boxShadow: [_down],
        );
    expect(
      decorations,
      containsAll(<BoxDecoration>[
        tile(first: true, last: false),
        tile(first: false, last: false),
        tile(first: false, last: true),
      ]),
    );

    _expectOnlyFastShadows(tester, find.byType(EstablishmentPreviewScreen));
  });
}
