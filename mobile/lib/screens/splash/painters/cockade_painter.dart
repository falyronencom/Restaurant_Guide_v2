import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Procedural painter for the NIRIVIO splash cockade — grammar **A+**
/// («сходится → удар → расходится», soft entry) in the **gloss** material.
///
/// Faithful port of the «Заставка NIRIVIO» lab (v7: `drawSoft`, `discFill`,
/// `glossSheen`, `gateWaves`), ratified as SDL CAT-C-1.4. Geometry is expressed
/// in logical pixels around the sign centre [center] with outer radius
/// [radius]. The lab's numbers were taken on a 390×844 grid where R = 62, so
/// every stroke width, blur radius and offset is scaled by `radius / 62`.
///
/// Layers, drawn bottom-to-top in the lab's order:
///   FLIGHT — three thin stroke rings converging on the centre ([flight]);
///   SIGN   — the cockade: drop shadow, three glossy discs, highlight sheen.
///            The material is present from the very first landed frame —
///            rule of CAT-C-1.4: «материал приходит вместе с формой»;
///   FLASH  — a white ring expanding from the disc edge right after landing;
///   WAVE   — one soft wave leaving the sign;
///   LOOP   — two waiting-loop waves half a period apart (session not ready).
///
/// The painter holds no animation state: every progress value is computed by
/// `SplashScreen` from the intro clock and passed in, so one painter renders
/// every frame of the intro, the waiting loop and the outro fade.
class CockadePainter extends CustomPainter {
  /// Sign centre, logical px.
  final Offset center;

  /// Outer disc radius R, logical px (62 on the lab grid).
  final double radius;

  /// Eased flight progress `p` (0 → 1) of the converging rings; `null` when
  /// the rings are not on stage (before the flight, or once landed).
  final double? flight;

  /// The sign is on stage (lab: `x ≥ .85`).
  final bool landed;

  /// Landing overshoot factor; `1` once settled.
  final double scale;

  /// Drop-shadow reveal, 0..1.
  final double shadow;

  /// Flash-ring progress `f` running 1 → 0; `0` = no flash.
  final double flash;

  /// Landing-wave progress `e` in (0, 1); `null` (or 0 / 1) = no wave.
  final double? wave;

  /// Waiting-loop phase `k ∈ [0, 1)`; `null` = no loop waves.
  final double? loopPhase;

  /// Global outro fade, 0..1.
  final double opacity;

  const CockadePainter({
    required this.center,
    required this.radius,
    required this.flight,
    required this.landed,
    required this.scale,
    required this.shadow,
    required this.flash,
    required this.wave,
    required this.loopPhase,
    required this.opacity,
  });

  /// Lab grid radius: all lab pixel constants are relative to it.
  static const double gridRadius = 62.0;

  /// Disc radii of the cockade relative to R — the three bands of the
  /// launcher icon.
  static const double ringRatio = .60;
  static const double coreRatio = .34;

  @override
  void paint(Canvas canvas, Size size) {
    if (opacity <= 0) return;
    // The outro fades the whole sign as one group: with per-shape alpha the
    // light ring would show through the core while fading.
    final bool faded = opacity < 1;
    if (faded) {
      canvas.saveLayer(
        Offset.zero & size,
        Paint()..color = Color.fromRGBO(0, 0, 0, opacity),
      );
    }
    final double u = radius / gridRadius;

    final double? p = flight;
    if (p != null) _paintFlight(canvas, p, u);
    if (landed) _paintSign(canvas, u);
    if (flash > 0) {
      _ring(
        canvas,
        radius * (1 + .55 * (1 - flash)),
        (2 + 7 * flash) * u,
        AppTheme.cockadeFlash,
        .50 * flash,
      );
    }
    final double? e = wave;
    if (e != null && e > 0 && e < 1) {
      _ring(
        canvas,
        radius * (1 + 1.85 * e),
        (3.2 * (1 - e) + .6) * u,
        AppTheme.cockadeWave,
        .46 * (1 - e),
      );
    }
    final double? k = loopPhase;
    if (k != null) _paintLoop(canvas, k, u);

    if (faded) canvas.restore();
  }

  /// A+ flight: the rings are thin strokes that thicken and brighten as they
  /// converge (not the bands themselves — that was the declined A++).
  void _paintFlight(Canvas canvas, double p, double u) {
    final double trav = 1 - p;
    _ring(canvas, radius + radius * 3.4 * trav, (1.6 + 3.4 * p) * u,
        AppTheme.cockadeCornflower, .16 + .84 * p);
    _ring(canvas, radius * ringRatio + radius * 2.6 * trav,
        (1.2 + 2.2 * p) * u, AppTheme.cockadeCornLite, .12 + .70 * p);
    _ring(canvas, radius * coreRatio + radius * 1.9 * trav,
        (1.0 + 1.6 * p) * u, AppTheme.cockadeAccent, .10 + .80 * p);
  }

  void _paintSign(Canvas canvas, double u) {
    final double r = radius * scale;
    if (shadow > 0) {
      // Lab: shadowColor rgba(40,58,107,.30·s), shadowBlur 18·s, offsetY 5·s.
      // Canvas `shadowBlur` is a Gaussian with σ = blur / 2.
      canvas.drawCircle(
        center.translate(0, 5 * shadow * u),
        r,
        Paint()
          ..color = AppTheme.cockadeShadow.withValues(alpha: .30 * shadow)
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, 9 * shadow * u)
          ..isAntiAlias = true,
      );
    }
    _disc(canvas, r, AppTheme.cockadeCornflower, .16);
    _disc(canvas, r * ringRatio, AppTheme.cockadeRing, .05);
    _disc(canvas, r * coreRatio, AppTheme.cockadeAccent, .16);
    _sheen(canvas, r);
  }

  /// Gloss disc — lab `discFill`: a two-circle radial gradient from a small
  /// off-centre highlight (colour lightened 34 % to white) through the flat
  /// colour at the midpoint to an edge darkened by [edgeDarken].
  void _disc(Canvas canvas, double r, Color color, double edgeDarken) {
    final Paint paint = Paint()
      ..isAntiAlias = true
      ..shader = ui.Gradient.radial(
        center,
        r * 1.12,
        <Color>[
          Color.lerp(color, Colors.white, .34)!,
          color,
          Color.lerp(color, Colors.black, edgeDarken)!,
        ],
        const <double>[0, .5, 1],
        TileMode.clamp,
        null,
        center.translate(-r * .36, -r * .40),
        r * .04,
      );
    canvas.drawCircle(center, r, paint);
  }

  /// Highlight over the whole sign — lab `glossSheen`: a white-to-transparent
  /// radial glow in the upper-left, clipped to the outer disc. Present at full
  /// strength from the first landed frame (never ramps in after landing).
  void _sheen(Canvas canvas, double r) {
    final Offset highlight = center.translate(-r * .30, -r * .42);
    final Rect box = Rect.fromCircle(center: center, radius: r);
    canvas.save();
    canvas.clipPath(Path()..addOval(box));
    canvas.drawRect(
      box,
      Paint()
        ..shader = ui.Gradient.radial(
          highlight,
          r * .75,
          <Color>[
            Colors.white.withValues(alpha: .34),
            Colors.white.withValues(alpha: 0),
          ],
        ),
    );
    canvas.restore();
  }

  /// Waiting loop — lab `gateWaves`: two soft waves half a period apart,
  /// leaving the sign every 1.1 s. No impact.
  void _paintLoop(Canvas canvas, double k, double u) {
    _ring(canvas, radius * (1 + 2 * k), (2.5 * (1 - k) + .8) * u,
        AppTheme.cockadeWave, .20 * (1 - k));
    final double k2 = (k + .5) % 1.0;
    _ring(canvas, radius * (1 + 2 * k2), (2.5 * (1 - k2) + .8) * u,
        AppTheme.cockadeWave, .20 * (1 - k2));
  }

  void _ring(Canvas canvas, double r, double width, Color color, double alpha) {
    final double a = alpha.clamp(0.0, 1.0);
    if (a <= .004 || r <= .5) return;
    canvas.drawCircle(
      center,
      r,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = width
        ..color = color.withValues(alpha: a)
        ..isAntiAlias = true,
    );
  }

  @override
  bool shouldRepaint(CockadePainter old) =>
      center != old.center ||
      radius != old.radius ||
      flight != old.flight ||
      landed != old.landed ||
      scale != old.scale ||
      shadow != old.shadow ||
      flash != old.flash ||
      wave != old.wave ||
      loopPhase != old.loopPhase ||
      opacity != old.opacity;
}
