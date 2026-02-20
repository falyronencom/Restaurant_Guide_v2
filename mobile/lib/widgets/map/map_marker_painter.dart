import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// CustomPainter for Circle Badge map markers.
/// Draws a gradient circle with white border, fork-and-knife icon,
/// and a triangular pointer beneath.
///
/// Two states: open (warm orange gradient) and closed (muted grey gradient).
/// Architecture-ready for future rating badge (optional [rating] parameter).
class MapMarkerPainter extends CustomPainter {
  final bool isOpen;
  final double? rating; // Reserved for future rating badge
  final double devicePixelRatio;

  MapMarkerPainter({
    required this.isOpen,
    this.rating,
    this.devicePixelRatio = 1.0,
  });

  // Marker geometry (logical pixels, scaled by devicePixelRatio at render time)
  static const double circleDiameter = 48.0;
  static const double circleRadius = circleDiameter / 2.0;
  static const double borderWidth = 3.0;
  static const double pointerWidth = 12.0;
  static const double pointerHeight = 8.0;
  static const double shadowBlur = 8.0;
  static const double shadowOffsetY = 3.0;

  /// Total canvas size needed (circle + pointer + shadow padding)
  static const double canvasWidth = circleDiameter + shadowBlur * 2;
  static const double canvasHeight =
      circleDiameter + pointerHeight + shadowBlur * 2 + shadowOffsetY;

  // Open state colors (warm orange gradient)
  static const Color _openGradientStart = Color(0xFFFF8A5C);
  static const Color _openGradientEnd = Color(0xFFE8622B);
  static const Color _openShadowColor = Color(0x59E8622B); // ~0.35 alpha

  // Closed state colors (muted grey gradient)
  static const Color _closedGradientStart = Color(0xFFB0BEC5);
  static const Color _closedGradientEnd = Color(0xFF94A3B8);
  static const Color _closedShadowColor = Color(0x26000000); // ~0.15 alpha

  @override
  void paint(Canvas canvas, Size size) {
    // Center of the circle (offset for shadow padding)
    final double cx = size.width / 2;
    const double cy = shadowBlur + circleRadius;

    // --- Shadow ---
    final shadowPaint = Paint()
      ..color = isOpen ? _openShadowColor : _closedShadowColor
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, shadowBlur / 2);
    canvas.drawCircle(
      Offset(cx, cy + shadowOffsetY),
      circleRadius,
      shadowPaint,
    );

    // --- White border circle ---
    final borderPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;
    canvas.drawCircle(Offset(cx, cy), circleRadius, borderPaint);

    // --- Gradient fill circle ---
    const innerRadius = circleRadius - borderWidth;
    final gradientPaint = Paint()
      ..shader = ui.Gradient.linear(
        Offset(cx - innerRadius, cy - innerRadius), // top-left
        Offset(cx + innerRadius, cy + innerRadius), // bottom-right
        isOpen
            ? [_openGradientStart, _openGradientEnd]
            : [_closedGradientStart, _closedGradientEnd],
      )
      ..style = PaintingStyle.fill;
    canvas.drawCircle(Offset(cx, cy), innerRadius, gradientPaint);

    // --- Fork-and-knife icon ---
    _drawRestaurantIcon(canvas, cx, cy, innerRadius * 0.55);

    // --- Pointer triangle ---
    _drawPointer(canvas, cx, cy + circleRadius);
  }

  /// Draw a simplified fork-and-knife icon using Path operations.
  /// Centered at (cx, cy), scaled to fit within [iconRadius].
  void _drawRestaurantIcon(Canvas canvas, double cx, double cy, double iconRadius) {
    final iconPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    final strokePaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = iconRadius * 0.12
      ..strokeCap = StrokeCap.round;

    final double scale = iconRadius / 12.0; // Normalize to 12px base

    // Fork (left side)
    final double forkX = cx - 3.5 * scale;
    final double topY = cy - 8 * scale;
    final double handleBottom = cy + 8 * scale;

    // Fork tines
    for (int i = -1; i <= 1; i++) {
      final double tineX = forkX + i * 1.8 * scale;
      canvas.drawLine(
        Offset(tineX, topY),
        Offset(tineX, topY + 5 * scale),
        strokePaint,
      );
    }

    // Fork bridge (connects tines at bottom)
    canvas.drawLine(
      Offset(forkX - 1.8 * scale, topY + 5 * scale),
      Offset(forkX + 1.8 * scale, topY + 5 * scale),
      strokePaint,
    );

    // Fork handle
    canvas.drawLine(
      Offset(forkX, topY + 5 * scale),
      Offset(forkX, handleBottom),
      strokePaint,
    );

    // Knife (right side)
    final double knifeX = cx + 3.5 * scale;
    final knifePath = Path();

    // Knife blade — a tapered shape
    knifePath.moveTo(knifeX - 1.2 * scale, topY);
    knifePath.lineTo(knifeX + 1.5 * scale, topY);
    // Blade edge curves inward
    knifePath.quadraticBezierTo(
      knifeX + 2.2 * scale,
      topY + 3 * scale,
      knifeX + 0.8 * scale,
      topY + 6 * scale,
    );
    // Bolster
    knifePath.lineTo(knifeX - 0.8 * scale, topY + 6 * scale);
    knifePath.close();
    canvas.drawPath(knifePath, iconPaint);

    // Knife handle
    canvas.drawLine(
      Offset(knifeX, topY + 6 * scale),
      Offset(knifeX, handleBottom),
      strokePaint,
    );
  }

  /// Draw the white pointer triangle below the circle.
  void _drawPointer(Canvas canvas, double cx, double circleBottom) {
    // The pointer visually overlaps the circle border slightly
    final double pointerTop = circleBottom - 1.0;

    final pointerPath = Path()
      ..moveTo(cx - pointerWidth / 2, pointerTop)
      ..lineTo(cx, pointerTop + pointerHeight)
      ..lineTo(cx + pointerWidth / 2, pointerTop)
      ..close();

    final pointerPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    canvas.drawPath(pointerPath, pointerPaint);
  }

  @override
  bool shouldRepaint(covariant MapMarkerPainter oldDelegate) {
    return oldDelegate.isOpen != isOpen || oldDelegate.rating != rating;
  }
}
