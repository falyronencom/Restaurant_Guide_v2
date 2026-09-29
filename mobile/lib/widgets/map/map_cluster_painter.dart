import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_painter.dart';

/// CustomPainter for a cluster bubble: a group of nearby establishments drawn
/// as one orange circle with the group's size inside — the mobile counterpart
/// of the web map's bubble (`makeClusterBubble` in
/// web/src/components/map/MapView.tsx).
///
/// Dressed like an open pin (same gradient, white border and shadow) so a
/// bubble reads as "several of these". Always orange: whether the members are
/// open shows on their own pins once the map zooms in.
///
/// The canvas is square with the circle at its centre, so MapKit's default
/// anchor (0.5, 0.5) puts the bubble's centre on the cluster's point.
class MapClusterPainter extends CustomPainter {
  final int count;

  MapClusterPainter({required this.count});

  static const double borderWidth = MapMarkerPainter.borderWidth;
  static const double shadowBlur = MapMarkerPainter.shadowBlur;
  static const double shadowOffsetY = MapMarkerPainter.shadowOffsetY;

  /// Room around the circle for the shadow, equal on every side.
  static const double padding = shadowBlur + shadowOffsetY;

  /// Circle diameter by group size. Three steps as on the web (`bubbleTier`),
  /// scaled around the 48 dp pin: a small group is a touch smaller than a pin.
  static double diameterFor(int count) {
    if (count < 10) return 44.0;
    if (count < 50) return 52.0;
    return 62.0;
  }

  static double fontSizeFor(int count) {
    if (count < 10) return 16.0;
    if (count < 50) return 18.0;
    return 20.0;
  }

  /// Side of the square canvas, in logical pixels.
  static double canvasSideFor(int count) => diameterFor(count) + padding * 2;

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = size.center(Offset.zero);
    final double radius = diameterFor(count) / 2;

    // --- Shadow ---
    final shadowPaint = Paint()
      ..color = MapMarkerPainter.openShadowColor
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, shadowBlur / 2);
    canvas.drawCircle(center.translate(0, shadowOffsetY), radius, shadowPaint);

    // --- White border circle ---
    canvas.drawCircle(center, radius, Paint()..color = Colors.white);

    // --- Gradient fill circle ---
    final double innerRadius = radius - borderWidth;
    final gradientPaint = Paint()
      ..shader = ui.Gradient.linear(
        center.translate(-innerRadius, -innerRadius), // top-left
        center.translate(innerRadius, innerRadius), // bottom-right
        const [
          MapMarkerPainter.openGradientStart,
          MapMarkerPainter.openGradientEnd,
        ],
      );
    canvas.drawCircle(center, innerRadius, gradientPaint);

    // --- Group size ---
    // A TextPainter inherits no theme, so the family is named here.
    final textPainter = TextPainter(
      text: TextSpan(
        text: '$count',
        style: TextStyle(
          fontFamily: AppTheme.fontBodyFamily,
          fontWeight: FontWeight.w700,
          fontSize: fontSizeFor(count),
          height: 1.0,
          color: Colors.white,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    textPainter.paint(
      canvas,
      center - Offset(textPainter.width / 2, textPainter.height / 2),
    );
    textPainter.dispose();
  }

  @override
  bool shouldRepaint(covariant MapClusterPainter oldDelegate) {
    return oldDelegate.count != count;
  }
}
