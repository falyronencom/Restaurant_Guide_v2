import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Procedural painter for the NIRIVIO «Ornament Bloom» splash ornament.
///
/// Faithful port of the hi-fi design handoff (an HTML/SVG/CSS prototype). All
/// geometry is computed in the design's viewBox coordinate system — a 300×300
/// square with the origin (0,0) at the center and +Y pointing down — then
/// mapped to the available paint area. Nothing is rasterized, so the ornament
/// stays crisp at any DPI.
///
/// Four layers, drawn bottom-to-top:
///   RING   — perimeter dots that rotate continuously (the "alive" indicator);
///   OUTER  — 8 large cornflower petals with a folk vein cut out + orange eyelets;
///   INNER  — 8 small light-cornflower petals, offset between the large ones;
///   CENTER — a rosette of dots around a cornflower / hole / orange-core stack.
///
/// The painter holds no animation state: each layer's reveal (opacity, scale,
/// rotation) is computed by [SplashScreen] and passed in, so the same painter
/// renders every frame of the bloom, the hold, and the outro fade.
class OrnamentPainter extends CustomPainter {
  // ── Layer reveal state ────────────────────────────────────────────────────
  final double ringOpacity; // 0..1
  final double ringSpin; // radians, continuous clockwise rotation
  final double outerOpacity; // 0..1
  final double outerScale;
  final double outerRotation; // radians
  final double innerOpacity; // 0..1
  final double innerScale;
  final double innerRotation; // radians
  final double centerOpacity; // 0..1 (clamped; source curve overshoots)
  final double centerScale; // may exceed 1 — the overshoot "pop"
  final double globalOpacity; // outro fade multiplier, 0..1
  final Color eyeletColor; // OPEN EDIT — see SplashScreen

  const OrnamentPainter({
    required this.ringOpacity,
    required this.ringSpin,
    required this.outerOpacity,
    required this.outerScale,
    required this.outerRotation,
    required this.innerOpacity,
    required this.innerScale,
    required this.innerRotation,
    required this.centerOpacity,
    required this.centerScale,
    required this.globalOpacity,
    required this.eyeletColor,
  });

  /// viewBox spans -150..150 on both axes; a slightly padded bound is enough
  /// for the `saveLayer` offscreen buffers (perimeter dots reach ~145).
  static const Rect _bounds = Rect.fromLTRB(-160, -160, 160, 160);

  static const double _deg = math.pi / 180;

  @override
  void paint(Canvas canvas, Size size) {
    if (globalOpacity <= 0) return;
    // Map the 300-unit viewBox onto the available square, origin at center.
    final double scale = math.min(size.width, size.height) / 300.0;
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale);

    _paintRing(canvas, ringOpacity * globalOpacity);
    _paintOuter(canvas, outerOpacity * globalOpacity);
    _paintInner(canvas, innerOpacity * globalOpacity);
    _paintCenter(canvas, centerOpacity * globalOpacity);

    canvas.restore();
  }

  /// A single petal pointing up (toward -Y). Mirrors the prototype's
  /// `petal(rb, rt, w)`:  M0 -rb  Q w -mid 0 -rt  Q -w -mid 0 -rb  Z
  /// where mid = (rb + rt) / 2.
  Path _petal(double rb, double rt, double w) {
    final double mid = (rb + rt) / 2;
    return Path()
      ..moveTo(0, -rb)
      ..quadraticBezierTo(w, -mid, 0, -rt)
      ..quadraticBezierTo(-w, -mid, 0, -rb)
      ..close();
  }

  /// Opens an offscreen layer whose composite alpha = [opacity]. Returns false
  /// (no layer opened) when the layer would be fully transparent.
  bool _beginLayer(Canvas canvas, double opacity) {
    final double a = opacity.clamp(0.0, 1.0).toDouble();
    if (a <= 0) return false;
    canvas.saveLayer(_bounds, Paint()..color = Color.fromRGBO(0, 0, 0, a));
    return true;
  }

  void _paintRing(Canvas canvas, double opacity) {
    if (!_beginLayer(canvas, opacity)) return;
    canvas.rotate(ringSpin);
    final Paint dot = Paint()
      ..color = AppTheme.ornamentAccent
      ..isAntiAlias = true;
    const double radius = 140;
    for (int i = 0; i < 24; i++) {
      final double angle = i * 15 * _deg;
      final double dotR = i.isEven ? 5.0 : 3.0;
      canvas.drawCircle(
        Offset(math.cos(angle) * radius, math.sin(angle) * radius),
        dotR,
        dot,
      );
    }
    canvas.restore();
  }

  void _paintOuter(Canvas canvas, double opacity) {
    if (!_beginLayer(canvas, opacity)) return;
    canvas.scale(outerScale);
    canvas.rotate(outerRotation);

    // Soft navy drop shadow — design: drop-shadow(0 4px 10px rgba(40,58,107,.28)).
    // The solid petal silhouette (no vein) reads as a gentle lift.
    final Paint shadow = Paint()
      ..color = AppTheme.ornamentWordmark.withValues(alpha: 0.28)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4)
      ..isAntiAlias = true;
    for (int i = 0; i < 8; i++) {
      canvas.save();
      canvas.translate(0, 4);
      canvas.rotate(i * 45 * _deg);
      canvas.drawPath(_petal(40, 126, 30), shadow);
      canvas.restore();
    }

    // Cornflower petals with the folk vein cut out (petal minus inner slit).
    final Paint petalPaint = Paint()
      ..color = AppTheme.ornamentCornflower
      ..isAntiAlias = true;
    for (int i = 0; i < 8; i++) {
      canvas.save();
      canvas.rotate(i * 45 * _deg);
      final Path cell = Path.combine(
        PathOperation.difference,
        _petal(40, 126, 30),
        _petal(60, 104, 9),
      );
      canvas.drawPath(cell, petalPaint);
      canvas.restore();
    }

    // Eyelets — solid accent circles laid over each petal base.
    final Paint eye = Paint()
      ..color = eyeletColor
      ..isAntiAlias = true;
    for (int i = 0; i < 8; i++) {
      canvas.save();
      canvas.rotate(i * 45 * _deg);
      canvas.drawCircle(const Offset(0, -50), 5.5, eye);
      canvas.restore();
    }

    canvas.restore();
  }

  void _paintInner(Canvas canvas, double opacity) {
    if (!_beginLayer(canvas, opacity)) return;
    canvas.scale(innerScale);
    canvas.rotate(innerRotation);
    final Paint petalPaint = Paint()
      ..color = AppTheme.ornamentCornLite
      ..isAntiAlias = true;
    for (int i = 0; i < 8; i++) {
      canvas.save();
      canvas.rotate((i * 45 + 22.5) * _deg);
      canvas.drawPath(_petal(30, 78, 17), petalPaint);
      canvas.restore();
    }
    canvas.restore();
  }

  void _paintCenter(Canvas canvas, double opacity) {
    if (!_beginLayer(canvas, opacity)) return;
    canvas.scale(centerScale);

    final Paint corn = Paint()
      ..color = AppTheme.ornamentCornflower
      ..isAntiAlias = true;
    // Rosette of 8 dots at radius 34.
    for (int i = 0; i < 8; i++) {
      canvas.save();
      canvas.rotate(i * 45 * _deg);
      canvas.drawCircle(const Offset(0, -34), 6.5, corn);
      canvas.restore();
    }
    // Concentric core: cornflower ring → white ring → orange core.
    // White (not the background tone) makes the center a true «cockade»
    // bullseye — maximum focal contrast — matching the launcher icon.
    canvas.drawCircle(Offset.zero, 22, corn);
    canvas.drawCircle(
      Offset.zero,
      13,
      Paint()
        ..color = Colors.white
        ..isAntiAlias = true,
    );
    canvas.drawCircle(
      Offset.zero,
      7,
      Paint()
        ..color = AppTheme.ornamentAccent
        ..isAntiAlias = true,
    );

    canvas.restore();
  }

  @override
  bool shouldRepaint(OrnamentPainter old) =>
      ringOpacity != old.ringOpacity ||
      ringSpin != old.ringSpin ||
      outerOpacity != old.outerOpacity ||
      outerScale != old.outerScale ||
      outerRotation != old.outerRotation ||
      innerOpacity != old.innerOpacity ||
      innerScale != old.innerScale ||
      innerRotation != old.innerRotation ||
      centerOpacity != old.centerOpacity ||
      centerScale != old.centerScale ||
      globalOpacity != old.globalOpacity ||
      eyeletColor != old.eyeletColor;
}
