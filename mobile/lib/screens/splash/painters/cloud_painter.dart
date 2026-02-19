import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Paints a stylized cloud shape with a subtle shadow.
/// The cloud is a flat-bottomed shape with rounded bumps on top,
/// matching the React prototype's paper-cut SVG style.
class CloudPainter extends CustomPainter {
  final double opacity;

  CloudPainter({required this.opacity});

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Shadow layer (offset dark orange, low opacity)
    final shadowPaint = Paint()
      ..color = AppTheme.primaryOrangeDark.withValues(alpha: 0.2 * opacity)
      ..style = PaintingStyle.fill;

    final shadowPath = _buildCloudPath(w, h);
    canvas.save();
    canvas.translate(w * 0.02, h * 0.06);
    canvas.drawPath(shadowPath, shadowPaint);
    canvas.restore();

    // White cloud body
    final bodyPaint = Paint()
      ..color = Colors.white.withValues(alpha: opacity)
      ..style = PaintingStyle.fill;

    final bodyPath = _buildCloudPath(w, h);
    canvas.drawPath(bodyPath, bodyPaint);
  }

  /// Builds the cloud silhouette path proportional to the given size.
  /// Matches the React SVG: viewBox="0 0 100 50"
  Path _buildCloudPath(double w, double h) {
    final path = Path();

    // Scale factors from viewBox 100x50
    double x(double v) => v / 100 * w;
    double y(double v) => v / 50 * h;

    path.moveTo(x(17), y(44));
    path.quadraticBezierTo(x(1), y(44), x(1), y(32));
    path.quadraticBezierTo(x(1), y(22), x(12), y(20));
    path.quadraticBezierTo(x(10), y(10), x(22), y(8));
    path.quadraticBezierTo(x(26), y(1), x(38), y(3));
    path.quadraticBezierTo(x(48), y(0), x(56), y(6));
    path.quadraticBezierTo(x(68), y(2), x(76), y(10));
    path.quadraticBezierTo(x(88), y(8), x(90), y(20));
    path.quadraticBezierTo(x(100), y(20), x(100), y(32));
    path.quadraticBezierTo(x(100), y(44), x(88), y(44));
    path.close();

    return path;
  }

  @override
  bool shouldRepaint(CloudPainter oldDelegate) => opacity != oldDelegate.opacity;
}
