import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_painter.dart';

/// Generates and caches bitmap marker images for Yandex MapKit.
///
/// Pre-generates both open and closed marker variants on first call,
/// then serves from cache. Critical for performance with 50+ markers.
///
/// Usage:
/// ```dart
/// final generator = MapMarkerGenerator();
/// await generator.ensureInitialized(devicePixelRatio);
/// final icon = generator.getMarkerImage(isOpen: true);
/// ```
class MapMarkerGenerator {
  MapMarkerGenerator._();

  static final MapMarkerGenerator _instance = MapMarkerGenerator._();
  factory MapMarkerGenerator() => _instance;

  final Map<String, Uint8List> _cache = {};
  bool _initialized = false;
  double _cachedDpr = 0;

  /// Whether both marker variants are ready
  bool get isReady => _initialized;

  /// Pre-generate both open and closed marker images.
  /// Must be called once before using [getMarkerImage].
  /// Re-generates if devicePixelRatio changes (e.g., device switch).
  Future<void> ensureInitialized(double devicePixelRatio) async {
    if (_initialized && _cachedDpr == devicePixelRatio) return;

    _cache.clear();

    final results = await Future.wait([
      _renderMarker(isOpen: true, devicePixelRatio: devicePixelRatio),
      _renderMarker(isOpen: false, devicePixelRatio: devicePixelRatio),
    ]);

    _cache['marker_open'] = results[0];
    _cache['marker_closed'] = results[1];
    _cachedDpr = devicePixelRatio;
    _initialized = true;
  }

  /// Get cached marker image bytes. Returns null if not initialized.
  Uint8List? getMarkerImage({required bool isOpen}) {
    final key = isOpen ? 'marker_open' : 'marker_closed';
    return _cache[key];
  }

  /// Render a single marker variant to PNG bytes.
  Future<Uint8List> _renderMarker({
    required bool isOpen,
    required double devicePixelRatio,
  }) async {
    const double canvasW = MapMarkerPainter.canvasWidth;
    const double canvasH = MapMarkerPainter.canvasHeight;

    // Physical pixel dimensions for sharp rendering
    final int physicalW = (canvasW * devicePixelRatio).ceil();
    final int physicalH = (canvasH * devicePixelRatio).ceil();

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);

    // Scale canvas to match device pixel ratio
    canvas.scale(devicePixelRatio);

    final painter = MapMarkerPainter(
      isOpen: isOpen,
      devicePixelRatio: devicePixelRatio,
    );

    painter.paint(canvas, const Size(canvasW, canvasH));

    final picture = recorder.endRecording();
    final image = await picture.toImage(physicalW, physicalH);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();

    return byteData!.buffer.asUint8List();
  }
}
