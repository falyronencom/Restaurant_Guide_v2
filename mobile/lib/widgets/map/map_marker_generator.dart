import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_cluster_painter.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_painter.dart';

/// Generates and caches bitmap marker images for Yandex MapKit.
///
/// Pre-generates both open and closed marker variants on first call,
/// then serves from cache. Critical for performance with 50+ markers.
/// Cluster bubbles are rendered on first request per group size and cached
/// the same way.
///
/// Usage:
/// ```dart
/// final generator = MapMarkerGenerator();
/// await generator.ensureInitialized(devicePixelRatio);
/// final icon = generator.getMarkerImage(isOpen: true);
/// final bubble = await generator.getClusterImage(7);
/// ```
class MapMarkerGenerator {
  MapMarkerGenerator._();

  static final MapMarkerGenerator _instance = MapMarkerGenerator._();
  factory MapMarkerGenerator() => _instance;

  final Map<String, Uint8List> _cache = {};

  /// Bubble images by group size. MapKit re-creates every bubble whenever the
  /// clustering is redone (a zoom step, a new set of pins), so a size seen
  /// before must cost a lookup, not a render. Futures are stored, so bubbles
  /// of one size created together share a single render.
  final Map<int, Future<Uint8List>> _clusterCache = {};

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
      _renderMarker(isOpen: true, isSelected: true, devicePixelRatio: devicePixelRatio),
    ]);

    _cache['marker_open'] = results[0];
    _cache['marker_closed'] = results[1];
    _cache['marker_selected'] = results[2];
    // Cleared together with the ratio change: a bubble requested while the
    // pins were re-rendering was drawn at the old ratio.
    _clusterCache.clear();
    _cachedDpr = devicePixelRatio;
    _initialized = true;
  }

  /// Get cached marker image bytes. Returns null if not initialized.
  Uint8List? getMarkerImage({required bool isOpen, bool isSelected = false}) {
    if (isSelected) return _cache['marker_selected'];
    final key = isOpen ? 'marker_open' : 'marker_closed';
    return _cache[key];
  }

  /// Bubble image for a group of [count] establishments, as PNG bytes.
  /// Returns null until [ensureInitialized] has fixed the pixel ratio.
  Future<Uint8List>? getClusterImage(int count) {
    if (!_initialized) return null;
    return _clusterCache.putIfAbsent(count, () {
      final render = _renderCluster(count: count, devicePixelRatio: _cachedDpr);
      // A failed render must not stay cached: every later bubble of this size
      // would fail the same way until the app restarts.
      render.then<void>((_) {}, onError: (Object _) {
        if (identical(_clusterCache[count], render)) _clusterCache.remove(count);
      });
      return render;
    });
  }

  /// Render one bubble to PNG bytes at the device's pixel density.
  Future<Uint8List> _renderCluster({
    required int count,
    required double devicePixelRatio,
  }) async {
    final double side = MapClusterPainter.canvasSideFor(count);
    final int physicalSide = (side * devicePixelRatio).ceil();

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.scale(devicePixelRatio);
    MapClusterPainter(count: count).paint(canvas, Size(side, side));

    final picture = recorder.endRecording();
    final image = await picture.toImage(physicalSide, physicalSide);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    picture.dispose();

    return byteData!.buffer.asUint8List();
  }

  /// Render a single marker variant to PNG bytes.
  Future<Uint8List> _renderMarker({
    required bool isOpen,
    bool isSelected = false,
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
      isSelected: isSelected,
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
