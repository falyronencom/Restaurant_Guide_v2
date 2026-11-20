import 'dart:math' as math;

import 'package:flutter/painting.dart';

/// Подложка с мягкой тенью — то же, что [BoxDecoration] с цветом, углами и
/// тенями, но тень прямоугольника с РАЗНЫМИ углами рисуется быстрым способом.
///
/// Зачем. Размытую тень прямоугольника с разными углами движок (Flutter 3.35,
/// Impeller) считает заново на каждом кадре, с одинаковыми углами — быстрым
/// способом. Замер на телефоне 20.11.2026, быстрая прокрутка выдачи: с
/// прежней тенью поля с текстом карточки (углы 0 / 10 / 40 / 0) 61 % кадров
/// дольше 16,7 мс, с тенью из одинаковых углов — меньше 1 %.
///
/// Как. Размытие дотягивается от края фигуры на три «сигмы», не дальше: тень
/// в точке зависит только от ближней к ней части фигуры. Поэтому тень делится
/// по середине ширины и высоты подложки, и в каждой четверти рисуется
/// прямоугольником, у которого ВСЕ углы — как угол этой четверти, с обрезкой
/// по четверти. Остальные углы у такого прямоугольника неверны, но от этой
/// четверти они дальше размытия — их тень сюда не доходит, и шва на границах
/// нет. Четверти одной стороны (левой или правой) с одинаковым углом
/// рисуются одним куском.
///
/// Если подложка так мала, что неверный угол ближе размытия к середине, эта
/// тень рисуется прежним способом: вид важнее скорости.
///
/// Заливку, попадание пальцем и прочее делает сам [BoxDecoration].
/// `copyWith`, `scale` и `lerp` вернут обычный [BoxDecoration] — с медленной
/// тенью.
class FastSoftShadowDecoration extends BoxDecoration {
  const FastSoftShadowDecoration({
    super.color,
    required BorderRadiusGeometry super.borderRadius,
    required List<BoxShadow> super.boxShadow,
  });

  @override
  BoxPainter createBoxPainter([VoidCallback? onChanged]) =>
      _FastSoftShadowPainter(this, onChanged);
}

class _FastSoftShadowPainter extends BoxPainter {
  _FastSoftShadowPainter(this._decoration, VoidCallback? onChanged)
      : _fill = BoxDecoration(
          color: _decoration.color,
          borderRadius: _decoration.borderRadius,
        ).createBoxPainter(onChanged),
        super(onChanged);

  final FastSoftShadowDecoration _decoration;

  /// Заливка — обычным [BoxDecoration], без теней.
  final BoxPainter _fill;

  @override
  void paint(Canvas canvas, Offset offset, ImageConfiguration configuration) {
    assert(configuration.size != null);
    final rect = offset & configuration.size!;
    final radius =
        _decoration.borderRadius!.resolve(configuration.textDirection);
    for (final shadow in _decoration.boxShadow!) {
      _paintShadow(canvas, rect, radius, shadow);
    }
    _fill.paint(canvas, offset, configuration);
  }

  @override
  void dispose() {
    _fill.dispose();
    super.dispose();
  }
}

/// Тень [shadow] подложки [rect] с углами [radius].
void _paintShadow(
  Canvas canvas,
  Rect rect,
  BorderRadius radius,
  BoxShadow shadow,
) {
  final paint = shadow.toPaint();
  // Как у BoxDecoration: прямоугольник сдвинут и расширен, углы прежние.
  final bounds = rect.shift(shadow.offset).inflate(shadow.spreadRadius);
  final BorderRadius(
    topLeft: tl,
    topRight: tr,
    bottomRight: br,
    bottomLeft: bl,
  ) = radius;

  // Докуда от края фигуры дотягивается размытие.
  final reach = 3 * shadow.blurSigma;
  // От середины подложки до ближайшего края угловой зоны тени, по ширине и
  // по высоте. Угол другой четверти неверен только в своей зоне.
  final gapX = bounds.width / 2 -
      shadow.offset.dx.abs() -
      [tl.x, tr.x, br.x, bl.x].reduce(math.max);
  final gapY = bounds.height / 2 -
      shadow.offset.dy.abs() -
      [tl.y, tr.y, br.y, bl.y].reduce(math.max);

  final uniform = tl == tr && tr == br && br == bl;
  if (uniform || gapX <= reach || gapY <= reach) {
    _drawShape(canvas, bounds, radius, paint);
    return;
  }

  final c = rect.center;
  // Наружу обрезка — вдвое дальше, чем дотягивается размытие: её край режет
  // только пустоту.
  final o = bounds.inflate(2 * reach + 1);
  final parts = <(Rect, Radius)>[
    if (tl == bl)
      (Rect.fromLTRB(o.left, o.top, c.dx, o.bottom), tl)
    else ...[
      (Rect.fromLTRB(o.left, o.top, c.dx, c.dy), tl),
      (Rect.fromLTRB(o.left, c.dy, c.dx, o.bottom), bl),
    ],
    if (tr == br)
      (Rect.fromLTRB(c.dx, o.top, o.right, o.bottom), tr)
    else ...[
      (Rect.fromLTRB(c.dx, o.top, o.right, c.dy), tr),
      (Rect.fromLTRB(c.dx, c.dy, o.right, o.bottom), br),
    ],
  ];
  for (final (clip, corner) in parts) {
    // Без сглаживания края обрезки соседние куски делят точки ровно, без
    // перекрытия и щели.
    canvas
      ..save()
      ..clipRect(clip, doAntiAlias: false);
    _drawShape(canvas, bounds, BorderRadius.all(corner), paint);
    canvas.restore();
  }
}

/// Фигура так же, как её рисует [BoxDecoration].
void _drawShape(Canvas canvas, Rect bounds, BorderRadius radius, Paint paint) {
  if (radius == BorderRadius.zero) {
    canvas.drawRect(bounds, paint);
  } else {
    canvas.drawRRect(radius.toRRect(bounds), paint);
  }
}
