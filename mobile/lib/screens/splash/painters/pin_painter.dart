import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Paints a hollow map pin: white teardrop body with an orange circle cutout
/// and a dark-orange offset shadow. Matches the React prototype's SVG pin.
///
/// React SVG viewBox: 160×195
/// - Shadow at offset (4,5), opacity 0.25
/// - White teardrop: bulb centered at (80,73), radius ~65, tip at (80,170)
/// - Orange circle cutout: center (80,69), radius 28
class PinPainter extends CustomPainter {
  final Color bodyColor;
  final Color cutoutColor;
  final Color shadowColor;

  PinPainter({
    required this.bodyColor,
    required this.cutoutColor,
    required this.shadowColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Scale factors from viewBox 160×195
    double x(double v) => v / 160 * w;
    double y(double v) => v / 195 * h;
    double r(double v) => v / 160 * w;

    // 1. Shadow layer
    final shadowPaint = Paint()
      ..color = shadowColor.withValues(alpha: 0.25)
      ..style = PaintingStyle.fill;

    canvas.save();
    canvas.translate(x(4), y(5));
    final shadowPath = _buildTeardropPath(x, y);
    canvas.drawPath(shadowPath, shadowPaint);
    canvas.drawCircle(Offset(x(80), y(69)), r(28), shadowPaint);
    canvas.restore();

    // 2. White teardrop body
    final bodyPaint = Paint()
      ..color = bodyColor
      ..style = PaintingStyle.fill;

    final bodyPath = _buildTeardropPath(x, y);
    canvas.drawPath(bodyPath, bodyPaint);

    // 3. Orange circle cutout (visually creates hollow effect)
    final cutoutPaint = Paint()
      ..color = cutoutColor
      ..style = PaintingStyle.fill;

    canvas.drawCircle(Offset(x(80), y(69)), r(28), cutoutPaint);
  }

  /// Builds the teardrop pin shape.
  /// Bulb at top with pointed bottom tip.
  Path _buildTeardropPath(double Function(double) x, double Function(double) y) {
    final path = Path();

    // Center of the bulb and its radius
    final cx = x(80);
    final cy = y(73);
    final radius = x(65); // ~65 units in viewBox coordinates
    final tipY = y(170);

    // Angle where tangent lines from the tip touch the circle
    // The tip is below the circle center, so we calculate the tangent angle
    final dy = tipY - cy;
    final tangentAngle = math.asin(radius / dy);

    // Start angle and sweep for the top arc (the bulbous part)
    // We draw the arc from the right tangent point, going counter-clockwise
    // over the top, to the left tangent point
    final startAngle = tangentAngle; // right side
    final sweepAngle = 2 * math.pi - 2 * tangentAngle;

    // Arc for the bulb
    final rect = Rect.fromCircle(center: Offset(cx, cy), radius: radius);
    path.arcTo(rect, startAngle, sweepAngle, true);

    // Line to the tip
    path.lineTo(cx, tipY);

    path.close();
    return path;
  }

  @override
  bool shouldRepaint(PinPainter oldDelegate) =>
      bodyColor != oldDelegate.bodyColor ||
      cutoutColor != oldDelegate.cutoutColor ||
      shadowColor != oldDelegate.shadowColor;
}
