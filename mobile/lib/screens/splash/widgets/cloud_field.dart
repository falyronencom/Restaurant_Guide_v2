import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/screens/splash/painters/cloud_painter.dart';

/// Describes a single cloud instance with fixed position, size, and appearance.
class CloudInstance {
  /// Normalized initial x position (0.0–1.5, can start offscreen right)
  final double initialX;

  /// Normalized y position (0.0–1.0 of screen height)
  final double y;

  /// Cloud width in logical pixels
  final double width;

  /// Cloud opacity (0.0–1.0)
  final double opacity;

  /// Parallax layer: 0=back (slow), 1=mid, 2=front (fast)
  final int layer;

  const CloudInstance({
    required this.initialX,
    required this.y,
    required this.width,
    required this.opacity,
    required this.layer,
  });
}

/// Pre-defined cloud layout matching the React prototype.
/// ~12 clouds across 3 layers for full-screen atmosphere.
const List<CloudInstance> _clouds = [
  // Back layer (layer 0) — small, slow, faded
  CloudInstance(initialX: 0.08, y: 0.04, width: 62, opacity: 0.42, layer: 0),
  CloudInstance(initialX: 0.62, y: 0.08, width: 50, opacity: 0.36, layer: 0),
  CloudInstance(initialX: 1.35, y: 0.02, width: 70, opacity: 0.40, layer: 0),

  // Mid layer (layer 1) — upper half
  CloudInstance(initialX: 0.00, y: 0.16, width: 90, opacity: 0.60, layer: 1),
  CloudInstance(initialX: 0.60, y: 0.12, width: 76, opacity: 0.52, layer: 1),
  CloudInstance(initialX: 1.22, y: 0.18, width: 85, opacity: 0.48, layer: 1),
  // Mid layer — lower half
  CloudInstance(initialX: 0.05, y: 0.62, width: 80, opacity: 0.45, layer: 1),
  CloudInstance(initialX: 0.55, y: 0.68, width: 70, opacity: 0.40, layer: 1),

  // Front layer (layer 2) — large, fast, opaque
  CloudInstance(initialX: -0.04, y: 0.27, width: 112, opacity: 0.76, layer: 2),
  CloudInstance(initialX: 0.57, y: 0.31, width: 102, opacity: 0.70, layer: 2),
  CloudInstance(initialX: -0.08, y: 0.72, width: 120, opacity: 0.70, layer: 2),
  CloudInstance(initialX: 0.52, y: 0.78, width: 108, opacity: 0.65, layer: 2),
];

/// Speed multipliers per layer for parallax effect.
const List<double> _layerSpeeds = [0.3, 0.6, 1.0];

/// Renders all clouds for a given [layer] as an animated field.
/// Clouds drift left continuously, wrapping around when they exit the screen.
class CloudField extends StatelessWidget {
  final int layer;
  final Animation<double> driftAnimation;

  const CloudField({
    super.key,
    required this.layer,
    required this.driftAnimation,
  });

  @override
  Widget build(BuildContext context) {
    final layerClouds = _clouds.where((c) => c.layer == layer).toList();
    final speed = _layerSpeeds[layer];

    return AnimatedBuilder(
      animation: driftAnimation,
      builder: (context, child) {
        return Stack(
          children: layerClouds.map((cloud) {
            // Compute current x position with wrap-around
            final drift = driftAnimation.value * speed * 1.6;
            var currentX = cloud.initialX - drift;
            // Wrap: when cloud exits left, re-enter from right
            currentX = currentX % 1.6 - 0.3;

            return Positioned(
              left: currentX * MediaQuery.of(context).size.width,
              top: cloud.y * MediaQuery.of(context).size.height,
              child: CustomPaint(
                size: Size(cloud.width, cloud.width * 0.5),
                painter: CloudPainter(opacity: cloud.opacity),
              ),
            );
          }).toList(),
        );
      },
    );
  }
}
