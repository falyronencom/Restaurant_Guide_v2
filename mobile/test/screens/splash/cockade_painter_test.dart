import 'dart:ui';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/screens/splash/painters/cockade_painter.dart';

/// Painter кокарды — что именно ложится на холст.
///
/// Холст-регистратор записывает вызовы `drawCircle`; остальное (слои, клип,
/// прямоугольник блика) игнорируется. Проверяются радиусы трёх дисков
/// (R, .60R, .34R — полосы иконки), кольца полёта на дальних радиусах и их
/// стыковка с посадкой, глянец С ПЕРВОГО кадра посадки (правило CAT-C-1.4
/// «материал приходит вместе с формой»), волны петли в противофазе.
class _Circle {
  _Circle(this.center, this.radius, this.paint);
  final Offset center;
  final double radius;
  final Paint paint;
  bool get filled => paint.style == PaintingStyle.fill;
}

class _RecordingCanvas implements Canvas {
  final List<_Circle> circles = <_Circle>[];

  @override
  void drawCircle(Offset c, double radius, Paint paint) {
    circles.add(_Circle(c, radius, paint));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  const center = Offset(195, 352);
  const r = 62.0;
  const size = Size(390, 844);

  CockadePainter painter({
    double? flight,
    bool landed = false,
    double scale = 1,
    double shadow = 0,
    double flash = 0,
    double? wave,
    double? loopPhase,
    double opacity = 1,
  }) =>
      CockadePainter(
        center: center,
        radius: r,
        flight: flight,
        landed: landed,
        scale: scale,
        shadow: shadow,
        flash: flash,
        wave: wave,
        loopPhase: loopPhase,
        opacity: opacity,
      );

  List<_Circle> paint(CockadePainter p) {
    final canvas = _RecordingCanvas();
    p.paint(canvas, size);
    return canvas.circles;
  }

  /// Диски знака: заливки без размытия (тень — заливка с maskFilter).
  List<_Circle> discs(List<_Circle> all) =>
      all.where((c) => c.filled && c.paint.maskFilter == null).toList();

  test('покой: три диска R, .60R, .34R в центре знака', () {
    final all = paint(painter(landed: true, shadow: 1));
    final d = discs(all);
    expect(d.map((c) => c.radius).toList(),
        [closeTo(62, .01), closeTo(37.2, .01), closeTo(21.08, .01)],
        reason: 'радиусы дисков — полосы иконки, снаружи внутрь');
    for (final c in d) {
      expect(c.center, center);
    }
    expect(all.where((c) => !c.filled), isEmpty,
        reason: 'в покое без вспышки и волн штрихов нет');
  });

  test('первый кадр посадки: знак с перелётом и уже глянцевый', () {
    // ip = 0: масштаб 1.09, тени ещё нет.
    final d = discs(paint(painter(landed: true, scale: 1.09, shadow: 0)));
    expect(d.map((c) => c.radius).toList(), [
      closeTo(62 * 1.09, .01),
      closeTo(37.2 * 1.09, .01),
      closeTo(21.08 * 1.09, .01),
    ]);
    for (final c in d) {
      expect(c.paint.shader, isNotNull,
          reason: 'материал приходит вместе с формой: диск радиуса '
              '${c.radius} нарисован плоской заливкой');
    }
  });

  test('тень появляется с посадкой, под знаком и размытая', () {
    final all = paint(painter(landed: true, shadow: .5));
    final shadows = all.where((c) => c.paint.maskFilter != null).toList();
    expect(shadows, hasLength(1));
    expect(shadows.single.radius, closeTo(62, .01));
    expect(shadows.single.center.dy, greaterThan(center.dy),
        reason: 'тень смещена вниз');
    expect(shadows.single.paint.color.a, closeTo(.15, .01),
        reason: 'альфа тени .30·shadow');
  });

  test('полёт p = 0: только три тонких штриха на дальних радиусах', () {
    final all = paint(painter(flight: 0));
    expect(all.where((c) => c.filled), isEmpty, reason: 'знака в полёте нет');
    final strokes = all.where((c) => !c.filled).toList();
    expect(strokes.map((c) => c.radius).toList(),
        [closeTo(62 * 4.4, .01), closeTo(62 * 3.2, .01), closeTo(62 * 2.24, .01)]);
    expect(strokes.map((c) => c.paint.strokeWidth).toList(),
        [closeTo(1.6, .01), closeTo(1.2, .01), closeTo(1.0, .01)]);
    expect(strokes.map((c) => c.paint.color.a).toList(),
        [closeTo(.16, .01), closeTo(.12, .01), closeTo(.10, .01)]);
  });

  test('полёт p = 1 стыкуется с радиусами посадки', () {
    final strokes = paint(painter(flight: 1)).where((c) => !c.filled).toList();
    expect(strokes.map((c) => c.radius).toList(),
        [closeTo(62, .01), closeTo(37.2, .01), closeTo(21.08, .01)]);
    expect(strokes.map((c) => c.paint.color.a).toList(),
        [closeTo(1, .01), closeTo(.82, .01), closeTo(.90, .01)]);
  });

  test('петля: две волны в противофазе, без знака заливкой сверх дисков', () {
    final all = paint(painter(landed: true, shadow: 1, loopPhase: .25));
    final waves = all.where((c) => !c.filled).toList();
    expect(waves.map((c) => c.radius).toList(),
        [closeTo(62 * 1.5, .01), closeTo(62 * 2.5, .01)]);
    expect(waves.map((c) => c.paint.color.a).toList(),
        [closeTo(.15, .01), closeTo(.05, .01)]);
  });

  test('вспышка и волна посадки — штрихи снаружи знака', () {
    final all = paint(painter(landed: true, shadow: 1, flash: .5, wave: .5));
    final strokes = all.where((c) => !c.filled).toList();
    expect(strokes, hasLength(2));
    expect(strokes[0].radius, closeTo(62 * 1.275, .01), reason: 'вспышка');
    expect(strokes[1].radius, closeTo(62 * 1.925, .01), reason: 'волна');
  });

  test('outro при нулевой прозрачности не рисует ничего', () {
    expect(paint(painter(landed: true, shadow: 1, opacity: 0)), isEmpty);
  });

  test('масштабируется от радиуса: ширина штриха следует за R', () {
    final canvas = _RecordingCanvas();
    const CockadePainter(
      center: Offset(160, 237),
      radius: 31, // половина сетки
      flight: 0,
      landed: false,
      scale: 1,
      shadow: 0,
      flash: 0,
      wave: null,
      loopPhase: null,
      opacity: 1,
    ).paint(canvas, const Size(320, 568));
    expect(canvas.circles.first.paint.strokeWidth, closeTo(.8, .01));
    expect(canvas.circles.first.radius, closeTo(31 * 4.4, .01));
  });
}
