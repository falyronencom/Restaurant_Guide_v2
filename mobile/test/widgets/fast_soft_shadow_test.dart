// Тень поля с текстом карточки выдачи (углы: слева прямые, справа сверху 10,
// справа снизу 40) рисуется не одной размытой тенью с разными углами, а
// кусками с одинаковыми углами: такую движок считает быстрым способом. Замер
// на телефоне 20.11.2026: с одной тенью 61 % кадров прокрутки выдачи дольше
// 16,7 мс, с тенью из одинаковых углов — меньше 1 %.
//
// Здесь стережётся, что вид при этом не изменился (сверка по точкам с прежним
// BoxDecoration при настоящем размытии), что размытых прямоугольников с
// разными углами в отрисовке нет — ни у подложки, ни у всей карточки, — и что
// слишком маленькая подложка рисует тень прежним способом.
//
// Цвета, тени и размеры — литералами: проверка с константой согласилась бы с
// любой её правкой.

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/fast_soft_shadow.dart';

const _white = Color(0xFFFFFFFF);
const _beige = Color(0xFFF4F1EC);
const _corners = BorderRadius.only(
  topRight: Radius.circular(10),
  bottomRight: Radius.circular(40),
);
const _shadows = [
  BoxShadow(
    color: Color(0x0AD35620),
    offset: Offset(4, 4),
    blurRadius: 15,
    spreadRadius: 2,
  ),
  BoxShadow(
    color: Color(0x0AD35620),
    offset: Offset(-4, -4),
    blurRadius: 15,
    spreadRadius: 2,
  ),
];

/// Прежний способ — подложка поля с текстом, как была в карточке.
const _before = BoxDecoration(
  color: _beige,
  borderRadius: _corners,
  boxShadow: _shadows,
);

const _after = FastSoftShadowDecoration(
  color: _beige,
  borderRadius: _corners,
  boxShadow: _shadows,
);

/// Подложка [decoration] размером [box] на белом поле с запасом 50 под тень.
Future<ui.Image> _render(
  WidgetTester tester,
  Decoration decoration,
  Size box,
  double pixelRatio,
) async {
  final key = GlobalKey();
  await tester.pumpWidget(Directionality(
    textDirection: TextDirection.ltr,
    child: Center(
      child: RepaintBoundary(
        key: key,
        child: Container(
          width: box.width + 100,
          height: box.height + 100,
          color: _white,
          alignment: Alignment.center,
          child: SizedBox.fromSize(
            size: box,
            child: DecoratedBox(decoration: decoration),
          ),
        ),
      ),
    ),
  ));
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  late ui.Image image;
  await tester.runAsync(() async {
    image = await boundary.toImage(pixelRatio: pixelRatio);
  });
  return image;
}

Future<Uint8List> _bytes(WidgetTester tester, ui.Image image) async {
  late Uint8List bytes;
  await tester.runAsync(() async {
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    bytes = data!.buffer.asUint8List();
  });
  return bytes;
}

/// Размытые фигуры, нарисованные на холсте: прямоугольники — как скруглённые
/// с нулевыми углами; остальные размытые фигуры (контур, кольцо, овал) — в
/// [others].
typedef _Draws = ({List<RRect> blurred, List<String> others, List<RRect> plain});

PaintPattern _collect(_Draws into) => paints
  ..everything((Symbol method, List<dynamic> arguments) {
    final paint = arguments.whereType<Paint>().firstOrNull;
    if (paint == null) return true;
    final blurred = paint.maskFilter != null;
    switch (method) {
      case #drawRect:
        final rrect = RRect.fromRectAndRadius(arguments[0] as Rect, Radius.zero);
        (blurred ? into.blurred : into.plain).add(rrect);
      case #drawRRect:
        (blurred ? into.blurred : into.plain).add(arguments[0] as RRect);
      default:
        if (blurred) into.others.add('$method');
    }
    return true;
  });

_Draws _draws() => (blurred: <RRect>[], others: <String>[], plain: <RRect>[]);

/// Углы скругления по порядку: слева сверху, справа сверху, справа снизу,
/// слева снизу.
List<Radius> _radii(RRect r) => [r.tlRadius, r.trRadius, r.brRadius, r.blRadius];

void _expectUniform(List<RRect> blurred) {
  for (final rrect in blurred) {
    expect(_radii(rrect).toSet(), hasLength(1),
        reason: 'у размытой тени углы должны быть одинаковыми: $rrect');
  }
}

Establishment _establishment() => Establishment(
      id: 'e1',
      name: 'Осмоловка',
      category: 'coffee_shop',
      cuisine: 'Авторская',
      priceRange: r'$',
      rating: 4.5,
      address: 'улица Киселева, 23',
      city: 'Минск',
      status: 'active',
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

void main() {
  testWidgets(
      'вид не изменился: тень по точкам равна прежней — на телефонах шириной '
      '360, 390 и 438, на вытянутой карточке и на слишком узкой подложке',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(700, 700);
    addTearDown(tester.view.reset);

    // Подложка поля с текстом: ширина карточки без фото (172) и полей (26).
    const cases = <(Size, double)>[
      (Size(192, 291), 3), // 390 dp
      (Size(192, 291), 2.625), // 412 dp, дробная плотность
      (Size(162, 291), 3), // 360 dp
      (Size(240, 291), 3), // 438 dp
      (Size(192, 420), 3), // карточка, вытянутая длинным текстом
      (Size(110, 291), 3), // слишком узкая: тень прежним способом
    ];

    final shots = <(Size, double), (ui.Image, ui.Image)>{};
    // В тестах тени по умолчанию рисуются без размытия — здесь нужны
    // настоящие.
    debugDisableShadows = false;
    try {
      for (final c in cases) {
        shots[c] = (
          await _render(tester, _before, c.$1, c.$2),
          await _render(tester, _after, c.$1, c.$2),
        );
      }
    } finally {
      // Вернуть до конца теста: привязка сверяет это раньше addTearDown.
      debugDisableShadows = true;
    }

    for (final MapEntry(key: (box, ratio), value: (before, after))
        in shots.entries) {
      final what = 'подложка $box при плотности $ratio';
      expect((after.width, after.height), (before.width, before.height));
      final b = await _bytes(tester, before);
      final a = await _bytes(tester, after);

      // Предпосылка: тень на снимке есть и она размыта. В 7 точках справа от
      // подложки, на середине её высоты, сплошная тень (сдвиг 4 и
      // расползание 2) уже кончилась бы — размытая ещё видна.
      final x = ((50 + box.width + 7) * ratio).floor();
      final y = ((50 + box.height / 2) * ratio).floor();
      final blue = b[(y * before.width + x) * 4 + 2];
      expect(255 - blue, greaterThan(3),
          reason: '$what: размытой тени на снимке нет');

      var maxDiff = 0, differing = 0;
      for (var i = 0; i < b.length; i += 4) {
        for (var ch = 0; ch < 4; ch++) {
          final diff = (b[i + ch] - a[i + ch]).abs();
          if (diff > maxDiff) maxDiff = diff;
          if (diff > 0) differing++;
        }
      }
      // Отличие до 2 из 255 — глазу не видно. Замер 20.11.2026: оно почти
      // всё в левой половине тени, где углы прямые, — размытие простого
      // прямоугольника тестовая отрисовка считает другой формулой, чем
      // скруглённого; в правой половине и на швах — единицы точек по 1.
      expect(maxDiff, lessThanOrEqualTo(2),
          reason: '$what: тень отличается от прежней ($differing значений, '
              'самое большое отличие $maxDiff из 255)');
      before.dispose();
      after.dispose();
    }
  });

  test(
      'подложка: размытых прямоугольников с разными углами нет, тень — на '
      'прежнем месте; заливка — прежняя', () {
    final draws = _draws();
    debugDisableShadows = false;
    try {
      expect(
        (Canvas canvas) => _after.createBoxPainter().paint(
              canvas,
              Offset.zero,
              const ImageConfiguration(
                size: Size(192, 291),
                textDirection: TextDirection.ltr,
              ),
            ),
        _collect(draws),
      );
    } finally {
      debugDisableShadows = true;
    }

    expect(draws.others, isEmpty, reason: 'размытые контуры медленные');
    // Каждая из двух теней — тремя кусками: слева углы прямые, справа сверху
    // — 10, справа снизу — 40.
    expect(draws.blurred, hasLength(6));
    _expectUniform(draws.blurred);
    expect(
      draws.blurred.map((r) => r.tlRadius).toList(),
      const [
        Radius.zero, Radius.circular(10), Radius.circular(40), //
        Radius.zero, Radius.circular(10), Radius.circular(40),
      ],
    );
    // Прямоугольник тени — как у BoxDecoration: сдвиг и расползание 2.
    expect(draws.blurred.map((r) => r.outerRect).toSet(), {
      const Rect.fromLTRB(2, 2, 198, 297),
      const Rect.fromLTRB(-6, -6, 190, 289),
    });

    expect(draws.plain, hasLength(1));
    final fill = draws.plain.single;
    expect(fill.outerRect, const Rect.fromLTWH(0, 0, 192, 291));
    expect(_radii(fill), const [
      Radius.zero,
      Radius.circular(10),
      Radius.circular(40),
      Radius.zero,
    ]);
  });

  test('слишком узкая подложка: тень прежним способом — одним прямоугольником '
      'с теми же углами', () {
    final draws = _draws();
    debugDisableShadows = false;
    try {
      expect(
        (Canvas canvas) => _after.createBoxPainter().paint(
              canvas,
              Offset.zero,
              const ImageConfiguration(
                size: Size(110, 291),
                textDirection: TextDirection.ltr,
              ),
            ),
        _collect(draws),
      );
    } finally {
      debugDisableShadows = true;
    }

    expect(draws.blurred, hasLength(2));
    for (final rrect in draws.blurred) {
      expect(_radii(rrect), const [
        Radius.zero,
        Radius.circular(10),
        Radius.circular(40),
        Radius.zero,
      ]);
    }
  });

  testWidgets(
      'карточка выдачи: тень поля с текстом — прежняя, размытых прямоугольников '
      'с разными углами во всей карточке нет', (tester) async {
    tester.view.devicePixelRatio = 3;
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(children: [
          EstablishmentCard(establishment: _establishment()),
        ]),
      ),
    ));

    // Подложка поля с текстом — с теми же цветом, углами и тенями, что прежний
    // BoxDecoration (его вид по точкам сверяет первый тест).
    final card = find.byType(EstablishmentCard);
    final decorations = tester
        .widgetList<Container>(
            find.descendant(of: card, matching: find.byType(Container)))
        .map((c) => c.decoration)
        .whereType<FastSoftShadowDecoration>();
    expect(decorations, [_after]);

    final draws = _draws();
    debugDisableShadows = false;
    try {
      expect(tester.renderObject(card), _collect(draws));
    } finally {
      debugDisableShadows = true;
    }
    expect(draws.others, isEmpty, reason: 'размытые контуры медленные');
    expect(draws.blurred, isNotEmpty, reason: 'тени у карточки нет');
    _expectUniform(draws.blurred);
  });
}
