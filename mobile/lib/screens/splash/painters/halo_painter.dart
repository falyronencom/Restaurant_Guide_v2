import 'package:flutter/material.dart';

/// Paints a soft glowing ellipse beneath the pin, creating a "ground plane".
/// When the pin hovers up, the halo shrinks and fades (inverse relationship).
/// Uses MaskFilter.blur for the glow effect — matches React's box-shadow approach.
class HaloPainter extends CustomPainter {
  final double opacity;
  final double scaleX;
  final Color color;

  HaloPainter({
    required this.opacity,
    required this.scaleX,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color.withValues(alpha: opacity * 0.45)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12);

    canvas.save();

    // Scale horizontally from center
    final cx = size.width / 2;
    final cy = size.height / 2;
    canvas.translate(cx, cy);
    canvas.scale(scaleX, 1.0);
    canvas.translate(-cx, -cy);

    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(cx, cy),
        width: size.width,
        height: size.height,
      ),
      paint,
    );

    canvas.restore();
  }

  @override
  bool shouldRepaint(HaloPainter oldDelegate) =>
      opacity != oldDelegate.opacity ||
      scaleX != oldDelegate.scaleX ||
      color != oldDelegate.color;
}
